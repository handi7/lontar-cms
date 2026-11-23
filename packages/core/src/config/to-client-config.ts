import {
  CLIENT_CONFIG_VERSION,
  type ActionScope,
  type ClientAction,
  type ClientCheckboxField,
  type ClientCollection,
  type ClientConfig,
  type ClientDateField,
  type ClientEmailField,
  type ClientField,
  type ClientGlobal,
  type ClientGlobalAdmin,
  type ClientGroupField,
  type ClientLocalizationConfig,
  type ClientNumberField,
  type ClientRelationshipField,
  type ClientRichTextField,
  type ClientSelectField,
  type ClientSelectOption,
  type ClientSlugField,
  type ClientTextareaField,
  type ClientTextField,
  type ClientUploadField,
  type ClientAdminConfig,
  type ClientArrayField,
  type ClientBlocksField,
  type ClientVersionsAutosaveConfig,
  type ClientVersionsConfig,
} from '../client/client-config'
import type {
  ArrayField,
  BlocksField,
  CheckboxField,
  DateField,
  EmailField,
  Field,
  FieldType,
  GroupField,
  NumberField,
  RelationshipField,
  RichTextField,
  SelectField,
  SelectOption,
  SlugField,
  TextareaField,
  TextField,
  UploadField,
} from '../fields/types'
import { humanize } from '../utils/humanize'
import type {
  ActionConfig,
  AdminConfig,
  CollectionConfig,
  Config,
  Endpoint,
  GlobalConfig,
  LocalizationConfig,
  VersionsConfig,
} from './types'
import { LontarConfigError } from './define-config'
import { validateActions } from './validate-actions'

const MAX_DEFAULT_COLUMNS = 4
export const DEFAULT_STRING_MAX_LENGTH = 255

function normalizeSelectOptions(options: readonly SelectOption[] = []): ClientSelectOption[] {
  return options.map((opt) => {
    if (typeof opt === 'string') {
      return { label: humanize(opt), value: opt }
    }
    return { label: opt.label, value: opt.value }
  })
}

/*
 * One converter per field type. Each picks the options it knows by name, so
 * nothing server-only can ride along on a field object. `satisfies` makes a new
 * field type fail to compile until it has a converter here.
 */
