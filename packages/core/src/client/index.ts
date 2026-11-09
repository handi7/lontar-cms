// Client-safe surface: types and pure functions only.
// Nothing here may import the database adapter, Hono, or defineConfig.
// See docs/adr/0003-client-config-format.md.
export { CLIENT_CONFIG_VERSION } from './client-config'
export type {
  ClientArrayField,
  ClientArrayFieldAdmin,
  ClientBlock,
  ClientBlocksField,
  ClientBlocksFieldAdmin,
  ClientCheckboxField,
  ClientCollection,
  ClientConfig,
  ClientDateField,
  ClientEmailField,
  ClientField,
  ClientGlobal,
  ClientGroupField,
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
  ClientVersionsConfig,
} from './client-config'
export {
  BASE_SYSTEM_FIELDS,
  DOC_STATUSES,
  DRAFT_SYSTEM_FIELDS,
  SYSTEM_FIELDS,
  UPLOAD_SYSTEM_FIELDS,
} from './system-fields'
export type {
  ClientPaginatedVersions,
  ClientVersion,
  DocStatus,
  DraftSystemFields,
  SystemFieldName,
  SystemFields,
  UploadSystemFieldName,
  UploadSystemFields,
} from './system-fields'
export type { FieldFilter, FilterOperator, SortItem, Where, WhereClause, WhereField } from './query'
export type {
  ConditionField,
  ConditionFilter,
  ConditionOperator,
  FieldCondition,
} from './condition'
export {
  evaluateFieldFilter,
  extractConditionPaths,
  getValueByPath,
  matchesCondition,
  resolveConditionTarget,
  sanitizeConditionalFields,
  setValueByPath,
} from './condition'
export {
  clientFieldToZod,
  clientFieldsToZod,
  isRichTextEmpty,
  type ClientFieldsToZodOptions,
} from './zod'
export { generateRowId } from './id'
export type {
  ChangeType,
  PrimitiveFieldDiff,
  GroupFieldDiff,
  ArrayItemDiff,
  ArrayFieldDiff,
  BlocksFieldDiff,
  FieldDiff,
  DocumentDiff,
  DiffableFieldItem,
  DiffableFields,
  DiffableCollection,
} from './diff'
export { diffPrimitive, diffFields, diffSnapshots } from './diff'
