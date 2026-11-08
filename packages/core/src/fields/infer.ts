import type { SystemFields, UploadSystemFields } from '../client/system-fields'
import type { Field, Fields } from './types'

/** The value each field type stores. Every new field type needs an entry here. */
interface FieldValueMap {
  text: string
  number: number
  textarea: string
  email: string
  slug: string
  checkbox: boolean
  select: string
  date: string
  richText: Record<string, unknown>
  relationship: number
  upload: number
}

type InferGroupFields<F extends Fields> = {
  -readonly [K in keyof F]: FieldValue<F[K]>
}

export type InferArrayRow<F extends Fields> = Simplify<
  { id: string } & {
    -readonly [K in keyof F]: FieldValue<F[K]>
  }
>

type FieldValue<F extends Field> = F extends {
  type: 'group'
  fields: infer SubFields extends Fields
}
  ? F extends { required: true }
    ? InferGroupFields<SubFields>
    : InferGroupFields<SubFields> | null
  : F extends {
        type: 'array'
        fields: infer SubFields extends Fields
      }
    ? F extends { required: true }
      ? InferArrayRow<SubFields>[]
      : InferArrayRow<SubFields>[] | null
    : F extends { type: 'relationship'; hasMany: true }
      ? number[]
      : F['type'] extends keyof FieldValueMap
        ? F extends { required: true }
          ? FieldValueMap[F['type']]
          : FieldValueMap[F['type']] | null
        : unknown

type Simplify<T> = { [K in keyof T]: T[K] }

/** The document type of a collection, as the API returns it. */
export type InferDoc<C extends { fields: Fields; upload?: unknown }> = Simplify<
  SystemFields &
    (C extends { upload: true | object } ? UploadSystemFields : unknown) & {
      -readonly [K in keyof C['fields']]: FieldValue<C['fields'][K]>
    }
>
