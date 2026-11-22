import { combineWhere, constraintOf, resolveAccess, sanitizeDocRead } from '../access'
import type { FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config } from '../config/types'
import type { Where } from '../query/types'
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
import { projectCanonicalDoc, type ProjectLocaleContext } from '../operations/locale'

export function parseDepth(val: string | undefined): number {
  if (!val) return 0
  const parsed = parseInt(val, 10)
  if (Number.isNaN(parsed) || parsed < 0) return 0
  return Math.min(10, parsed)
}

export interface PopulateOptions {
  docs: DocumentData[]
  collection: { slug: string; fields: Record<string, Field> } | CollectionConfig
  depth: number
  collections: readonly CollectionConfig[]
  db: DatabaseAdapter
  user?: AuthUser | null
  req?: Request
  seen?: ReadonlySet<string>
  overrideAccess?: boolean
  draft?: boolean
  cache?: FieldAccessCache
  locale?: string
  fallbackLocale?: string | false
  /** Needed to validate a row-level constraint on a localized path (ADR 0030). */
  localization?: Config['localization']
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

function collectLocalizedManySlots(
  dict: Record<string, unknown>,
  targetColSlug: string,
  slots: RefSlot[],
): void {
  for (const [loc, locVal] of Object.entries(dict)) {
    if (Array.isArray(locVal)) {
      const targetIds = locVal.filter((id): id is number => typeof id === 'number' && id > 0)
      slots.push({
        type: 'many',
        targetColSlug,
        targetIds,
        assign: (populated) => {
          dict[loc] = populated
        },
      })
    }
  }
}

function collectLocalizedSingleSlots(
  dict: Record<string, unknown>,
  targetColSlug: string,
  slots: RefSlot[],
): void {
  for (const [loc, locVal] of Object.entries(dict)) {
    if (typeof locVal === 'number' && locVal > 0) {
      slots.push({
        type: 'single',
        targetColSlug,
        targetId: locVal,
        assign: (populated) => {
          dict[loc] = populated
        },
      })
    }
  }
}

function collectManyRelationshipSlot(
  container: Record<string, unknown>,
  name: string,
  field: RelationshipField,
  slots: RefSlot[],
): void {
  const val = container[name]
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
  } else if (val && typeof val === 'object') {
    collectLocalizedManySlots(val as Record<string, unknown>, field.relationTo, slots)
  } else {
    container[name] = []
  }
}

function collectSingleRelationshipSlot(
  container: Record<string, unknown>,
  name: string,
  field: RelationshipField,
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
  } else if (val && typeof val === 'object' && !Array.isArray(val)) {
    collectLocalizedSingleSlots(val as Record<string, unknown>, field.relationTo, slots)
  } else {
    container[name] = null
  }
}

function collectRelationshipSlot(
  container: Record<string, unknown>,
  name: string,
  field: RelationshipField,
  slots: RefSlot[],
): void {
  if (field.hasMany) {
    collectManyRelationshipSlot(container, name, field, slots)
  } else {
    collectSingleRelationshipSlot(container, name, field, slots)
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
  } else if (val && typeof val === 'object' && !Array.isArray(val)) {
    collectLocalizedSingleSlots(val as Record<string, unknown>, field.relationTo, slots)
  } else {
    container[name] = null
  }
}

function collectBlocksRows(rows: readonly unknown[], field: BlocksField, slots: RefSlot[]): void {
  const blocksBySlug = new Map(field.blocks.map((b) => [b.slug, b]))
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const blockType = (row as Record<string, unknown>).blockType
    if (typeof blockType !== 'string') continue
    const blockDef = blocksBySlug.get(blockType)
    if (blockDef) {
      collectSlots(row as Record<string, unknown>, blockDef.fields, slots)
    }
  }
}

function collectBlocksSlots(
  container: Record<string, unknown>,
  name: string,
  field: BlocksField,
  slots: RefSlot[],
): void {
  const val = container[name]
  if (Array.isArray(val)) {
    collectBlocksRows(val, field, slots)
  } else if (val && typeof val === 'object') {
    for (const rows of Object.values(val as Record<string, unknown>)) {
      if (Array.isArray(rows)) {
        collectBlocksRows(rows, field, slots)
      }
    }
  }
}

