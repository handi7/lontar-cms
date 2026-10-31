/** Bumped whenever the shape below changes incompatibly. */
export const CLIENT_CONFIG_VERSION = 1

/**
 * Everything the admin knows about the config, served as JSON from
 * `GET /api/_lontar/config`. Plain data only: it must survive
 * `JSON.parse(JSON.stringify(x))` unchanged. See docs/adr/0003-client-config-format.md.
 */
export interface ClientConfig {
  version: typeof CLIENT_CONFIG_VERSION
  collections: ClientCollection[]
}

export interface ClientCollection {
  slug: string
  labels: { singular: string; plural: string }
  admin: { useAsTitle: string; defaultColumns: string[] }
  /** In config order. System fields are not listed: every document has them. */
  fields: ClientField[]
}

interface ClientFieldBase {
  name: string
  label: string
  required: boolean
}

export interface ClientTextField extends ClientFieldBase {
  type: 'text'
  minLength?: number
  maxLength?: number
  defaultValue?: string
}

export interface ClientNumberField extends ClientFieldBase {
  type: 'number'
  min?: number
  max?: number
  integer?: boolean
  defaultValue?: number
}

export type ClientField = ClientTextField | ClientNumberField