const toClientField = {
  text: (name: string, field: TextField, parentLocalized?: boolean): ClientTextField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      minLength: field.minLength,
      maxLength: field.maxLength ?? DEFAULT_STRING_MAX_LENGTH,
      defaultValue: field.defaultValue,
    }),
  }),
  number: (name: string, field: NumberField, parentLocalized?: boolean): ClientNumberField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      min: field.min,
      max: field.max,
      integer: field.integer,
      defaultValue: field.defaultValue,
    }),
  }),
  textarea: (
    name: string,
    field: TextareaField,
    parentLocalized?: boolean,
  ): ClientTextareaField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      minLength: field.minLength,
      maxLength: field.maxLength,
      rows: field.rows,
      defaultValue: field.defaultValue,
    }),
  }),
  email: (name: string, field: EmailField, parentLocalized?: boolean): ClientEmailField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      unique: field.unique,
      defaultValue: field.defaultValue,
      maxLength: DEFAULT_STRING_MAX_LENGTH,
    }),
  }),
  slug: (name: string, field: SlugField, parentLocalized?: boolean): ClientSlugField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      from: field.from,
      unique: field.unique,
      defaultValue: field.defaultValue,
      maxLength: DEFAULT_STRING_MAX_LENGTH,
    }),
  }),
  checkbox: (
    name: string,
    field: CheckboxField,
    parentLocalized?: boolean,
  ): ClientCheckboxField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  select: (name: string, field: SelectField, parentLocalized?: boolean): ClientSelectField => ({
    ...baseField(name, field, parentLocalized),
    options: normalizeSelectOptions(field.options),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  date: (name: string, field: DateField, parentLocalized?: boolean): ClientDateField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  richText: (
    name: string,
    field: RichTextField,
    parentLocalized?: boolean,
  ): ClientRichTextField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  relationship: (
    name: string,
    field: RelationshipField,
    parentLocalized?: boolean,
  ): ClientRelationshipField => ({
    ...baseField(name, field, parentLocalized),
    relationTo: field.relationTo,
    ...defined({
      hasMany: field.hasMany,
    }),
  }),
  upload: (name: string, field: UploadField, parentLocalized?: boolean): ClientUploadField => ({
    ...baseField(name, field, parentLocalized),
    relationTo: field.relationTo,
  }),
  group: (name: string, field: GroupField, parentLocalized?: boolean): ClientGroupField => {
    const isLocalized = Boolean(field.localized || parentLocalized)
    return {
      ...baseField(name, field, parentLocalized),
      fields: Object.entries(field.fields).map(([subName, subField]) =>
        clientField(subName, subField, isLocalized),
      ),
    }
  },
  array: (name: string, field: ArrayField, parentLocalized?: boolean): ClientArrayField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      minRows: field.minRows,
      maxRows: field.maxRows,
      labels: field.labels,
      admin: field.admin
        ? { description: field.admin.description, rowLabel: field.admin.rowLabel }
        : undefined,
    }),
    fields: Object.entries(field.fields).map(([subName, subField]) =>
      clientField(subName, subField),
    ),
  }),
  blocks: (name: string, field: BlocksField, parentLocalized?: boolean): ClientBlocksField => ({
    ...baseField(name, field, parentLocalized),
    ...defined({
      minRows: field.minRows,
      maxRows: field.maxRows,
      labels: field.labels,
      admin: field.admin ? { description: field.admin.description } : undefined,
    }),
    blocks: field.blocks.map((b) => ({
      slug: b.slug,
      labels: {
        singular: b.labels?.singular ?? humanize(b.slug),
        plural: b.labels?.plural ?? `${b.labels?.singular ?? humanize(b.slug)}s`,
      },
      fields: Object.entries(b.fields).map(([subName, subField]) => clientField(subName, subField)),
    })),
  }),
} satisfies {
  [K in FieldType]: (
    name: string,
    field: Extract<Field, { type: K }>,
    parentLocalized?: boolean,
  ) => ClientField
}

function toClientLocalization(
  localization?: LocalizationConfig,
): ClientLocalizationConfig | undefined {
  if (!localization) return undefined
  return {
    locales: localization.locales.map((loc) =>
      typeof loc === 'string'
        ? { code: loc, label: loc.toUpperCase() }
        : { code: loc.code, label: loc.label ?? loc.code.toUpperCase() },
    ),
    defaultLocale: localization.defaultLocale,
    fallback: localization.fallback ?? true,
  }
}

