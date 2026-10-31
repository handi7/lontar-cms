export { collection } from './config/collection'
export { defineConfig, LontarConfigError } from './config/define-config'
export { toClientConfig } from './config/to-client-config'
export { fields } from './fields'

export type { CollectionConfig, Config } from './config/types'
export type {
  DatabaseAdapter,
  DocumentData,
  FindArgs,
  PaginatedDocs,
  StoredDoc,
} from './database/adapter'
export type { InferDoc } from './fields/infer'
export type { Field, Fields, FieldType, NumberField, TextField } from './fields/types'
