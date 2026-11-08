import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import type {
  ArrayField,
  BlocksField,
  Field,
  GroupField,
  RelationshipField,
  UploadField,
} from '../fields/types'
import { runAfterReadHooks } from '../hooks/runner'

export function parseDepth(val: string | undefined): number {
  if (!val) return 0
  const parsed = parseInt(val, 10)
  if (Number.isNaN(parsed) || parsed < 0) return 0
  return Math.min(10, parsed)
}

export interface PopulateOptions {
  docs: DocumentData[]
  collection: CollectionConfig
  depth: number
  collections: readonly CollectionConfig[]
  db: DatabaseAdapter
  user?: AuthUser | null
  req?: Request
  seen?: ReadonlySet<string>
  overrideAccess?: boolean
}

interface SingleRefSlot {
  type: 'single'
  targetColSlug: string
  targetId: number
  assign: (populated: DocumentData | null) => void
}

interface ManyRefSlot {
  type: 'many'
  targetColSlug: string
  targetIds: number[]
  assign: (populated: Array<DocumentData | number>) => void
}

type RefSlot = SingleRefSlot | ManyRefSlot

function collectRelationshipSlot(
  container: Record<string, unknown>,
  name: string,
  field: RelationshipField,
  slots: RefSlot[],
): void {
  const val = container[name]
  if (field.hasMany) {
    if (Array.isArray(val)) {
      const targetIds = val.filter((id): id is number => typeof id === 'number' && id > 0)
      slots.push({
        type: 'many',
        targetColSlug: field.relationTo,
        targetIds,
        assign: (populated) => {
          container[name] = populated
        },
      })
    } else {
      container[name] = []
    }
  } else if (typeof val === 'number' && val > 0) {
    slots.push({
      type: 'single',
      targetColSlug: field.relationTo,
      targetId: val,
      assign: (populated) => {
        container[name] = populated
      },
    })
  } else {
    container[name] = null
  }
}

function collectUploadSlot(
  container: Record<string, unknown>,
  name: string,
  field: UploadField,
  slots: RefSlot[],
): void {
  const val = container[name]
  if (typeof val === 'number' && val > 0) {
    slots.push({
      type: 'single',
      targetColSlug: field.relationTo,
      targetId: val,
      assign: (populated) => {
        container[name] = populated
      },
    })
  } else {
    container[name] = null
  }
}

function collectBlocksSlots(
  container: Record<string, unknown>,
  name: string,
  field: BlocksField,
  slots: RefSlot[],
): void {
  const val = container[name]
  if (!Array.isArray(val)) return
  const blocksBySlug = new Map(field.blocks.map((b) => [b.slug, b]))
  for (const row of val) {
    if (!row || typeof row !== 'object') continue
    const blockType = (row as Record<string, unknown>).blockType
    if (typeof blockType !== 'string') continue
    const blockDef = blocksBySlug.get(blockType)
    if (blockDef) {
      collectSlots(row as Record<string, unknown>, blockDef.fields, slots)
    }
  }
}

function collectArraySlots(
  container: Record<string, unknown>,
  name: string,
  field: ArrayField,
  slots: RefSlot[],
): void {
  const val = container[name]
  if (!Array.isArray(val)) return
  for (const row of val) {
    if (row && typeof row === 'object') {
      collectSlots(row as Record<string, unknown>, field.fields, slots)
    }
  }
}

function collectGroupSlots(
  container: Record<string, unknown>,
  name: string,
  field: GroupField,
  slots: RefSlot[],
): void {
  const val = container[name]
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    collectSlots(val as Record<string, unknown>, field.fields, slots)
  }
}

function collectFieldSlot(
  container: Record<string, unknown>,
  name: string,
  field: Field,
  slots: RefSlot[],
): void {
  if (field.type === 'relationship') {
    collectRelationshipSlot(container, name, field, slots)
  } else if (field.type === 'upload') {
    collectUploadSlot(container, name, field, slots)
  } else if (field.type === 'group') {
    collectGroupSlots(container, name, field, slots)
  } else if (field.type === 'array') {
    collectArraySlots(container, name, field, slots)
  } else if (field.type === 'blocks') {
    collectBlocksSlots(container, name, field, slots)
  }
}

