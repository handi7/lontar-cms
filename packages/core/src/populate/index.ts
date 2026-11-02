import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import type { CollectionConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData } from '../database/adapter'
import type { RelationshipField, UploadField } from '../fields/types'
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
}

function collectManyIds(
  val: unknown,
  ids: Set<number>,
  targetColSlug: string,
  seen: ReadonlySet<string>,
): void {
  if (!Array.isArray(val)) return
  for (const item of val) {
    if (typeof item === 'number' && item > 0 && !seen.has(`${targetColSlug}:${item}`)) {
      ids.add(item)
    }
  }
}

function extractTargetIds(
  docs: DocumentData[],
  fieldName: string,
  hasMany: boolean,
  targetColSlug: string,
  seen: ReadonlySet<string>,
): number[] {
  const ids = new Set<number>()
  for (const doc of docs) {
    const val = doc[fieldName]
    if (hasMany) {
      collectManyIds(val, ids, targetColSlug, seen)
    } else if (typeof val === 'number' && val > 0 && !seen.has(`${targetColSlug}:${val}`)) {
      ids.add(val)
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

function assignManyField(
  doc: DocumentData,
  fieldName: string,
  targetColSlug: string,
  docsById: Map<number, DocumentData>,
  seen: ReadonlySet<string>,
): void {
  const current = doc[fieldName]
  if (!Array.isArray(current)) {
    doc[fieldName] = []
    return
  }
  doc[fieldName] = current
    .map((id) => {
      if (typeof id !== 'number') return null
      if (seen.has(`${targetColSlug}:${id}`)) return id
      return docsById.get(id) ?? null
    })
    .filter((d): d is DocumentData | number => d !== null && d !== undefined)
}

function assignSingleField(
  doc: DocumentData,
  fieldName: string,
  targetColSlug: string,
  docsById: Map<number, DocumentData>,
  seen: ReadonlySet<string>,
): void {
  const current = doc[fieldName]
  if (typeof current === 'number' && current > 0) {
    if (seen.has(`${targetColSlug}:${current}`)) return
    doc[fieldName] = docsById.get(current) ?? null
    return
  }
  doc[fieldName] = null
}

function assignPopulatedField(
  doc: DocumentData,
  fieldName: string,
  hasMany: boolean,
  targetColSlug: string,
  docsById: Map<number, DocumentData>,
  seen: ReadonlySet<string>,
): void {
  if (hasMany) {
    assignManyField(doc, fieldName, targetColSlug, docsById, seen)
  } else {
    assignSingleField(doc, fieldName, targetColSlug, docsById, seen)
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
  })
  for (const child of populatedChildren) {
    if (typeof child.id === 'number') {
      docsById.set(child.id, child)
    }
  }
}

interface PopulateFieldArgs {
  fieldName: string
  field: RelationshipField | UploadField
  docs: DocumentData[]
  collection: CollectionConfig
  depth: number
  collections: readonly CollectionConfig[]
  db: DatabaseAdapter
  user: AuthUser | null
  req?: Request
  seen: ReadonlySet<string>
}

async function populateField(args: PopulateFieldArgs): Promise<void> {
  const { fieldName, field, docs, collection, depth, collections, db, user, req, seen } = args
  const targetCol = collections.find((c) => c.slug === field.relationTo)
  if (!targetCol) return

  const canRead = await checkAccess(targetCol.access?.read, { user })
  if (!canRead) return

  const hasMany = field.type === 'relationship' ? Boolean(field.hasMany) : false
  const targetIds = extractTargetIds(docs, fieldName, hasMany, targetCol.slug, seen)
  const docsById = await fetchTargetDocs(targetCol, targetIds, db, req)

  if (depth > 1 && docsById.size > 0) {
    await populateChildren(
      targetCol,
      docsById,
      docs,
      collection,
      depth,
      collections,
      db,
      user,
      req,
      seen,
    )
  }

  for (const doc of docs) {
    assignPopulatedField(doc, fieldName, hasMany, targetCol.slug, docsById, seen)
  }
}

export async function populateDocs(options: PopulateOptions): Promise<DocumentData[]> {
  const { docs, collection, depth, collections, db, user = null, req, seen = new Set() } = options
  if (depth <= 0 || docs.length === 0) return docs

  const relFields = Object.entries(collection.fields).filter(
    ([, field]) => field.type === 'relationship' || field.type === 'upload',
  ) as Array<[string, RelationshipField | UploadField]>

  if (relFields.length === 0) return docs

  const docsToPopulate = docs.filter((doc) => {
    return typeof doc.id !== 'number' || !seen.has(`${collection.slug}:${doc.id}`)
  })
  if (docsToPopulate.length === 0) return docs

  for (const [fieldName, field] of relFields) {
    await populateField({
      fieldName,
      field,
      docs: docsToPopulate,
      collection,
      depth,
      collections,
      db,
      user,
      req,
      seen,
    })
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
