import type { DraftSystemFields, SystemFields, UploadSystemFields } from '../client/system-fields'
import type { Block, Field, Fields, JsonValue } from './types'

/** The value each field type stores. Every new field type needs an entry here. */
interface FieldValueMap {
  text: string
  number: number
  textarea: string
  code: string
  json: JsonValue
  point: [number, number]
  email: string
  slug: string
  checkbox: boolean
  select: string
  radio: string
  date: string
  richText: Record<string, unknown>
  relationship: number
  upload: number
}

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never

type FlattenTab<T> = T extends { fields: infer TabFields extends Fields }
  ? FlattenFields<TabFields>
  : Record<string, never>

export type FlattenFields<F extends Fields> = [keyof F] extends [never]
  ? Record<string, never>
  : Simplify<
      UnionToIntersection<
        {
          [K in keyof F]: F[K] extends {
            type: 'tabs'
            tabs: readonly (infer T)[]
          }
            ? FlattenTab<T>
            : F[K] extends { type: 'row'; fields: infer SubFields extends Fields }
              ? FlattenFields<SubFields>
              : F[K] extends { type: 'collapsible'; fields: infer SubFields extends Fields }
                ? FlattenFields<SubFields>
                : { [P in K]: F[K] }
        }[keyof F]
      >
    >

type InferGroupFields<F extends Fields> = {
  -readonly [K in keyof FlattenFields<F>]: FlattenFields<F>[K] extends Field
    ? FieldValue<FlattenFields<F>[K]>
    : never
}

export type InferArrayRow<F extends Fields> = Simplify<
  { id: string } & {
    -readonly [K in keyof FlattenFields<F>]: FlattenFields<F>[K] extends Field
      ? FieldValue<FlattenFields<F>[K]>
      : never
  }
>

export type InferBlockRow<B extends Block> =
  B extends Block<infer Slug, infer SubFields>
    ? Simplify<
        {
          id: string
          blockType: Slug
        } & {
          -readonly [K in keyof FlattenFields<SubFields>]: FlattenFields<SubFields>[K] extends Field
            ? FieldValue<FlattenFields<SubFields>[K]>
            : never
        }
      >
    : never

type PolymorphicRef<R extends string> = {
  [K in R]: { relationTo: K; value: number }
}[R]

type InferRelationshipValue<F extends Field> = F extends {
  type: 'relationship'
  relationTo: readonly (infer R extends string)[]
}
  ? F extends { hasMany: true }
    ? PolymorphicRef<R>[]
    : F extends { required: true }
      ? PolymorphicRef<R>
      : PolymorphicRef<R> | null
  : F extends { type: 'relationship'; hasMany: true }
    ? number[]
    : F extends { required: true }
      ? number
      : number | null

type FieldValue<F extends Field> = F extends {
  type: 'tabs' | 'row' | 'collapsible'
}
  ? never
  : F extends {
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
      : F extends {
            type: 'blocks'
            blocks: readonly (infer B extends Block)[]
          }
        ? F extends { required: true }
          ? InferBlockRow<B>[]
          : InferBlockRow<B>[] | null
        : F extends { type: 'relationship' }
          ? InferRelationshipValue<F>
          : F extends { type: 'text'; hasMany: true }
            ? F extends { required: true }
              ? string[]
              : string[] | null
            : F extends { type: 'number'; hasMany: true }
              ? F extends { required: true }
                ? number[]
                : number[] | null
              : F['type'] extends keyof FieldValueMap
                ? F extends { required: true }
                  ? FieldValueMap[F['type']]
                  : FieldValueMap[F['type']] | null
                : unknown

type Simplify<T> = { [K in keyof T]: T[K] }

/** The document type of a collection, as the API returns it. */
export type InferDoc<
  C extends { fields: Fields; upload?: unknown; versions?: { drafts?: unknown } },
> = Simplify<
  SystemFields &
    (C extends { versions: { drafts: true | object } } ? DraftSystemFields : unknown) &
    (C extends { upload: true | object } ? UploadSystemFields : unknown) & {
      -readonly [K in keyof FlattenFields<C['fields']>]: FlattenFields<C['fields']>[K] extends Field
        ? FieldValue<FlattenFields<C['fields']>[K]>
        : never
    }
>