function collectArrayRows(rows: readonly unknown[], field: ArrayField, slots: RefSlot[]): void {
  for (const row of rows) {
    if (row && typeof row === 'object') {
      collectSlots(row as Record<string, unknown>, field.fields, slots)
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
  if (Array.isArray(val)) {
    collectArrayRows(val, field, slots)
  } else if (val && typeof val === 'object') {
    for (const rows of Object.values(val as Record<string, unknown>)) {
      if (Array.isArray(rows)) {
        collectArrayRows(rows, field, slots)
      }
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

export const MAX_POPULATE_BATCH_SIZE = 500

async function hydrateTargetDraftDocs(
  targetCol: CollectionConfig,
  docs: DocumentData[],
  db: DatabaseAdapter,
  draft?: boolean,
  localeCtx?: ProjectLocaleContext,
): Promise<DocumentData[]> {
  if (!targetCol.versions?.drafts || !draft || !db.findLatestDraftVersion) {
    return docs
  }
  return Promise.all(
    docs.map(async (doc) => {
      const isPublished = doc._status === 'published'
      const latestDraft = await db.findLatestDraftVersion!({
        collection: targetCol,
        parentId: Number(doc.id),
      })
      if (latestDraft) {
        // Snapshots keep localized fields as `{ en, id }` dictionaries.
        const snapshot = localeCtx
          ? projectCanonicalDoc(latestDraft.snapshot, targetCol.fields, localeCtx)
          : latestDraft.snapshot
        return { ...snapshot, _isPublished: isPublished }
      }
      return { ...doc, _isPublished: isPublished }
    }),
  )
}

async function fetchTargetDocs(
  targetCol: CollectionConfig,
  targetIds: number[],
  db: DatabaseAdapter,
  req?: Request,
  draft?: boolean,
  locale?: string,
  fallbackLocale?: string | false,
  constraint?: Where,
): Promise<Map<number, DocumentData>> {
  if (targetIds.length === 0) return new Map()
  const docs: DocumentData[] = []
  for (let i = 0; i < targetIds.length; i += MAX_POPULATE_BATCH_SIZE) {
    const chunk = targetIds.slice(i, i + MAX_POPULATE_BATCH_SIZE)
    const baseWhere = { id: { in: chunk } }
    const where = combineWhere(
      targetCol.versions?.drafts && !draft
        ? { and: [baseWhere, { _status: { equals: 'published' } }] }
        : baseWhere,
      constraint,
    )
    const result = await db.find({
      collection: targetCol,
      limit: chunk.length,
      page: 1,
      where,
      overrideLimit: true,
      locale,
      fallbackLocale,
    })
    docs.push(...result.docs)
  }
  const hydrated = await hydrateTargetDraftDocs(
    targetCol,
    docs,
    db,
    draft,
    locale ? { locale, fallbackLocale } : undefined,
  )
  const transformed = await Promise.all(
    hydrated.map((doc) => runAfterReadHooks({ collection: targetCol, doc, req, locale })),
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
  draft?: boolean,
  locale?: string,
  fallbackLocale?: string | false,
  localization?: Config['localization'],
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
    draft,
    locale,
    fallbackLocale,
    localization,
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
  draft?: boolean
  cache?: FieldAccessCache
  locale?: string
  fallbackLocale?: string | false
  /** Needed to validate a row-level constraint on a localized path (ADR 0030). */
  localization?: Config['localization']
}

async function sanitizeTargetDocs(
  targetCol: CollectionConfig,
  docsById: Map<number, DocumentData>,
  user: AuthUser | null,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<void> {
  for (const [id, doc] of docsById.entries()) {
    const sanitized = await sanitizeDocRead(targetCol.fields, doc, user, {
      id,
      doc,
      cache,
      req,
      locale,
    })
    docsById.set(id, sanitized)
  }
}

interface TargetAccessArgs {
  targetCol: CollectionConfig
  user: AuthUser | null
  locale?: string
  localization?: Config['localization']
  overrideAccess?: boolean
  draft?: boolean
}

interface TargetAccess {
  canDraftTarget: boolean
  /** The target collection's row-level constraint, when its access returned one (ADR 0030 §7). */
  constraint?: Where
}

// `undefined` means the target cannot be read at all, so nothing is populated from it. A related
// document outside a constraint is simply not fetched, and its field keeps the bare id.
async function resolveTargetAccess(args: TargetAccessArgs): Promise<TargetAccess | undefined> {
  const { targetCol, user, locale, localization, overrideAccess, draft } = args
  if (overrideAccess) return { canDraftTarget: Boolean(draft) }
  const config = { localization }
  const read = await resolveAccess(targetCol, 'read', { user, locale }, config)
  if (!read.allowed) return undefined
  if (!draft) return { canDraftTarget: false, constraint: constraintOf(read) }
  const update = await resolveAccess(targetCol, 'update', { user, locale }, config)
  if (!update.allowed) return { canDraftTarget: false, constraint: constraintOf(read) }
  return { canDraftTarget: true, constraint: constraintOf(read, update) }
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
    draft,
    locale,
    fallbackLocale,
    localization,
  } = args

  const access = await resolveTargetAccess({
    targetCol,
    user,
    locale,
    localization,
    overrideAccess,
    draft,
  })
  if (!access) return
  const { canDraftTarget, constraint } = access

  const targetIds = extractTargetIds(targetSlots, targetCol.slug, seen)
  const docsById = await fetchTargetDocs(
    targetCol,
    targetIds,
    db,
    req,
    canDraftTarget,
    locale,
    fallbackLocale,
    constraint,
  )

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
      canDraftTarget,
      locale,
      fallbackLocale,
      localization,
    )
  }

  if (!overrideAccess) {
    await sanitizeTargetDocs(targetCol, docsById, user, args.cache, req, locale)
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
  draft?: boolean
  cache?: FieldAccessCache
  locale?: string
  fallbackLocale?: string | false
  /** Needed to validate a row-level constraint on a localized path (ADR 0030). */
  localization?: Config['localization']
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
    draft,
    cache,
    locale,
    fallbackLocale,
    localization,
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
      draft,
      cache,
      locale,
      fallbackLocale,
      localization,
    })
  }
}

export async function populateDocs(options: PopulateOptions): Promise<DocumentData[]> {
  const {
    docs,
    collection,
    depth,
    collections,
    db,
    req,
    overrideAccess,
    draft,
    cache,
    locale,
    fallbackLocale,
    localization,
  } = options
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
    draft,
    cache,
    locale,
    fallbackLocale,
    localization,
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
