import { combineWhere, constraintOf, resolveAccess, sanitizeDocRead } from '../access'
import { checkFieldAccess, type FieldAccessCache } from '../access/field-access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config } from '../config/types'
import type { Where } from '../query/types'
import type { DatabaseAdapter, DocumentData, JoinFieldResult } from '../database/adapter'
import type {
  ArrayField,
  BlocksField,
  Field,
  GroupField,
  JoinField,
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
  parentCollection: { slug: string; fields: Record<string, Field> } | CollectionConfig
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

function hasJoinFields(fields: Record<string, Field>): boolean {
  return Object.values(fields).some((field) => field.type === 'join')
}

function initSkippedJoinFields(
  docs: DocumentData[],
  docsToPopulate: DocumentData[],
  flatFields: Record<string, Field>,
): void {
  const populatedSet = new Set(docsToPopulate)
  const joinNames = Object.entries(flatFields)
    .filter(([, f]) => f.type === 'join')
    .map(([name]) => name)
  if (joinNames.length === 0) return
  for (const doc of docs) {
    if (populatedSet.has(doc)) continue
    for (const name of joinNames) {
      if (doc[name] === undefined) {
        doc[name] = { docs: [], totalDocs: 0 }
      }
    }
  }
}

function getByDotPath(obj: Record<string, unknown>, dotPath: string): unknown {
  if (!dotPath.includes('.')) return obj[dotPath]
  let cur: unknown = obj
  for (const part of dotPath.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function resolveJoinOnTargetField(fields: Record<string, Field>, on: string): Field | undefined {
  const flat = flattenFields(fields)
  if (!on.includes('.')) return flat[on]
  let current = flat
  const parts = on.split('.')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) return undefined
    const f = current[part]
    if (!f) return undefined
    if (i === parts.length - 1) return f
    if (f.type !== 'group') return undefined
    current = flattenFields(f.fields)
  }
  return undefined
}

function extractMatchingParentIds(
  val: unknown,
  sourceCollection: string,
  parentIdSet: ReadonlySet<number>,
): number[] {
  if (typeof val === 'number') {
    return parentIdSet.has(val) ? [val] : []
  }
  if (Array.isArray(val)) {
    const matched: number[] = []
    for (const item of val) {
      matched.push(...extractMatchingParentIds(item, sourceCollection, parentIdSet))
    }
    return matched
  }
  if (val && typeof val === 'object') {
    const ref = parsePolymorphicRef(val)
    if (ref && ref.relationTo === sourceCollection && parentIdSet.has(ref.id)) {
      return [ref.id]
    }
  }
  return []
}

async function fetchJoinedViaFind(args: {
  db: DatabaseAdapter
  targetCol: CollectionConfig
  on: string
  sourceCollection: string
  parentIds: number[]
  where?: Where
  sort?: string
  limit: number
  includeDocs: boolean
  locale?: string
  fallbackLocale?: string | false
}): Promise<Map<number, JoinFieldResult<DocumentData>>> {
  const targetField = resolveJoinOnTargetField(args.targetCol.fields, args.on)
  const isPoly = targetField?.type === 'relationship' && Array.isArray(targetField.relationTo)
  const linkWhere: Where = isPoly
    ? {
        [args.on]: { relationTo: { equals: args.sourceCollection }, value: { in: args.parentIds } },
      }
    : { [args.on]: { in: args.parentIds } }

  const res = await args.db.find({
    collection: args.targetCol,
    where: combineWhere(linkWhere, args.where),
    sort: args.sort,
    page: 1,
    limit: 0,
    overrideLimit: true,
    locale: args.locale,
    fallbackLocale: args.fallbackLocale,
  })

  const parentIdSet = new Set(args.parentIds)
  const grouped = new Map<number, DocumentData[]>()
  for (const pid of args.parentIds) {
    grouped.set(pid, [])
  }
  for (const doc of res.docs) {
    const matchedPids = extractMatchingParentIds(
      getByDotPath(doc, args.on),
      args.sourceCollection,
      parentIdSet,
    )
    for (const pid of new Set(matchedPids)) {
      grouped.get(pid)?.push({ ...doc })
    }
  }

  const results = new Map<number, JoinFieldResult<DocumentData>>()
  for (const [pid, matchedDocs] of grouped) {
    results.set(pid, {
      docs: args.includeDocs ? matchedDocs.slice(0, args.limit) : [],
      totalDocs: matchedDocs.length,
    })
  }
  return results
}

async function filterEligibleJoinDocs(
  docsToPopulate: DocumentData[],
  joinField: JoinField,
  user: AuthUser | null,
  overrideAccess?: boolean,
  cache?: FieldAccessCache,
  req?: Request,
  locale?: string,
): Promise<DocumentData[]> {
  const numericDocs = docsToPopulate.filter((d) => typeof d.id === 'number')
  if (overrideAccess || !joinField.access?.read) {
    return numericDocs
  }
  const eligible: DocumentData[] = []
  for (const doc of numericDocs) {
    const allowed = await checkFieldAccess(
      joinField.access.read,
      {
        user,
        id: doc.id as number,
        data: doc,
        siblingData: doc,
        doc,
        req,
        locale,
      },
      cache,
    )
    if (allowed) {
      eligible.push(doc)
    }
  }
  return eligible
}

async function transformJoinedDocs(args: {
  joinedByParent: Map<number, JoinFieldResult<DocumentData>>
  targetCol: CollectionConfig
  parentDocs: DocumentData[]
  parentCollection: { slug: string; fields: Record<string, Field> } | CollectionConfig
  depth: number
  collections: readonly CollectionConfig[]
  db: DatabaseAdapter
  user: AuthUser | null
  req?: Request
  seen: ReadonlySet<string>
  overrideAccess?: boolean
  canDraftTarget: boolean
  cache?: FieldAccessCache
  locale?: string
  fallbackLocale?: string | false
  localization?: Config['localization']
}): Promise<void> {
  const flatDocs: Array<{ parentId: number; index: number; doc: DocumentData }> = []
  for (const [parentId, entry] of args.joinedByParent) {
    entry.docs.forEach((doc, index) => {
      flatDocs.push({ parentId, index, doc })
    })
  }
  if (flatDocs.length === 0) return

  const localeCtx: ProjectLocaleContext | undefined = args.locale
    ? { locale: args.locale, fallbackLocale: args.fallbackLocale }
    : undefined

  let processed = await hydrateTargetDraftDocs(
    args.targetCol,
    flatDocs.map((item) => item.doc),
    args.db,
    args.canDraftTarget,
    localeCtx,
  )
  processed = await Promise.all(
    processed.map((doc) =>
      runAfterReadHooks({ collection: args.targetCol, doc, req: args.req, locale: args.locale }),
    ),
  )

  const targetHasJoins = hasJoinFields(flattenFields(args.targetCol.fields))
  if (args.depth > 1 || targetHasJoins) {
    const nextSeen = new Set(args.seen)
    for (const d of args.parentDocs) {
      if (typeof d.id === 'number') {
        nextSeen.add(`${args.parentCollection.slug}:${d.id}`)
      }
    }
    processed = await populateDocs({
      docs: processed,
      collection: args.targetCol,
      depth: args.depth - 1,
      collections: args.collections,
      db: args.db,
      user: args.user,
      req: args.req,
      seen: nextSeen,
      overrideAccess: args.overrideAccess,
      draft: args.canDraftTarget,
      cache: args.cache,
      locale: args.locale,
      fallbackLocale: args.fallbackLocale,
      localization: args.localization,
    })
  }

  if (!args.overrideAccess) {
    processed = await Promise.all(
      processed.map((doc) =>
        sanitizeDocRead(args.targetCol.fields, doc, args.user, {
          id: doc.id as string | number | undefined,
          doc,
          cache: args.cache,
          req: args.req,
          locale: args.locale,
        }),
      ),
    )
  }

  flatDocs.forEach((item, idx) => {
    const entry = args.joinedByParent.get(item.parentId)
    if (entry && processed[idx]) {
      entry.docs[item.index] = processed[idx]!
    }
  })
}

async function fetchJoinBatchResults(args: {
  db: DatabaseAdapter
  targetCol: CollectionConfig
  joinField: JoinField
  sourceCollection: string
  parentIds: number[]
  effectiveWhere?: Where
  includeDocs: boolean
  locale?: string
  fallbackLocale?: string | false
}): Promise<Map<number, JoinFieldResult<DocumentData>>> {
  const limit = args.joinField.limit ?? 10
  if (args.db.findJoined) {
    return args.db.findJoined({
      collection: args.targetCol,
      on: args.joinField.on,
      sourceCollection: args.sourceCollection,
      parentIds: args.parentIds,
      where: args.effectiveWhere,
      sort: args.joinField.sort,
      limit,
      includeDocs: args.includeDocs,
      locale: args.locale,
      fallbackLocale: args.fallbackLocale,
    })
  }
  return fetchJoinedViaFind({
    db: args.db,
    targetCol: args.targetCol,
    on: args.joinField.on,
    sourceCollection: args.sourceCollection,
    parentIds: args.parentIds,
    where: args.effectiveWhere,
    sort: args.joinField.sort,
    limit,
    includeDocs: args.includeDocs,
    locale: args.locale,
    fallbackLocale: args.fallbackLocale,
  })
}

function assignJoinResults(
  docs: DocumentData[],
  joinName: string,
  joinedByParent?: Map<number, JoinFieldResult<DocumentData>>,
): void {
  for (const doc of docs) {
    const pid = doc.id as number
    const res = joinedByParent?.get(pid)
    doc[joinName] = res ? { docs: res.docs, totalDocs: res.totalDocs } : { docs: [], totalDocs: 0 }
  }
}

async function populateSingleJoinField(args: {
  joinName: string
  joinField: JoinField
  docsToPopulate: DocumentData[]
  collection: { slug: string; fields: Record<string, Field> } | CollectionConfig
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
  localization?: Config['localization']
}): Promise<void> {
  const { joinName, joinField, docsToPopulate, collection, depth } = args
  const targetCol = args.collections.find((c) => c.slug === joinField.collection)
  if (!targetCol) {
    assignJoinResults(docsToPopulate, joinName)
    return
  }

  const eligibleDocs = await filterEligibleJoinDocs(
    docsToPopulate,
    joinField,
    args.user,
    args.overrideAccess,
    args.cache,
    args.req,
    args.locale,
  )
  if (eligibleDocs.length === 0) return

  const targetAccess = await resolveTargetAccess({
    targetCol,
    user: args.user,
    locale: args.locale,
    localization: args.localization,
    overrideAccess: args.overrideAccess,
    draft: args.draft,
  })
  if (!targetAccess) {
    assignJoinResults(eligibleDocs, joinName)
    return
  }

  const publishedFilter: Where | undefined =
    targetCol.versions?.drafts && !targetAccess.canDraftTarget
      ? { _status: { equals: 'published' } }
      : undefined
  const effectiveWhere = combineWhere(
    combineWhere(joinField.where, targetAccess.constraint),
    publishedFilter,
  )
  const parentIds = Array.from(new Set(eligibleDocs.map((d) => d.id as number)))
  const includeDocs = depth >= 1

  const joinedByParent = await fetchJoinBatchResults({
    db: args.db,
    targetCol,
    joinField,
    sourceCollection: collection.slug,
    parentIds,
    effectiveWhere,
    includeDocs,
    locale: args.locale,
    fallbackLocale: args.fallbackLocale,
  })

  if (includeDocs) {
    await transformJoinedDocs({
      joinedByParent,
      targetCol,
      parentDocs: eligibleDocs,
      parentCollection: collection,
      depth,
      collections: args.collections,
      db: args.db,
      user: args.user,
      req: args.req,
      seen: args.seen,
      overrideAccess: args.overrideAccess,
      canDraftTarget: targetAccess.canDraftTarget,
      cache: args.cache,
      locale: args.locale,
      fallbackLocale: args.fallbackLocale,
      localization: args.localization,
    })
  }

  assignJoinResults(eligibleDocs, joinName, joinedByParent)
}

async function populateAllJoins(args: {
  docsToPopulate: DocumentData[]
  flatFields: Record<string, Field>
  collection: { slug: string; fields: Record<string, Field> } | CollectionConfig
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
  localization?: Config['localization']
}): Promise<void> {
  for (const [joinName, field] of Object.entries(args.flatFields)) {
    if (field.type !== 'join') continue
    await populateSingleJoinField({
      ...args,
      joinName,
      joinField: field,
    })
  }
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
  collection: { slug: string; fields: Record<string, Field> } | CollectionConfig
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

async function populateReferenceSlots(
  docsToPopulate: DocumentData[],
  flatFields: Record<string, Field>,
  options: Omit<PopulateOptions, 'docs'> & { user: AuthUser | null; seen: ReadonlySet<string> },
): Promise<void> {
  const slots: RefSlot[] = []
  for (const doc of docsToPopulate) {
    collectSlots(doc, flatFields, slots)
  }
  if (slots.length === 0) return
  await populateAllTargets({
    slots,
    docsToPopulate,
    collection: options.collection,
    depth: options.depth,
    collections: options.collections,
    db: options.db,
    user: options.user,
    req: options.req,
    seen: options.seen,
    overrideAccess: options.overrideAccess,
    draft: options.draft,
    cache: options.cache,
    locale: options.locale,
    fallbackLocale: options.fallbackLocale,
    localization: options.localization,
  })
}

async function populateJoinFieldsForDocs(
  docsToPopulate: DocumentData[],
  flatFields: Record<string, Field>,
  options: Omit<PopulateOptions, 'docs'> & { user: AuthUser | null; seen: ReadonlySet<string> },
): Promise<void> {
  await populateAllJoins({
    docsToPopulate,
    flatFields,
    collection: options.collection,
    depth: options.depth,
    collections: options.collections,
    db: options.db,
    user: options.user,
    req: options.req,
    seen: options.seen,
    overrideAccess: options.overrideAccess,
    draft: options.draft,
    cache: options.cache,
    locale: options.locale,
    fallbackLocale: options.fallbackLocale,
    localization: options.localization,
  })
}

function prepareDocsToPopulate(
  docs: DocumentData[],
  collectionSlug: string,
  flatFields: Record<string, Field>,
  hasJoins: boolean,
  seen: ReadonlySet<string>,
): DocumentData[] {
  const docsToPopulate = filterDocsToPopulate(docs, collectionSlug, seen)
  if (hasJoins) {
    initSkippedJoinFields(docs, docsToPopulate, flatFields)
  }
  return docsToPopulate
}

export async function populateDocs(options: PopulateOptions): Promise<DocumentData[]> {
  const { docs, collection, depth } = options
  if (docs.length === 0) return docs

  const flatFields = flattenFields(collection.fields)
  const hasRefs = depth > 0 && hasReferenceFields(flatFields)
  const hasJoins = hasJoinFields(flatFields)
  if (!hasRefs && !hasJoins) return docs

  const user = options.user ?? null
  const seen = options.seen ?? new Set<string>()
  const docsToPopulate = prepareDocsToPopulate(docs, collection.slug, flatFields, hasJoins, seen)
  if (docsToPopulate.length === 0) return docs

  const passOpts = { ...options, user, seen }
  if (hasRefs) {
    await populateReferenceSlots(docsToPopulate, flatFields, passOpts)
  }
  if (hasJoins) {
    await populateJoinFieldsForDocs(docsToPopulate, flatFields, passOpts)
  }

  return docs
}

export async function populateDoc(
  doc: DocumentData,
  options: Omit<PopulateOptions, 'docs'>,
): Promise<DocumentData> {
  const [populated] = await populateDocs({ ...options, docs: [doc] })
  return populated ?? doc
}
