import { sanitizeConditionalFields } from '../client/condition'
import { toClientCollection, toClientGlobal } from '../config/to-client-config'
import type { CollectionConfig, GlobalConfig } from '../config/types'
import type { DatabaseAdapter, DocumentData, StoredDoc } from '../database/adapter'
import { formatUniqueConstraintError, UniqueConstraintError } from '../database/errors'
import { runAfterChangeHooks, runBeforeChangeHooks } from '../hooks'

export type MutationExecutionResult =
  | { success: true; doc: DocumentData }
  | { success: false; status: 400 | 404; body: { error: string; issues?: unknown[] } }

export function buildRevertData(
  originalDoc: DocumentData,
  appliedData: DocumentData,
): DocumentData {
  const revertData: DocumentData = { ...originalDoc }
  for (const key of Object.keys(appliedData)) {
    if (!(key in revertData)) {
      revertData[key] = null
    }
  }
  return revertData
}

export async function executeCreate(args: {
  collection: CollectionConfig
  db: DatabaseAdapter
  data: DocumentData
  req?: Request
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const initialData = sanitizeConditionalFields(clientCol.fields, args.data)
    const data = await runBeforeChangeHooks({
      collection: args.collection,
      data: initialData,
      operation: 'create',
      req: args.req,
    })
    const finalData = sanitizeConditionalFields(clientCol.fields, data)
    const created = await txDb.create({ collection: args.collection, data: finalData })
    try {
      const doc = await runAfterChangeHooks({
        collection: args.collection,
        doc: created,
        operation: 'create',
        req: args.req,
      })
      return { success: true, doc }
    } catch (hookErr) {
      if (!args.db.transaction) {
        try {
          await txDb.delete({ collection: args.collection, id: created.id })
        } catch {
          // Non-fatal compensation error
        }
      }
      throw hookErr
    }
  }

  try {
    if (args.db.transaction) {
      return await args.db.transaction(run)
    }
    return await run(args.db)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }
}

export async function executeUpdate(args: {
  collection: CollectionConfig
  db: DatabaseAdapter
  id: number
  originalDoc: DocumentData
  data: DocumentData
  req?: Request
}): Promise<MutationExecutionResult> {
  const clientCol = toClientCollection(args.collection)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const initialData = sanitizeConditionalFields(clientCol.fields, args.data, args.originalDoc)
    const data = await runBeforeChangeHooks({
      collection: args.collection,
      data: initialData,
      operation: 'update',
      originalDoc: args.originalDoc,
      req: args.req,
    })
    const finalData = sanitizeConditionalFields(clientCol.fields, data, args.originalDoc)
    const updated = await txDb.update({ collection: args.collection, id: args.id, data: finalData })
    if (!updated) {
      return {
        success: false,
        status: 404,
        body: { error: `Document with ID ${args.id} not found` },
      }
    }
    try {
      const doc = await runAfterChangeHooks({
        collection: args.collection,
        doc: updated,
        operation: 'update',
        previousDoc: args.originalDoc,
        req: args.req,
      })
      return { success: true, doc }
    } catch (hookErr) {
      if (!args.db.transaction) {
        try {
          await txDb.update({
            collection: args.collection,
            id: args.id,
            data: buildRevertData(args.originalDoc, data),
          })
        } catch {
          // Non-fatal compensation error
        }
      }
      throw hookErr
    }
  }

  try {
    if (args.db.transaction) {
      return await args.db.transaction(run)
    }
    return await run(args.db)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }
}

export async function executeGlobalUpdate(args: {
  global: GlobalConfig
  db: DatabaseAdapter
  existing: StoredDoc | null
  data: DocumentData
  req?: Request
}): Promise<MutationExecutionResult> {
  const clientGlobal = toClientGlobal(args.global)
  const run = async (txDb: DatabaseAdapter): Promise<MutationExecutionResult> => {
    const operation = args.existing ? 'update' : 'create'
    const initialData = sanitizeConditionalFields(
      clientGlobal.fields,
      args.data,
      args.existing ?? undefined,
    )
    const data = await runBeforeChangeHooks({
      global: args.global,
      data: initialData,
      operation,
      originalDoc: args.existing ?? undefined,
      req: args.req,
    })
    const finalData = sanitizeConditionalFields(
      clientGlobal.fields,
      data,
      args.existing ?? undefined,
    )
    const saved = await txDb.updateGlobal({ global: args.global, data: finalData })
    const doc = await runAfterChangeHooks({
      global: args.global,
      doc: saved,
      operation,
      previousDoc: args.existing ?? undefined,
      req: args.req,
    })
    return { success: true, doc }
  }

  try {
    if (args.db.transaction) {
      return await args.db.transaction(run)
    }
    return await run(args.db)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return { success: false, status: 400, body: formatUniqueConstraintError(err) }
    }
    throw err
  }
}
