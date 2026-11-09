import type { DocStatus } from '../client/system-fields'
import type { CollectionConfig, GlobalConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type {
  AfterChangeHookArgs,
  AfterDeleteHookArgs,
  AfterReadHookArgs,
  BeforeChangeHookArgs,
  BeforeDeleteHookArgs,
  BeforeValidateHookArgs,
  DocStatusTransition,
} from './types'

function isRecord(val: unknown): val is DocumentData {
  return typeof val === 'object' && val !== null
}

function getHooks<H>(collectionHooks?: readonly H[], globalHooks?: readonly H[]): readonly H[] {
  return collectionHooks ?? globalHooks ?? []
}

export async function runBeforeValidateHooks(args: {
  collection?: CollectionConfig
  global?: GlobalConfig
  data: DocumentData
  operation: 'create' | 'update'
  originalDoc?: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  req?: Request
}): Promise<DocumentData> {
  const hooks = getHooks(args.collection?.hooks?.beforeValidate, args.global?.hooks?.beforeValidate)
  let currentData = args.data
  for (const hook of hooks) {
    const hookArgs: BeforeValidateHookArgs = {
      data: currentData,
      operation: args.operation,
      originalDoc: args.originalDoc,
      status: args.status,
      previousStatus: args.previousStatus,
      statusTransition: args.statusTransition,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (isRecord(result)) {
      currentData = result
    }
  }

  return currentData
}

export async function runBeforeChangeHooks(args: {
  collection?: CollectionConfig
  global?: GlobalConfig
  data: DocumentData
  operation: 'create' | 'update'
  originalDoc?: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  req?: Request
}): Promise<DocumentData> {
  const hooks = getHooks(args.collection?.hooks?.beforeChange, args.global?.hooks?.beforeChange)
  let currentData = args.data
  for (const hook of hooks) {
    const hookArgs: BeforeChangeHookArgs = {
      data: currentData,
      operation: args.operation,
      originalDoc: args.originalDoc,
      status: args.status,
      previousStatus: args.previousStatus,
      statusTransition: args.statusTransition,
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
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
  req?: Request
}): Promise<DocumentData> {
  const hooks = getHooks(args.collection?.hooks?.afterChange, args.global?.hooks?.afterChange)
  let currentDoc = args.doc
  for (const hook of hooks) {
    const hookArgs: AfterChangeHookArgs = {
      doc: currentDoc,
      operation: args.operation,
      previousDoc: args.previousDoc,
      status: args.status,
      previousStatus: args.previousStatus,
      statusTransition: args.statusTransition,
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

export async function runBeforeDeleteHooks(args: {
  collection?: CollectionConfig
  global?: GlobalConfig
  id: number
  doc: DocumentData
  status?: DocStatus
  req?: Request
}): Promise<void> {
  const hooks = getHooks(args.collection?.hooks?.beforeDelete, args.global?.hooks?.beforeDelete)
  for (const hook of hooks) {
    const hookArgs: BeforeDeleteHookArgs = {
      id: args.id,
      doc: args.doc,
      status: args.status,
      req: args.req,
    }
    await hook(hookArgs)
  }
}

export async function runAfterDeleteHooks(args: {
  collection?: CollectionConfig
  global?: GlobalConfig
  id: number
  doc: DocumentData
  status?: DocStatus
  req?: Request
}): Promise<DocumentData> {
  const hooks = getHooks(args.collection?.hooks?.afterDelete, args.global?.hooks?.afterDelete)
  let currentDoc = args.doc
  for (const hook of hooks) {
    const hookArgs: AfterDeleteHookArgs = {
      id: args.id,
      doc: currentDoc,
      status: args.status,
      req: args.req,
    }
    const result = await hook(hookArgs)
    if (isRecord(result)) {
      currentDoc = result
    }
  }

  return currentDoc
}
