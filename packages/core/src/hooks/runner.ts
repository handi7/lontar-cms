import type { CollectionConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { AfterChangeHookArgs, AfterReadHookArgs, BeforeChangeHookArgs } from './types'

export async function runBeforeChangeHooks(args: {
  collection: CollectionConfig
  data: DocumentData
  operation: 'create' | 'update'
  originalDoc?: DocumentData
  req?: Request
}): Promise<DocumentData> {
  const hooks = args.collection.hooks?.beforeChange
  if (!hooks || hooks.length === 0) return args.data

  let currentData = args.data
  for (const hook of hooks) {
    const hookArgs: BeforeChangeHookArgs = {
      data: currentData,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (result !== undefined && result !== null && typeof result === 'object') {
      currentData = result
    }
  }

  return currentData
}

export async function runAfterChangeHooks(args: {
  collection: CollectionConfig
  doc: DocumentData
  operation: 'create' | 'update'
  previousDoc?: DocumentData
  req?: Request
}): Promise<DocumentData> {
  const hooks = args.collection.hooks?.afterChange
  if (!hooks || hooks.length === 0) return args.doc

  let currentDoc = args.doc
  for (const hook of hooks) {
    const hookArgs: AfterChangeHookArgs = {
      doc: currentDoc,
      operation: args.operation,
      previousDoc: args.previousDoc,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (result !== undefined && result !== null && typeof result === 'object') {
      currentDoc = result
    }
  }

  return currentDoc
}

export async function runAfterReadHooks(args: {
  collection: CollectionConfig
  doc: DocumentData
  req?: Request
}): Promise<DocumentData> {
  const hooks = args.collection.hooks?.afterRead
  if (!hooks || hooks.length === 0) return args.doc

  let currentDoc = args.doc
  for (const hook of hooks) {
    const hookArgs: AfterReadHookArgs = {
      doc: currentDoc,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (result !== undefined && result !== null && typeof result === 'object') {
      currentDoc = result
    }
  }

  return currentDoc
}
