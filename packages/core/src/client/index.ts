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
  ClientNumberField,
  ClientSelectField,
  ClientSelectOption,
  ClientSlugField,
  ClientTextareaField,
  ClientTextField,
} from './client-config'
export { SYSTEM_FIELDS } from './system-fields'
export type { SystemFieldName, SystemFields } from './system-fields'
export { clientFieldToZod, clientFieldsToZod } from './zod'
