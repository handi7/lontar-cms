import type { DocStatus } from '../client/system-fields'
import type { DocumentData } from '../database/adapter'

export type DocStatusTransition = 'draft' | 'published' | 'publish' | 'unpublish'

export interface BeforeValidateHookArgs<T = DocumentData> {
  data: T
  req?: Request
  operation: 'create' | 'update'
  originalDoc?: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  statusTransition?: DocStatusTransition
}

export type BeforeValidateHook<T = DocumentData> = (
  args: BeforeValidateHookArgs<T>,
) => Promise<T | void> | T | void

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

export interface BeforeDeleteHookArgs<T = DocumentData> {
  id: number
  doc: T
  req?: Request
  status?: DocStatus
}

export type BeforeDeleteHook<T = DocumentData> = (
  args: BeforeDeleteHookArgs<T>,
) => Promise<void> | void

export interface AfterDeleteHookArgs<T = DocumentData> {
  id: number
  doc: T
  req?: Request
  status?: DocStatus
}

export type AfterDeleteHook<T = DocumentData> = (
  args: AfterDeleteHookArgs<T>,
) => Promise<T | void> | T | void

export interface CollectionHooks<T = DocumentData> {
  beforeValidate?: BeforeValidateHook<T>[]
  beforeChange?: BeforeChangeHook<T>[]
  afterChange?: AfterChangeHook<T>[]
  afterRead?: AfterReadHook<T>[]
  beforeDelete?: BeforeDeleteHook<T>[]
  afterDelete?: AfterDeleteHook<T>[]
}