function collectSlots(
  container: Record<string, unknown>,
  fields: Record<string, Field>,
  slots: RefSlot[],
): void {
  for (const [name, field] of Object.entries(fields)) {
    collectFieldSlot(container, name, field, slots)
  }
}

function groupSlotsByTarget(slots: RefSlot[]): Map<string, RefSlot[]> {
  const grouped = new Map<string, RefSlot[]>()
  for (const slot of slots) {
    let list = grouped.get(slot.targetColSlug)
    if (!list) {
      list = []
      grouped.set(slot.targetColSlug, list)
    }
    list.push(slot)
  }
  return grouped
}

function extractTargetIds(
  slots: RefSlot[],
  targetColSlug: string,
  seen: ReadonlySet<string>,
): number[] {
  const ids = new Set<number>()
  for (const slot of slots) {
    if (slot.type === 'single') {
      if (!seen.has(`${targetColSlug}:${slot.targetId}`)) {
        ids.add(slot.targetId)
      }
    } else {
      for (const id of slot.targetIds) {
        if (!seen.has(`${targetColSlug}:${id}`)) {
          ids.add(id)
        }
      }
    }
  }
  return Array.from(ids)
}

async function fetchTargetDocs(
  targetCol: CollectionConfig,
  targetIds: number[],
  db: DatabaseAdapter,
  req?: Request,
): Promise<Map<number, DocumentData>> {
  if (targetIds.length === 0) return new Map()
  const result = await db.find({
    collection: targetCol,
    limit: targetIds.length,
    page: 1,
    where: { id: { in: targetIds } },
  })
  const transformed = await Promise.all(
    result.docs.map((doc) => runAfterReadHooks({ collection: targetCol, doc, req })),
  )
  return new Map(transformed.map((d) => [d.id as number, d]))
}

function assignTargetSlots(
  slots: RefSlot[],
  docsById: Map<number, DocumentData>,
  seen: ReadonlySet<string>,
): void {
  for (const slot of slots) {
    if (slot.type === 'single') {
      if (seen.has(`${slot.targetColSlug}:${slot.targetId}`)) {
        continue
      }
      slot.assign(docsById.get(slot.targetId) ?? null)
    } else {
      const populated = slot.targetIds
        .map((id) => {
          if (seen.has(`${slot.targetColSlug}:${id}`)) return id
          return docsById.get(id) ?? null
        })
        .filter((d): d is DocumentData | number => d !== null && d !== undefined)
      slot.assign(populated)
    }
  }
}

async function populateChildren(
  targetCol: CollectionConfig,
  docsById: Map<number, DocumentData>,
  parentDocs: DocumentData[],
  parentCollection: CollectionConfig,
  depth: number,
  collections: readonly CollectionConfig[],
  db: DatabaseAdapter,
  user: AuthUser | null,
  req?: Request,
  seen: ReadonlySet<string> = new Set(),
  overrideAccess?: boolean,
): Promise<void> {
  const nextSeen = new Set(seen)
  for (const d of parentDocs) {
    if (typeof d.id === 'number') {
      nextSeen.add(`${parentCollection.slug}:${d.id}`)
    }
  }
  const targetList = Array.from(docsById.values())
  const populatedChildren = await populateDocs({
    docs: targetList,
    collection: targetCol,
    depth: depth - 1,
    collections,
    db,
    user,
    req,
    seen: nextSeen,
    overrideAccess,
  })
  for (const child of populatedChildren) {
    if (typeof child.id === 'number') {
      docsById.set(child.id, child)
    }
  }
}

interface PopulateTargetArgs {
  targetCol: CollectionConfig
  targetSlots: RefSlot[]
  parentDocs: DocumentData[]
  parentCollection: CollectionConfig
  depth: number
  collections: readonly CollectionConfig[]
  db: DatabaseAdapter
  user: AuthUser | null
  req?: Request
  seen: ReadonlySet<string>
  overrideAccess?: boolean
}

