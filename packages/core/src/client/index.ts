// Client-safe surface: types and pure functions only.
// Nothing here may import the database adapter, Hono, or defineConfig.
// See docs/adr/0003-client-config-format.md.
export { CLIENT_CONFIG_VERSION } from './client-config'
export type {
  ClientCheckboxField,
  ClientCollection,
  ClientConfig,
  ClientDateField,
  ClientEmailField,
  ClientField,
  ClientGlobal,
  ClientNumberField,
  ClientRelationshipField,
  ClientRichTextField,
  ClientSelectField,
  ClientSelectOption,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
  ClientUploadConfig,
  ClientUploadField,
} from './client-config'
export { SYSTEM_FIELDS, UPLOAD_SYSTEM_FIELDS } from './system-fields'
export type {
  SystemFieldName,
  SystemFields,
  UploadSystemFieldName,
  UploadSystemFields,
} from './system-fields'
export type { FieldFilter, FilterOperator, SortItem, Where, WhereClause, WhereField } from './query'
export { clientFieldToZod, clientFieldsToZod } from './zod'
