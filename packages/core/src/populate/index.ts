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
import { flattenFields } from '../fields/flatten'
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

interface PolymorphicRefItem {
  relationTo: string
  id: number
}

interface PolymorphicManyRefSlot {
  type: 'poly-many'
  items: PolymorphicRefItem[]
  assign: (populated: Array<{ relationTo: string; value: DocumentData | number }>) => void
}

type RefSlot = SingleRefSlot | ManyRefSlot | PolymorphicManyRefSlot

function parsePolymorphicRef(raw: unknown): PolymorphicRefItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.relationTo !== 'string' || !record.relationTo) return null
  if (typeof record.value !== 'number' || record.value <= 0) return null
  return { relationTo: record.relationTo, id: record.value }
}

function collectLocalizedPolymorphicManySlots(
  dict: Record<string, unknown>,
  slots: RefSlot[],
): void {
  for (const [loc, locVal] of Object.entries(dict)) {
    if (Array.isArray(locVal)) {
      const items = locVal
        .map(parsePolymorphicRef)
        .filter((item): item is PolymorphicRefItem => item !== null)
      slots.push({
        type: 'poly-many',
        items,
        assign: (populated) => {
          dict[loc] = populated
        },
      })
    }
  }
}

function collectLocalizedPolymorphicSingleSlots(
  dict: Record<string, unknown>,
  slots: RefSlot[],
): void {
  for (const [loc, locVal] of Object.entries(dict)) {
    const ref = parsePolymorphicRef(locVal)
    if (ref) {
      slots.push({
        type: 'single',
        targetColSlug: ref.relationTo,
        targetId: ref.id,
        assign: (populated) => {
          dict[loc] = { relationTo: ref.relationTo, value: populated }
        },
      })
    } else if (locVal !== undefined) {
      dict[loc] = null
    }
  }
}

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

function collectPolymorphicManySlot(
  container: Record<string, unknown>,
  name: string,
  slots: RefSlot[],
): void {
  const val = container[name]
  if (Array.isArray(val)) {
    const items = val
      .map(parsePolymorphicRef)
      .filter((item): item is PolymorphicRefItem => item !== null)
    slots.push({
      type: 'poly-many',
      items,
      assign: (populated) => {
        container[name] = populated
      },
    })
  } else if (val && typeof val === 'object') {
    collectLocalizedPolymorphicManySlots(val as Record<string, unknown>, slots)
  } else {
    container[name] = []
  }
}

function collectManyRelationshipSlot(
  container: Record<string, unknown>,
  name: string,
  field: RelationshipField,
  slots: RefSlot[],
): void {
  if (Array.isArray(field.relationTo)) {
    collectPolymorphicManySlot(container, name, slots)
    return
  }
  const targetColSlug = field.relationTo as string
  const val = container[name]
  if (Array.isArray(val)) {
    const targetIds = val.filter((id): id is number => typeof id === 'number' && id > 0)
    slots.push({
      type: 'many',
      targetColSlug,
      targetIds,
      assign: (populated) => {
        container[name] = populated
      },
    })
  } else if (val && typeof val === 'object') {
    collectLocalizedManySlots(val as Record<string, unknown>, targetColSlug, slots)
  } else {
    container[name] = []
  }
}

function collectPolymorphicSingleSlot(
  container: Record<string, unknown>,
  name: string,
  slots: RefSlot[],
): void {
  const val = container[name]
  const ref = parsePolymorphicRef(val)
  if (ref) {
    slots.push({
      type: 'single',
      targetColSlug: ref.relationTo,
      targetId: ref.id,
      assign: (populated) => {
        container[name] = { relationTo: ref.relationTo, value: populated }
      },
    })
  } else if (val && typeof val === 'object' && !Array.isArray(val)) {
    collectLocalizedPolymorphicSingleSlots(val as Record<string, unknown>, slots)
  } else {
    container[name] = null
  }
}

