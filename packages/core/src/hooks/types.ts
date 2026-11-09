import type { DocStatus } from '../client/system-fields'
import type { DocumentData } from '../database/adapter'

export type DocStatusTransition = 'draft' | 'published' | 'publish' | 'unpublish'

export interface BeforeChangeHookArgs<T = DocumentData> {
  data: T
  req?: Request
  operation: 'create' | 'update'
  originalDoc?: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
}

export type BeforeChangeHook<T = DocumentData> = (
  args: BeforeChangeHookArgs<T>,
) => Promise<T | void> | T | void

export interface AfterChangeHookArgs<T = DocumentData> {
  doc: T
  previousDoc?: DocumentData
  req?: Request
  operation: 'create' | 'update'
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
}

export type AfterChangeHook<T = DocumentData> = (
  args: AfterChangeHookArgs<T>,
) => Promise<T | void> | T | void

export interface AfterReadHookArgs<T = DocumentData> {
  doc: T
  req?: Request
}

export type AfterReadHook<T = DocumentData> = (
  args: AfterReadHookArgs<T>,
) => Promise<T | void> | T | void

export interface CollectionHooks<T = DocumentData> {
  beforeChange?: BeforeChangeHook<T>[]
  afterChange?: AfterChangeHook<T>[]
  afterRead?: AfterReadHook<T>[]
}
