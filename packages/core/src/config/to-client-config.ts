import {
  CLIENT_CONFIG_VERSION,
  type ClientCollection,
  type ClientConfig,
  type ClientField,
  type ClientNumberField,
  type ClientTextField,
} from '../client/client-config'
import type { Field, FieldType, NumberField, TextField } from '../fields/types'
import { humanize } from '../utils/humanize'
import type { CollectionConfig, Config } from './types'

const MAX_DEFAULT_COLUMNS = 4

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
  }
}

function toClientCollection(collection: CollectionConfig): ClientCollection {
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
