import {
  CLIENT_CONFIG_VERSION,
  type ClientCheckboxField,
  type ClientCollection,
  type ClientConfig,
  type ClientDateField,
  type ClientEmailField,
  type ClientField,
  type ClientGlobal,
  type ClientGroupField,
  type ClientNumberField,
  type ClientRelationshipField,
  type ClientRichTextField,
  type ClientSelectField,
  type ClientSelectOption,
  type ClientSlugField,
  type ClientTextareaField,
  type ClientTextField,
  type ClientUploadField,
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
import type { CollectionConfig, Config, GlobalConfig, VersionsConfig } from './types'

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
  text: (name: string, field: TextField): ClientTextField => ({
    ...baseField(name, field),
    ...defined({
      minLength: field.minLength,
      maxLength: field.maxLength ?? DEFAULT_STRING_MAX_LENGTH,
      defaultValue: field.defaultValue,
    }),
  }),
  number: (name: string, field: NumberField): ClientNumberField => ({
    ...baseField(name, field),
    ...defined({
      min: field.min,
      max: field.max,
      integer: field.integer,
      defaultValue: field.defaultValue,
    }),
  }),
  textarea: (name: string, field: TextareaField): ClientTextareaField => ({
    ...baseField(name, field),
    ...defined({
      minLength: field.minLength,
      maxLength: field.maxLength,
      rows: field.rows,
      defaultValue: field.defaultValue,
    }),
  }),
  email: (name: string, field: EmailField): ClientEmailField => ({
    ...baseField(name, field),
    ...defined({
      unique: field.unique,
      defaultValue: field.defaultValue,
      maxLength: DEFAULT_STRING_MAX_LENGTH,
    }),
  }),
  slug: (name: string, field: SlugField): ClientSlugField => ({
    ...baseField(name, field),
    ...defined({
      from: field.from,
      unique: field.unique,
      defaultValue: field.defaultValue,
      maxLength: DEFAULT_STRING_MAX_LENGTH,
    }),
  }),
  checkbox: (name: string, field: CheckboxField): ClientCheckboxField => ({
    ...baseField(name, field),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  select: (name: string, field: SelectField): ClientSelectField => ({
    ...baseField(name, field),
    options: normalizeSelectOptions(field.options),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  date: (name: string, field: DateField): ClientDateField => ({
    ...baseField(name, field),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  richText: (name: string, field: RichTextField): ClientRichTextField => ({
    ...baseField(name, field),
    ...defined({
      defaultValue: field.defaultValue,
    }),
  }),
  relationship: (name: string, field: RelationshipField): ClientRelationshipField => ({
    ...baseField(name, field),
    relationTo: field.relationTo,
    ...defined({
      hasMany: field.hasMany,
    }),
  }),
  upload: (name: string, field: UploadField): ClientUploadField => ({
    ...baseField(name, field),
    relationTo: field.relationTo,
  }),
  group: (name: string, field: GroupField): ClientGroupField => ({
    ...baseField(name, field),
    fields: Object.entries(field.fields).map(([subName, subField]) =>
      clientField(subName, subField),
    ),
  }),
  array: (name: string, field: ArrayField): ClientArrayField => ({
    ...baseField(name, field),
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
  blocks: (name: string, field: BlocksField): ClientBlocksField => ({
    ...baseField(name, field),
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
  [K in FieldType]: (name: string, field: Extract<Field, { type: K }>) => ClientField
}

/**
 * Serializes the config for the admin. The result is plain JSON: no functions,
 * no adapter, no secret. See docs/adr/0003-client-config-format.md.
 */
export function toClientConfig(config: Config): ClientConfig {
  return {
    version: CLIENT_CONFIG_VERSION,
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

export function toClientGlobal(global: GlobalConfig): ClientGlobal {
  const fields = Object.entries(global.fields).map(([name, field]) => clientField(name, field))
  const versions = toClientVersions(global.versions)
  return {
    slug: global.slug,
    label: global.label ?? humanize(global.slug),
    ...(versions && Object.keys(versions).length > 0 ? { versions } : {}),
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

function clientField(name: string, field: Field): ClientField {
  // TypeScript cannot match `field.type` to its converter's parameter, hence the cast.
  const convert = toClientField[field.type] as (name: string, field: Field) => ClientField
  return convert(name, field)
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
  return {
    useAsTitle,
    defaultColumns: admin.defaultColumns
      ? [...admin.defaultColumns]
      : [useAsTitle, ...others].slice(0, MAX_DEFAULT_COLUMNS),
  }
}

function baseField<F extends Field>(
  name: string,
  field: F,
): Pick<ClientField, 'name' | 'label' | 'required' | 'condition'> & { type: F['type'] } {
  return {
    name,
    type: field.type,
    label: field.label ?? humanize(name),
    required: field.required ?? false,
    ...defined({
      condition: field.admin?.condition,
    }),
  }
}

/** Drops undefined values, which JSON would drop anyway, so the result round-trips exactly. */
function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
