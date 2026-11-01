import type { DocumentData } from '../database/adapter'

export interface BeforeChangeHookArgs<T = DocumentData> {
  data: T
  req?: Request
  operation: 'create' | 'update'
  originalDoc?: DocumentData
}

export type BeforeChangeHook<T = DocumentData> = (
  args: BeforeChangeHookArgs<T>,
) => Promise<T | void> | T | void

export interface AfterChangeHookArgs<T = DocumentData> {
  doc: T
  previousDoc?: DocumentData
  req?: Request
  operation: 'create' | 'update'
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
