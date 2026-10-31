export { collection } from './config/collection'
export { defineConfig, LontarConfigError } from './config/define-config'
export { toClientCollection, toClientConfig } from './config/to-client-config'
export { fields } from './fields'
export { createLontar, type CreateLontarOptions } from './server/create-lontar'

export type { CollectionConfig, Config } from './config/types'
export type {
  DatabaseAdapter,
  DocumentData,
  FindArgs,
  PaginatedDocs,
  StoredDoc,
} from './database/adapter'
export type { InferDoc } from './fields/infer'
export type {
  EmailField,
  Field,
  Fields,
  FieldType,
  NumberField,
  SlugField,
  TextareaField,
  TextField,
} from './fields/types'