/** Component keys, labels and layout only. Anything that is a function stays on the server. */
function toClientAdmin(admin: AdminConfig | undefined): ClientAdminConfig | undefined {
  const widgets = admin?.dashboard?.widgets
  const views = admin?.views
  const result: ClientAdminConfig = {
    ...(widgets && widgets.length > 0
      ? {
          dashboard: {
            widgets: widgets.map((widget) => ({
              component: widget.component,
              width: widget.width ?? 'full',
            })),
          },
        }
      : {}),
    ...(views && views.length > 0
      ? {
          views: views.map((view) => ({
            key: view.key,
            label: view.label,
            component: view.component,
          })),
        }
      : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Serializes the config for the admin. The result is plain JSON: no functions,
 * no adapter, no secret. See docs/adr/0003-client-config-format.md.
 */
export function toClientConfig(config: Config): ClientConfig {
  const roles = config.auth?.roles ? [...config.auth.roles] : ['admin', 'editor']
  const defaultRole = config.auth?.defaultRole ?? 'editor'
  const adminRole = config.auth?.adminRole ?? 'admin'
  const emailEnabled = Boolean(config.email)
  const localization = toClientLocalization(config.localization)
  const admin = toClientAdmin(config.admin)

  return {
    version: CLIENT_CONFIG_VERSION,
    ...(localization ? { localization } : {}),
    ...(admin ? { admin } : {}),
    auth: {
      roles,
      defaultRole,
      adminRole,
      emailEnabled,
    },
    collections: config.collections.map(toClientCollection),
    globals: (config.globals ?? []).map(toClientGlobal),
  }
}

function resolveAutosaveInterval(raw: unknown): number {
  if (typeof raw === 'object' && raw !== null && 'interval' in raw) {
    const interval = (raw as { interval?: unknown }).interval
    if (typeof interval === 'number' && interval >= 500) {
      return interval
    }
  }
  return 2000
}

function resolveAutosaveConfig(
  versions: VersionsConfig,
  draftsEnabled: boolean,
): ClientVersionsAutosaveConfig | undefined {
  if (!draftsEnabled) return undefined

  const rawAutosave =
    typeof versions.drafts === 'object' && versions.drafts !== null && 'autosave' in versions.drafts
      ? versions.drafts.autosave
      : versions.autosave

  if (!rawAutosave) return undefined
  return { interval: resolveAutosaveInterval(rawAutosave) }
}

function toClientVersions(versions?: VersionsConfig): ClientVersionsConfig | undefined {
  if (!versions) return undefined
  const draftsEnabled = Boolean(
    versions.drafts === true || (typeof versions.drafts === 'object' && versions.drafts !== null),
  )

  const autosave = resolveAutosaveConfig(versions, draftsEnabled)
  const result = defined({
    drafts: draftsEnabled ? true : undefined,
    autosave,
    maxPerDoc: versions.maxPerDoc,
  })

  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeActionScopes(scope: ActionConfig['scope']): ActionScope[] {
  if (typeof scope === 'string') return [scope]
  if (scope) return [...scope]
  return ['document']
}

function toSingleClientAction(
  action: ActionConfig,
  endpoints: readonly Endpoint[] | undefined,
): ClientAction {
  const scopes = normalizeActionScopes(action.scope)
  const endpoint = action.endpoint ? endpoints?.find((e) => e.name === action.endpoint) : undefined

  return {
    key: action.key,
    label: action.label,
    scope: scopes,
    ...(action.confirm ? { confirm: action.confirm } : {}),
    ...(action.variant ? { variant: action.variant } : {}),
    ...(action.component ? { component: action.component } : {}),
    ...(action.endpoint
      ? {
          endpoint: action.endpoint,
          path: endpoint?.path,
          method: endpoint?.method,
        }
      : {}),
  }
}

function toClientActions(
  where: string,
  actions: readonly ActionConfig[] | undefined,
  endpoints: readonly Endpoint[] | undefined,
  isGlobal = false,
): ClientAction[] | undefined {
  if (!actions || actions.length === 0) return undefined
  const issues = validateActions(where, actions, endpoints, isGlobal)
  if (issues.length > 0) {
    throw new LontarConfigError(issues)
  }
  return actions.map((action) => toSingleClientAction(action, endpoints))
}

function toClientGlobalAdmin(
  global: GlobalConfig,
  actions: ClientAction[] | undefined,
): ClientGlobalAdmin | undefined {
  const preview = global.admin?.preview?.url ? { url: global.admin.preview.url } : undefined
  if (!preview && (!actions || actions.length === 0)) return undefined
  return {
    ...(preview ? { preview } : {}),
    ...(actions && actions.length > 0 ? { actions } : {}),
  }
}

export function toClientGlobal(global: GlobalConfig): ClientGlobal {
  const fields = Object.entries(global.fields).map(([name, field]) => clientField(name, field))
  const versions = toClientVersions(global.versions)
  const actions = toClientActions(
    `Global "${global.slug}"`,
    global.admin?.actions,
    global.endpoints,
    true,
  )
  const admin = toClientGlobalAdmin(global, actions)
  const hasVersions = Boolean(versions && Object.keys(versions).length > 0)

  return {
    slug: global.slug,
    label: global.label ?? humanize(global.slug),
    ...(admin ? { admin } : {}),
    ...(hasVersions ? { versions } : {}),
    fields,
  }
}

export function toClientCollection(collection: CollectionConfig): ClientCollection {
  const fields = Object.entries(collection.fields).map(([name, field]) => clientField(name, field))
  const upload = collection.upload
    ? typeof collection.upload === 'object'
      ? defined({
          mimeTypes: collection.upload.mimeTypes,
          maxFileSize: collection.upload.maxFileSize,
        })
      : true
    : undefined
  const pagination = collection.pagination
    ? defined({
        defaultLimit: collection.pagination.defaultLimit,
        maxLimit: collection.pagination.maxLimit,
      })
    : undefined
  const versions = toClientVersions(collection.versions)

  return {
    slug: collection.slug,
    labels: clientLabels(collection),
    admin: clientAdmin(collection, fields),
    ...(upload ? { upload } : {}),
    ...(pagination && Object.keys(pagination).length > 0 ? { pagination } : {}),
    ...(versions && Object.keys(versions).length > 0 ? { versions } : {}),
    fields,
  }
}

function clientField(name: string, field: Field, parentLocalized?: boolean): ClientField {
  // TypeScript cannot match `field.type` to its converter's parameter, hence the cast.
  const convert = toClientField[field.type] as (
    name: string,
    field: Field,
    parentLocalized?: boolean,
  ) => ClientField
  return convert(name, field, parentLocalized)
}

function clientLabels({ slug, labels = {} }: CollectionConfig): ClientCollection['labels'] {
  // Guessing a singular from the slug goes wrong too often; set `labels` to get one.
  const plural = labels.plural ?? humanize(slug)
  return { singular: labels.singular ?? plural, plural }
}

function isTextLike(type: ClientField['type']): boolean {
  return type === 'text' || type === 'email' || type === 'slug'
}

function resolveDefaultTitle(fields: ClientField[], upload: boolean): string {
  const textLikeField = fields.find((field) => isTextLike(field.type))
  if (textLikeField) return textLikeField.name
  if (upload) return 'filename'
  return 'id'
}

function clientAdmin(
  collection: CollectionConfig,
  fields: ClientField[],
): ClientCollection['admin'] {
  const { admin = {}, upload } = collection
  const useAsTitle = admin.useAsTitle ?? resolveDefaultTitle(fields, Boolean(upload))
  const others = fields.map((field) => field.name).filter((name) => name !== useAsTitle)
  const preview = admin.preview?.url ? { url: admin.preview.url } : undefined
  const actions = toClientActions(
    `Collection "${collection.slug}"`,
    admin.actions,
    collection.endpoints,
    false,
  )
  return {
    useAsTitle,
    defaultColumns: admin.defaultColumns
      ? [...admin.defaultColumns]
      : [useAsTitle, ...others].slice(0, MAX_DEFAULT_COLUMNS),
    ...(preview ? { preview } : {}),
    ...(actions && actions.length > 0 ? { actions } : {}),
  }
}

function baseField<F extends Field>(
  name: string,
  field: F,
  parentLocalized = false,
): Pick<ClientField, 'name' | 'label' | 'required' | 'localized' | 'condition' | 'component'> & {
  type: F['type']
} {
  const isLocalized = Boolean(field.localized || parentLocalized)
  return {
    name,
    type: field.type,
    label: field.label ?? humanize(name),
    required: field.required ?? false,
    ...defined({
      localized: isLocalized ? true : undefined,
      condition: field.admin?.condition,
      component: field.admin?.component,
    }),
  }
}

/** Drops undefined values, which JSON would drop anyway, so the result round-trips exactly. */
function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
