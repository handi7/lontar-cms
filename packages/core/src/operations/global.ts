import { checkAccess } from '../access'
import type { AuthUser } from '../auth/types'
import { clientFieldsToZod } from '../client/zod'
import { toClientGlobal } from '../config/to-client-config'
import type { GlobalConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import { runAfterReadHooks } from '../hooks'
import { AccessDeniedError, ValidationError } from './errors'
import { executeGlobalUpdate } from './mutation'
import type { FindGlobalOperationArgs, UpdateGlobalOperationArgs } from './types'

async function assertGlobalReadAccess(global: GlobalConfig, user?: AuthUser | null): Promise<void> {
  const allowed = await checkAccess(global.access?.read, { user: user ?? null })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

async function assertGlobalUpdateAccess(
  global: GlobalConfig,
  data: DocumentData,
  user?: AuthUser | null,
): Promise<void> {
  const allowed = await checkAccess(global.access?.update, { user: user ?? null, data })
  if (!allowed) {
    throw new AccessDeniedError('Access denied', { user })
  }
}

function validateGlobalData(
  global: GlobalConfig,
  data: DocumentData,
  originalDoc?: DocumentData,
): DocumentData {
  const clientGlobal = toClientGlobal(global)
  const schema = clientFieldsToZod(clientGlobal.fields, { partial: true, originalDoc })
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ValidationError('Validation failed', { issues: parsed.error.issues })
  }
  return parsed.data
}

export async function findGlobalOperation<T = DocumentData>(
  args: FindGlobalOperationArgs,
): Promise<T> {
  if (!args.overrideAccess) {
    await assertGlobalReadAccess(args.global, args.user)
  }

  const doc = await args.config.db.findGlobal({ global: args.global })
  const targetDoc = doc ?? {}
  const transformed = await runAfterReadHooks({
    global: args.global,
    doc: targetDoc,
    req: args.req,
  })

  return transformed as T
}

export async function updateGlobalOperation<T = DocumentData>(
  args: UpdateGlobalOperationArgs,
): Promise<T> {
  if (!args.overrideAccess) {
    await assertGlobalUpdateAccess(args.global, args.data, args.user)
  }

  const existing = await args.config.db.findGlobal({ global: args.global })
  const validatedData = validateGlobalData(args.global, args.data, existing ?? undefined)

  const result = await executeGlobalUpdate({
    global: args.global,
    db: args.config.db,
    existing,
    data: validatedData,
    req: args.req,
  })

  if (!result.success) {
    if (result.status === 400 && 'issues' in result.body) {
      throw new ValidationError('Validation failed', { issues: result.body.issues as unknown[] })
    }
    throw new Error(result.body.error ?? 'Global update failed')
  }

  return result.doc as T
}