function collectSingleRelationshipSlot(
  container: Record<string, unknown>,
  name: string,
  field: RelationshipField,
  slots: RefSlot[],
): void {
  if (Array.isArray(field.relationTo)) {
    collectPolymorphicSingleSlot(container, name, slots)
    return
  }
  const targetColSlug = field.relationTo as string
  const val = container[name]
  if (typeof val === 'number' && val > 0) {
    slots.push({
      type: 'single',
      targetColSlug,
      targetId: val,
      assign: (populated) => {
        container[name] = populated
      },
    })
  } else if (val && typeof val === 'object' && !Array.isArray(val)) {
    collectLocalizedSingleSlots(val as Record<string, unknown>, targetColSlug, slots)
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

function addTargetId(
  idsByTarget: Map<string, Set<number>>,
  targetColSlug: string,
  id: number,
  seen: ReadonlySet<string>,
): void {
  if (seen.has(`${targetColSlug}:${id}`)) return
  let idSet = idsByTarget.get(targetColSlug)
  if (!idSet) {
    idSet = new Set<number>()
    idsByTarget.set(targetColSlug, idSet)
  }
  idSet.add(id)
}

function collectTargetIdsByCollection(
  slots: RefSlot[],
  seen: ReadonlySet<string>,
): Map<string, number[]> {
  const idsByTarget = new Map<string, Set<number>>()
  for (const slot of slots) {
    if (slot.type === 'single') {
      addTargetId(idsByTarget, slot.targetColSlug, slot.targetId, seen)
    } else if (slot.type === 'many') {
      for (const id of slot.targetIds) {
        addTargetId(idsByTarget, slot.targetColSlug, id, seen)
      }
    } else {
      for (const item of slot.items) {
        addTargetId(idsByTarget, item.relationTo, item.id, seen)
      }
    }
  }
  const result = new Map<string, number[]>()
  for (const [slug, idSet] of idsByTarget) {
    result.set(slug, Array.from(idSet))
  }
  return result
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

function assignPolyManySlot(
  slot: PolymorphicManyRefSlot,
  docsByTarget: Map<string, Map<number, DocumentData>>,
  accessibleTargets: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): void {
  const populated: Array<{ relationTo: string; value: DocumentData | number }> = []
  for (const item of slot.items) {
    if (!accessibleTargets.has(item.relationTo) || seen.has(`${item.relationTo}:${item.id}`)) {
      populated.push({ relationTo: item.relationTo, value: item.id })
      continue
    }
    const doc = docsByTarget.get(item.relationTo)?.get(item.id)
    if (doc) {
      populated.push({ relationTo: item.relationTo, value: doc })
    }
  }
  slot.assign(populated)
}

function assignSingleOrManySlot(
  slot: SingleRefSlot | ManyRefSlot,
  docsById: Map<number, DocumentData>,
  seen: ReadonlySet<string>,
): void {
  if (slot.type === 'single') {
    if (seen.has(`${slot.targetColSlug}:${slot.targetId}`)) {
      return
    }
    slot.assign(docsById.get(slot.targetId) ?? null)
    return
  }
  const populated = slot.targetIds
    .map((id) => {
      if (seen.has(`${slot.targetColSlug}:${id}`)) return id
      return docsById.get(id) ?? null
    })
    .filter((d): d is DocumentData | number => d !== null && d !== undefined)
  slot.assign(populated)
}

function assignAllSlots(
  slots: RefSlot[],
  docsByTarget: Map<string, Map<number, DocumentData>>,
  accessibleTargets: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): void {
  for (const slot of slots) {
    if (slot.type === 'poly-many') {
      assignPolyManySlot(slot, docsByTarget, accessibleTargets, seen)
      continue
    }
    if (!accessibleTargets.has(slot.targetColSlug)) {
      continue
    }
    const docsById = docsByTarget.get(slot.targetColSlug) ?? new Map<number, DocumentData>()
    assignSingleOrManySlot(slot, docsById, seen)
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
  targetIds: number[]
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

async function populateTargetCollection(
  args: PopulateTargetArgs,
): Promise<Map<number, DocumentData> | null> {
  const {
    targetCol,
    targetIds,
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
  if (!access) return null
  const { canDraftTarget, constraint } = access

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

  return docsById
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

  const idsByTarget = collectTargetIdsByCollection(slots, seen)
  const docsByTarget = new Map<string, Map<number, DocumentData>>()
  const accessibleTargets = new Set<string>()

  for (const [targetColSlug, targetIds] of idsByTarget) {
    const targetCol = collections.find((c) => c.slug === targetColSlug)
    if (!targetCol) continue

    const docsById = await populateTargetCollection({
      targetCol,
      targetIds,
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
    if (docsById) {
      accessibleTargets.add(targetColSlug)
      docsByTarget.set(targetColSlug, docsById)
    }
  }

  assignAllSlots(slots, docsByTarget, accessibleTargets, seen)
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
  const flatFields = flattenFields(collection.fields)
  if (!hasReferenceFields(flatFields)) return docs

  const docsToPopulate = filterDocsToPopulate(docs, collection.slug, seen)
  if (docsToPopulate.length === 0) return docs

  const slots: RefSlot[] = []
  for (const doc of docsToPopulate) {
    collectSlots(doc, flatFields, slots)
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
