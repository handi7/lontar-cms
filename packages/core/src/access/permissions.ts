import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { ArrayField, BlocksField, Field, Fields, GroupField } from '../fields/types'
import type {
  CollectionPermission,
  FieldPermission,
  GlobalPermission,
  PermissionsResponse,
} from '../client/permissions'
import { matchesConstraint, resolveAccess, type ConstrainedOperation } from './constraint'
import { checkAccess } from './index'
import {
  checkFieldAccess,
  createFieldAccessCache,
  getFieldAccessCache,
  type FieldAccessCache,
} from './field-access'

export type { CollectionPermission, FieldPermission, GlobalPermission, PermissionsResponse }

interface EvalContext {
  /** Needed to evaluate a row-level constraint (ADR 0030). */
  config?: Config
  user: AuthUser | null
  id?: number
  doc?: DocumentData
  data?: DocumentData
  siblingData?: unknown
  req?: Request
  cache?: FieldAccessCache
}

interface AllowedTriad {
  read: boolean
  create: boolean
  update: boolean
}

async function evalFieldPermission(
  field: Field,
  args: {
    user: AuthUser | null
    id?: number
    doc?: DocumentData
    data?: DocumentData
    siblingData?: unknown
    req?: Request
  },
  parentAllowed: AllowedTriad = { read: true, create: true, update: true },
  cache?: FieldAccessCache,
): Promise<AllowedTriad> {
  const read = parentAllowed.read ? await checkFieldAccess(field.access?.read, args, cache) : false
  const create = parentAllowed.create
    ? await checkFieldAccess(
        field.access?.create,
        {
          user: args.user,
          req: args.req,
          siblingData: args.siblingData,
        },
        cache,
      )
    : false
  const update = parentAllowed.update
    ? await checkFieldAccess(field.access?.update, args, cache)
    : false
  return { read, create, update }
}

async function evalGroupFields(
  field: GroupField,
  key: string,
  prefix: string,
  ctx: EvalContext,
  parentAllowed: AllowedTriad,
  flatPerms: Record<string, FieldPermission>,
): Promise<FieldPermission> {
  const groupData =
    ctx.doc && typeof ctx.doc[key] === 'object' && ctx.doc[key] !== null
      ? (ctx.doc[key] as DocumentData)
      : undefined

  const groupPerm = await evalFieldPermission(
    field,
    { ...ctx, siblingData: groupData },
    parentAllowed,
  )

  const childPerms: Record<string, FieldPermission> = {}
  for (const [childKey, childField] of Object.entries(field.fields)) {
    const childPerm = await evalSingleField(
      childField,
      childKey,
      `${prefix}${key}.${childKey}`,
      `${prefix}${key}.`,
      { ...ctx, siblingData: groupData ?? {} },
      groupPerm,
      flatPerms,
    )
    childPerms[childKey] = childPerm
  }

  const result: FieldPermission = { ...groupPerm, fields: childPerms }
  flatPerms[`${prefix}${key}`] = result
  return result
}

async function evalArrayRows(
  field: ArrayField,
  key: string,
  prefix: string,
  ctx: EvalContext,
  arrayPerm: AllowedTriad,
  flatPerms: Record<string, FieldPermission>,
): Promise<void> {
  if (!ctx.doc || !Array.isArray(ctx.doc[key])) return
  const rows = ctx.doc[key] as Array<Record<string, unknown>>
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    for (const [rowKey, rowField] of Object.entries(field.fields)) {
      const rowPerm = await evalFieldPermission(rowField, { ...ctx, siblingData: row }, arrayPerm)
      flatPerms[`${prefix}${key}.${i}.${rowKey}`] = rowPerm
    }
  }
}

async function evalArrayFields(
  field: ArrayField,
  key: string,
  prefix: string,
  ctx: EvalContext,
  parentAllowed: AllowedTriad,
  flatPerms: Record<string, FieldPermission>,
): Promise<FieldPermission> {
  const arrayPerm = await evalFieldPermission(
    field,
    { ...ctx, siblingData: ctx.doc?.[key] },
    parentAllowed,
  )

  const childPerms: Record<string, FieldPermission> = {}
  for (const [childKey, childField] of Object.entries(field.fields)) {
    const childPerm = await evalFieldPermission(
      childField,
      { ...ctx, siblingData: undefined },
      arrayPerm,
    )
    childPerms[childKey] = childPerm
    flatPerms[`${prefix}${key}.${childKey}`] = childPerm
  }

  await evalArrayRows(field, key, prefix, ctx, arrayPerm, flatPerms)

  const result: FieldPermission = { ...arrayPerm, fields: childPerms }
  flatPerms[`${prefix}${key}`] = result
  return result
}