async function populateTargetCollection(args: PopulateTargetArgs): Promise<void> {
  const {
    targetCol,
    targetSlots,
    parentDocs,
    parentCollection,
    depth,
    collections,
    db,
    user,
    req,
    seen,
    overrideAccess,
  } = args

  const canRead = overrideAccess ? true : await checkAccess(targetCol.access?.read, { user })
  if (!canRead) return

  const targetIds = extractTargetIds(targetSlots, targetCol.slug, seen)
  const docsById = await fetchTargetDocs(targetCol, targetIds, db, req)

  if (depth > 1 && docsById.size > 0) {
    await populateChildren(
      targetCol,
      docsById,
      parentDocs,
      parentCollection,
      depth,
      collections,
      db,
      user,
      req,
      seen,
      overrideAccess,
    )
  }

  assignTargetSlots(targetSlots, docsById, seen)
}

function hasReferenceFields(fields: Record<string, Field>): boolean {
  for (const field of Object.values(fields)) {
    if (field.type === 'relationship' || field.type === 'upload') return true
    if ((field.type === 'group' || field.type === 'array') && hasReferenceFields(field.fields)) {
      return true
    }
    if (field.type === 'blocks') {
      for (const b of field.blocks) {
        if (hasReferenceFields(b.fields)) return true
      }
    }
  }
  return false
}

function filterDocsToPopulate(
  docs: DocumentData[],
  collectionSlug: string,
  seen: ReadonlySet<string>,
): DocumentData[] {
  return docs.filter((doc) => {
    return typeof doc.id !== 'number' || !seen.has(`${collectionSlug}:${doc.id}`)
  })
}

interface PopulateAllTargetsArgs {
  slots: RefSlot[]
  docsToPopulate: DocumentData[]
  collection: CollectionConfig
  depth: number
  collections: readonly CollectionConfig[]
  db: DatabaseAdapter
  user: AuthUser | null
  req?: Request
  seen: ReadonlySet<string>
  overrideAccess?: boolean
}

async function populateAllTargets(args: PopulateAllTargetsArgs): Promise<void> {
  const {
    slots,
    docsToPopulate,
    collection,
    depth,
    collections,
    db,
    user,
    req,
    seen,
    overrideAccess,
  } = args

  const slotsByTarget = groupSlotsByTarget(slots)
  for (const [targetColSlug, targetSlots] of slotsByTarget) {
    const targetCol = collections.find((c) => c.slug === targetColSlug)
    if (!targetCol) continue

    await populateTargetCollection({
      targetCol,
      targetSlots,
      parentDocs: docsToPopulate,
      parentCollection: collection,
      depth,
      collections,
      db,
      user,
      req,
      seen,
      overrideAccess,
    })
  }
}

export async function populateDocs(options: PopulateOptions): Promise<DocumentData[]> {
  const { docs, collection, depth, collections, db, req, overrideAccess } = options
  const user = options.user ?? null
  const seen = options.seen ?? new Set<string>()

  if (depth <= 0 || docs.length === 0) return docs
  if (!hasReferenceFields(collection.fields)) return docs

  const docsToPopulate = filterDocsToPopulate(docs, collection.slug, seen)
  if (docsToPopulate.length === 0) return docs

  const slots: RefSlot[] = []
  for (const doc of docsToPopulate) {
    collectSlots(doc, collection.fields, slots)
  }
  if (slots.length === 0) return docs

  await populateAllTargets({
    slots,
    docsToPopulate,
    collection,
    depth,
    collections,
    db,
    user,
    req,
    seen,
    overrideAccess,
  })

  return docs
}

export async function populateDoc(
  doc: DocumentData,
  options: Omit<PopulateOptions, 'docs'>,
): Promise<DocumentData> {
  const [populated] = await populateDocs({ ...options, docs: [doc] })
  return populated ?? doc
}
