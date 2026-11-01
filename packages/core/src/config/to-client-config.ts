import {
  CLIENT_CONFIG_VERSION,
  type ClientCheckboxField,
  type ClientCollection,
  type ClientConfig,
  type ClientDateField,
  type ClientEmailField,
  type ClientField,
  type ClientGlobal,
  type ClientNumberField,
  type ClientSelectField,
  type ClientSelectOption,
  type ClientSlugField,
  type ClientTextareaField,
  type ClientTextField,
} from '../client/client-config'
import type {
  CheckboxField,
  DateField,
  EmailField,
  Field,
  FieldType,
  NumberField,
  SelectField,
  SelectOption,
  SlugField,
  TextareaField,
  TextField,
} from '../fields/types'
import { humanize } from '../utils/humanize'
import type { CollectionConfig, Config, GlobalConfig } from './types'

const MAX_DEFAULT_COLUMNS = 4

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
      maxLength: field.maxLength,
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
    }),
  }),
  slug: (name: string, field: SlugField): ClientSlugField => ({
    ...baseField(name, field),
    ...defined({
      from: field.from,
      unique: field.unique,
      defaultValue: field.defaultValue,
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

export function toClientGlobal(global: GlobalConfig): ClientGlobal {
  const fields = Object.entries(global.fields).map(([name, field]) => clientField(name, field))
  return {
    slug: global.slug,
    label: global.label ?? humanize(global.slug),
    fields,
  }
}

export function toClientCollection(collection: CollectionConfig): ClientCollection {
  const fields = Object.entries(collection.fields).map(([name, field]) => clientField(name, field))
  return {
    slug: collection.slug,
    labels: clientLabels(collection),
    admin: clientAdmin(collection, fields),
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

function clientAdmin(
  { admin = {} }: CollectionConfig,
  fields: ClientField[],
): ClientCollection['admin'] {
  const useAsTitle = admin.useAsTitle ?? 'id'
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
): Pick<ClientField, 'name' | 'label' | 'required'> & { type: F['type'] } {
  return {
    name,
    type: field.type,
    label: field.label ?? humanize(name),
    required: field.required ?? false,
  }
}

/** Drops undefined values, which JSON would drop anyway, so the result round-trips exactly. */
function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