async function evalBlockItems(
  field: BlocksField,
  key: string,
  prefix: string,
  ctx: EvalContext,
  blocksPerm: AllowedTriad,
  flatPerms: Record<string, FieldPermission>,
): Promise<void> {
  if (!ctx.doc || !Array.isArray(ctx.doc[key])) return
  const items = ctx.doc[key] as Array<{ blockType?: string; [k: string]: unknown }>
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const blockDef = field.blocks.find((b) => b.slug === item?.blockType)
    if (!blockDef) continue
    for (const [fieldKey, blockField] of Object.entries(blockDef.fields)) {
      const itemFieldPerm = await evalFieldPermission(
        blockField,
        { ...ctx, siblingData: item },
        blocksPerm,
      )
      flatPerms[`${prefix}${key}.${i}.${fieldKey}`] = itemFieldPerm
    }
  }
}

async function evalBlocksFields(
  field: BlocksField,
  key: string,
  prefix: string,
  ctx: EvalContext,
  parentAllowed: AllowedTriad,
  flatPerms: Record<string, FieldPermission>,
): Promise<FieldPermission> {
  const blocksPerm = await evalFieldPermission(
    field,
    { ...ctx, siblingData: ctx.doc?.[key] },
    parentAllowed,
  )

  const blocksObj: Record<string, { fields: Record<string, FieldPermission> }> = {}
  for (const block of field.blocks) {
    const blockFieldsObj: Record<string, FieldPermission> = {}
    for (const [fieldKey, blockField] of Object.entries(block.fields)) {
      const fieldPerm = await evalFieldPermission(
        blockField,
        { ...ctx, siblingData: undefined },
        blocksPerm,
      )
      blockFieldsObj[fieldKey] = fieldPerm
      flatPerms[`${prefix}${key}.${block.slug}.${fieldKey}`] = fieldPerm
    }
    blocksObj[block.slug] = { fields: blockFieldsObj }
  }

  await evalBlockItems(field, key, prefix, ctx, blocksPerm, flatPerms)

  const result: FieldPermission = { ...blocksPerm, blocks: blocksObj }
  flatPerms[`${prefix}${key}`] = result
  return result
}

async function evalSingleField(
  field: Field,
  key: string,
  _flatKey: string,
  prefix: string,
  ctx: EvalContext,
  parentAllowed: AllowedTriad,
  flatPerms: Record<string, FieldPermission>,
): Promise<FieldPermission> {
  if (field.type === 'group') {
    return evalGroupFields(field, key, prefix, ctx, parentAllowed, flatPerms)
  }
  if (field.type === 'array') {
    return evalArrayFields(field, key, prefix, ctx, parentAllowed, flatPerms)
  }
  if (field.type === 'blocks') {
    return evalBlocksFields(field, key, prefix, ctx, parentAllowed, flatPerms)
  }

  const perm = await evalFieldPermission(
    field,
    // Inside a group `ctx.siblingData` is the group's data; only at the root does it fall back to the document.
    { ...ctx, siblingData: ctx.siblingData ?? ctx.doc },
    parentAllowed,
    ctx.cache,
  )
  flatPerms[`${prefix}${key}`] = perm
  return perm
}

export async function evalFieldsPermissions(
  fields: Fields,
  ctx: EvalContext,
): Promise<Record<string, FieldPermission>> {
  const flatPerms: Record<string, FieldPermission> = {}
  const rootAllowed = { read: true, create: true, update: true }
  const cache = ctx.cache ?? (ctx.req ? getFieldAccessCache(ctx.req) : createFieldAccessCache())
  const resolvedCtx = { ...ctx, cache }

  for (const [key, field] of Object.entries(fields)) {
    await evalSingleField(field, key, key, '', resolvedCtx, rootAllowed, flatPerms)
  }

  return flatPerms
}

interface RowOutcome {
  allowed: boolean
  /** True when the answer is "some documents" because no document was named. */
  constrained: boolean
}

