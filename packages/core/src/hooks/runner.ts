import type { CollectionConfig, GlobalConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { AfterChangeHookArgs, AfterReadHookArgs, BeforeChangeHookArgs } from './types'

function isRecord(val: unknown): val is DocumentData {
  return typeof val === 'object' && val !== null
}

function getHooks<H>(collectionHooks?: readonly H[], globalHooks?: readonly H[]): readonly H[] {
  return collectionHooks ?? globalHooks ?? []
}

export async function runBeforeChangeHooks(args: {
  collection?: CollectionConfig
  global?: GlobalConfig
  data: DocumentData
  operation: 'create' | 'update'
  originalDoc?: DocumentData
  req?: Request
}): Promise<DocumentData> {
  const hooks = getHooks(args.collection?.hooks?.beforeChange, args.global?.hooks?.beforeChange)
  let currentData = args.data
  for (const hook of hooks) {
    const hookArgs: BeforeChangeHookArgs = {
      data: currentData,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (isRecord(result)) {
      currentData = result
    }
  }

  return currentData
}

export async function runAfterChangeHooks(args: {
  collection?: CollectionConfig
  global?: GlobalConfig
  doc: DocumentData
  operation: 'create' | 'update'
  previousDoc?: DocumentData
  req?: Request
}): Promise<DocumentData> {
  const hooks = getHooks(args.collection?.hooks?.afterChange, args.global?.hooks?.afterChange)
  let currentDoc = args.doc
  for (const hook of hooks) {
    const hookArgs: AfterChangeHookArgs = {
      doc: currentDoc,
      operation: args.operation,
      previousDoc: args.previousDoc,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (isRecord(result)) {
      currentDoc = result
    }
  }

  return currentDoc
}

export async function runAfterReadHooks(args: {
  collection?: CollectionConfig
  global?: GlobalConfig
  doc: DocumentData
  req?: Request
}): Promise<DocumentData> {
  const hooks = getHooks(args.collection?.hooks?.afterRead, args.global?.hooks?.afterRead)
  let currentDoc = args.doc
  for (const hook of hooks) {
    const hookArgs: AfterReadHookArgs = {
      doc: currentDoc,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (isRecord(result)) {
      currentDoc = result
    }
  }

  return currentDoc
}
