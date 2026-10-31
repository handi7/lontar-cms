import type { SystemFields } from '../client/system-fields'
import type { Field, Fields } from './types'

/** The value each field type stores. Every new field type needs an entry here. */
interface FieldValueMap {
  text: string
  number: number
  textarea: string
  email: string
  slug: string
}

type FieldValue<F extends Field> = F extends { required: true }
  ? FieldValueMap[F['type']]
  : FieldValueMap[F['type']] | null

type Simplify<T> = { [K in keyof T]: T[K] }

/** The document type of a collection, as the API returns it. */
export type InferDoc<C extends { fields: Fields }> = Simplify<
  SystemFields & { -readonly [K in keyof C['fields']]: FieldValue<C['fields'][K]> }
>