// One operation for the collection (no `id`), or for one document. A boolean is the answer. A
// constraint is "some documents" for the collection, and for a document it is whether that stored
// row matches it (ADR 0030 §10).
async function evalRowOutcome(
  collection: CollectionConfig,
  operation: ConstrainedOperation,
  ctx: EvalContext,
): Promise<RowOutcome> {
  const decision = await resolveAccess(
    collection,
    operation,
    { user: ctx.user, id: ctx.id, data: ctx.doc },
    ctx.config ?? {},
  )
  if (!decision.allowed) return { allowed: false, constrained: false }
  if (!decision.constraint) return { allowed: true, constrained: false }
  if (ctx.id === undefined || !ctx.config) return { allowed: true, constrained: true }
  const matches = await matchesConstraint({
    config: ctx.config,
    collection,
    id: ctx.id,
    constraint: decision.constraint,
  })
  return { allowed: matches, constrained: false }
}

export async function getDocumentPermissions(
  collection: CollectionConfig,
  ctx: EvalContext,
): Promise<CollectionPermission> {
  const [create, read, update, del] = await Promise.all([
    checkAccess(collection.access?.create, { user: ctx.user }),
    evalRowOutcome(collection, 'read', ctx),
    evalRowOutcome(collection, 'update', ctx),
    evalRowOutcome(collection, 'delete', ctx),
  ])

  const readVersions = Boolean(collection.versions) && read.allowed && update.allowed
  const fields = await evalFieldsPermissions(collection.fields, ctx)
  const constrained = {
    ...(read.constrained ? { read: true } : {}),
    ...(update.constrained ? { update: true } : {}),
    ...(del.constrained ? { delete: true } : {}),
  }

  return {
    create,
    read: read.allowed,
    update: update.allowed,
    delete: del.allowed,
    readVersions,
    ...(Object.keys(constrained).length > 0 ? { constrained } : {}),
    fields,
  }
}

export async function getGlobalPermissions(
  global: GlobalConfig,
  ctx: EvalContext,
): Promise<GlobalPermission> {
  const user = ctx.user
  const doc = ctx.doc

  const [read, update] = await Promise.all([
    checkAccess(global.access?.read, { user, data: doc }),
    checkAccess(global.access?.update, { user, data: doc }),
  ])

  const readVersions = Boolean(global.versions) && read && update
  const fields = await evalFieldsPermissions(global.fields, ctx)

  return {
    read,
    update,
    readVersions,
    fields,
  }
}

function resolvePermissionsCache(options?: {
  req?: Request
  cache?: FieldAccessCache
}): FieldAccessCache {
  if (options?.cache) return options.cache
  if (options?.req) return getFieldAccessCache(options.req)
  return createFieldAccessCache()
}

async function collectGlobalsPermissions(
  config: Config,
  user: AuthUser | null,
  cache: FieldAccessCache,
  req?: Request,
): Promise<Record<string, GlobalPermission>> {
  const globals: Record<string, GlobalPermission> = {}
  for (const glob of config.globals ?? []) {
    let doc: DocumentData | undefined
    try {
      doc = (await config.db.findGlobal({ global: glob })) ?? undefined
    } catch {
      doc = undefined
    }
    globals[glob.slug] = await getGlobalPermissions(glob, {
      user,
      doc,
      req,
      cache,
    })
  }
  return globals
}

export async function getPermissions(
  config: Config,
  user: AuthUser | null,
  options?: { req?: Request; cache?: FieldAccessCache },
): Promise<PermissionsResponse> {
  const collections: Record<string, CollectionPermission> = {}
  const cache = resolvePermissionsCache(options)

  for (const col of config.collections ?? []) {
    collections[col.slug] = await getDocumentPermissions(col, {
      config,
      user,
      req: options?.req,
      cache,
    })
  }

  const globals = await collectGlobalsPermissions(config, user, cache, options?.req)
  const views = await collectViewPermissions(config, user, options?.req)
  return { collections, globals, ...(views ? { views } : {}) }
}

/** Omitted `access` means any authenticated user, as for custom endpoints (ADR 0029). */
async function collectViewPermissions(
  config: Config,
  user: AuthUser | null,
  req?: Request,
): Promise<Record<string, boolean> | undefined> {
  const configured = config.admin?.views
  if (!configured || configured.length === 0) return undefined
  const views: Record<string, boolean> = {}
  for (const view of configured) {
    views[view.key] = view.access ? await checkAccess(view.access, { user, req }) : user !== null
  }
  return views
}
