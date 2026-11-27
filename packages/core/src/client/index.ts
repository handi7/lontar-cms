// Client-safe surface: types and pure functions only.
// Nothing here may import the database adapter, Hono, or defineConfig.
// See docs/adr/0003-client-config-format.md.
export { CLIENT_CONFIG_VERSION } from './client-config'
export type { SearchResult } from './search'
export type {
  ActionScope,
  ActionVariant,
  ClientAction,
  ClientArrayField,
  ClientAdminConfig,
  ClientArrayFieldAdmin,
  ClientAuthConfig,
  ClientBlock,
  ClientBlocksField,
  ClientBlocksFieldAdmin,
  ClientCheckboxField,
  ClientCodeField,
  ClientCollapsibleField,
  ClientCollapsibleFieldAdmin,
  ClientJsonField,
  ClientCollection,
  ClientCollectionAdmin,
  ClientCustomView,
  ClientConfig,
  ClientDashboardWidget,
  ClientDateField,
  ClientEmailField,
  ClientField,
  ClientGlobal,
  ClientGlobalAdmin,
  ClientGroupField,
  ClientJoinField,
  ClientLocale,
  ClientLocalizationConfig,
  ClientNumberField,
  ClientPointField,
  ClientPreviewConfig,
  ClientRadioField,
  ClientRadioLayout,
  ClientRelationshipField,
  ClientRichTextField,
  ClientRowField,
  ClientRowFieldAdmin,
  ClientSelectField,
  ClientSelectOption,
  ClientSlugField,
  ClientTab,
  ClientTabAdmin,
  ClientTabsField,
  ClientTabsFieldAdmin,
  ClientTextareaField,
  ClientTextField,
  ClientUploadConfig,
  ClientUploadField,
  ClientVersionsAutosaveConfig,
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
export type {
  CollectionPermission,
  FieldPermission,
  GlobalPermission,
  PermissionsResponse,
} from './permissions'
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
export { flattenClientFields, isClientLayoutField } from './flatten'
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
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, validatePassword } from './password'
