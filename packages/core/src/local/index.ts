import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type {
  DocumentData,
  PaginatedDocs,
  PaginatedVersions,
  StoredVersion,
} from '../database/adapter'
import type { Where } from '../query/types'
import {
  createOperation,
  deleteOperation,
  findByIDOperation,
  findGlobalOperation,
  findOperation,
  findVersionByIDOperation,
  findVersionsOperation,
  findGlobalVersionByIDOperation,
  findGlobalVersionsOperation,
  NotFoundError,
  publishOperation,
  publishGlobalOperation,
  restoreVersionOperation,
  restoreGlobalVersionOperation,
  unpublishOperation,
  unpublishGlobalOperation,
  updateGlobalOperation,
  updateOperation,
  ValidationError,
} from '../operations'

export interface LocalFindOptions {
  where?: Where
  sort?: string
  page?: number
  limit?: number
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalFindByIDOptions {
  id?: number | string
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalCreateOptions {
  data?: DocumentData
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
  autosave?: boolean
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalUpdateOptions {
  id?: number | string
  data?: DocumentData
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
  autosave?: boolean
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalPublishOptions {
  id?: number | string
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocale
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalFindVersionsOptions {
  page?: number
  limit?: number
  sort?: string
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalFindVersionByIDOptions {
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalRestoreVersionOptions {
  draft?: boolean
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocale
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalDeleteOptions {
  id?: number | string
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocale
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalFindGlobalOptions {
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalUpdateGlobalOptions {
  data?: DocumentData
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
  autosave?: boolean
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalPublishGlobalOptions {
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocale
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalFindGlobalVersionsOptions {
  page?: number
  limit?: number
  sort?: string
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalFindGlobalVersionByIDOptions {
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocaleOrAll
  fallbackLocale?: LontarFallbackLocale
}

export interface LocalRestoreGlobalVersionOptions {
  draft?: boolean
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  locale?: LontarLocale
  fallbackLocale?: LontarFallbackLocale
}

// Target for module augmentation from generated types (lontar generate:types)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LontarCollections {}

// Target for module augmentation from generated types (lontar generate:types)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LontarCollectionsAll {}

// Target for module augmentation from generated types (lontar generate:types)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LontarGlobals {}

// Target for module augmentation from generated types (lontar generate:types)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LontarGlobalsAll {}

// Target for module augmentation from generated types (lontar generate:types)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LontarLocaleExtension {}

export type LontarLocale = LontarLocaleExtension extends { locale: infer L }
  ? [L] extends [string]
    ? L
    : string
  : string

export type LontarLocaleOrAll = LontarLocaleExtension extends { locale: infer L }
  ? [L] extends [string]
    ? L | 'all'
    : string
  : string

export type LontarFallbackLocale = LontarLocaleExtension extends { locale: infer L }
  ? [L] extends [string]
    ? L | false
    : string | false
  : string | false

export type ResolvedCollectionDoc<K extends keyof LontarCollections, O> = O extends {
  locale: 'all'
}
  ? K extends keyof LontarCollectionsAll
    ? LontarCollectionsAll[K]
    : LontarCollections[K]
  : LontarCollections[K]

export type ResolvedGlobalDoc<K extends keyof LontarGlobals, O> = O extends { locale: 'all' }
  ? K extends keyof LontarGlobalsAll
    ? LontarGlobalsAll[K]
    : LontarGlobals[K]
  : LontarGlobals[K]

export interface LontarClient {
  readonly config: Config
  find<K extends keyof LontarCollections, O extends LocalFindOptions = LocalFindOptions>(
    collectionSlug: K,
    options?: O,
  ): Promise<PaginatedDocs<ResolvedCollectionDoc<K, O>>>
  find<T = DocumentData>(
    collectionSlug: string,
    options?: LocalFindOptions,
  ): Promise<PaginatedDocs<T>>

  findByID<
    K extends keyof LontarCollections,
    O extends LocalFindByIDOptions = LocalFindByIDOptions,
  >(
    collectionSlug: K,
    options: O & { id: number | string },
  ): Promise<ResolvedCollectionDoc<K, O> | null>
  findByID<
    K extends keyof LontarCollections,
    O extends Omit<LocalFindByIDOptions, 'id'> = Omit<LocalFindByIDOptions, 'id'>,
  >(
    collectionSlug: K,
    id: number | string,
    options?: O,
  ): Promise<ResolvedCollectionDoc<K, O> | null>
  findByID<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalFindByIDOptions,
    maybeOptions?: Omit<LocalFindByIDOptions, 'id'>,
  ): Promise<T | null>

  create<K extends keyof LontarCollections, O extends LocalCreateOptions = LocalCreateOptions>(
    collectionSlug: K,
    dataOrOptions: Partial<LontarCollections[K]> | O,
  ): Promise<ResolvedCollectionDoc<K, O>>
  create<T = DocumentData>(
    collectionSlug: string,
    dataOrOptions: DocumentData | LocalCreateOptions,
  ): Promise<T>

  update<K extends keyof LontarCollections, O extends LocalUpdateOptions = LocalUpdateOptions>(
    collectionSlug: K,
    options: O & { id: number | string },
  ): Promise<ResolvedCollectionDoc<K, O>>
  update<
    K extends keyof LontarCollections,
    O extends Omit<LocalUpdateOptions, 'id'> = Omit<LocalUpdateOptions, 'id'>,
  >(
    collectionSlug: K,
    id: number | string,
    maybeDataOrOptions?: Partial<LontarCollections[K]> | O,
  ): Promise<ResolvedCollectionDoc<K, O>>
  update<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalUpdateOptions,
    maybeDataOrOptions?: DocumentData | Omit<LocalUpdateOptions, 'id'>,
  ): Promise<T>

  delete<K extends keyof LontarCollections>(
    collectionSlug: K,
    idOrOptions: number | string | LocalDeleteOptions,
    maybeOptions?: Omit<LocalDeleteOptions, 'id'>,
  ): Promise<LontarCollections[K] | null>
  delete<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalDeleteOptions,
    maybeOptions?: Omit<LocalDeleteOptions, 'id'>,
  ): Promise<T | null>

  publish<K extends keyof LontarCollections>(
    collectionSlug: K,
    idOrOptions: number | string | LocalPublishOptions,
    maybeOptions?: Omit<LocalPublishOptions, 'id'>,
  ): Promise<LontarCollections[K]>
  publish<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalPublishOptions,
    maybeOptions?: Omit<LocalPublishOptions, 'id'>,
  ): Promise<T>

  unpublish<K extends keyof LontarCollections>(
    collectionSlug: K,
    idOrOptions: number | string | LocalPublishOptions,
    maybeOptions?: Omit<LocalPublishOptions, 'id'>,
  ): Promise<LontarCollections[K]>
  unpublish<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalPublishOptions,
    maybeOptions?: Omit<LocalPublishOptions, 'id'>,
  ): Promise<T>

  findVersions(
    collectionSlug: string,
    id: number | string,
    options?: LocalFindVersionsOptions,
  ): Promise<PaginatedVersions>

  findVersionByID(
    collectionSlug: string,
    id: number | string,
    versionId: number | string,
    options?: LocalFindVersionByIDOptions,
  ): Promise<StoredVersion>

  restoreVersion<K extends keyof LontarCollections>(
    collectionSlug: K,
    id: number | string,
    versionId: number | string,
    options?: LocalRestoreVersionOptions,
  ): Promise<LontarCollections[K]>
  restoreVersion<T = DocumentData>(
    collectionSlug: string,
    id: number | string,
    versionId: number | string,
    options?: LocalRestoreVersionOptions,
  ): Promise<T>

  findGlobal<
    K extends keyof LontarGlobals,
    O extends LocalFindGlobalOptions = LocalFindGlobalOptions,
  >(
    globalSlug: K,
    options?: O,
  ): Promise<ResolvedGlobalDoc<K, O>>
  findGlobal<T = DocumentData>(globalSlug: string, options?: LocalFindGlobalOptions): Promise<T>

  updateGlobal<
    K extends keyof LontarGlobals,
    O extends LocalUpdateGlobalOptions = LocalUpdateGlobalOptions,
  >(
    globalSlug: K,
    dataOrOptions?: Partial<LontarGlobals[K]> | O,
  ): Promise<ResolvedGlobalDoc<K, O>>
  updateGlobal<T = DocumentData>(
    globalSlug: string,
    dataOrOptions?: DocumentData | LocalUpdateGlobalOptions,
  ): Promise<T>

  publishGlobal<K extends keyof LontarGlobals>(
    globalSlug: K,
    options?: LocalPublishGlobalOptions,
  ): Promise<LontarGlobals[K]>
  publishGlobal<T = DocumentData>(
    globalSlug: string,
    options?: LocalPublishGlobalOptions,
  ): Promise<T>

  unpublishGlobal<K extends keyof LontarGlobals>(
    globalSlug: K,
    options?: LocalPublishGlobalOptions,
  ): Promise<LontarGlobals[K]>
  unpublishGlobal<T = DocumentData>(
    globalSlug: string,
    options?: LocalPublishGlobalOptions,
  ): Promise<T>

  findGlobalVersions(
    globalSlug: string,
    options?: LocalFindGlobalVersionsOptions,
  ): Promise<PaginatedVersions>

  findGlobalVersionByID(
    globalSlug: string,
    versionId: number | string,
    options?: LocalFindGlobalVersionByIDOptions,
  ): Promise<StoredVersion>

  restoreGlobalVersion<K extends keyof LontarGlobals>(
    globalSlug: K,
    versionId: number | string,
    options?: LocalRestoreGlobalVersionOptions,
  ): Promise<LontarGlobals[K]>
  restoreGlobalVersion<T = DocumentData>(
    globalSlug: string,
    versionId: number | string,
    options?: LocalRestoreGlobalVersionOptions,
  ): Promise<T>
}

function parseId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return raw
  }
  if (typeof raw === 'string') {
    const parsed = parseInt(raw, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function assertValidId(id: number | null): asserts id is number {
  if (id === null) {
    throw new ValidationError('Invalid document ID')
  }
}

function resolveCollection(config: Config, slug: string): CollectionConfig {
  const col = config.collections.find((c) => c.slug === slug)
  if (!col) {
    throw new NotFoundError(`Collection "${slug}" not found`)
  }
  return col
}

function resolveGlobal(config: Config, slug: string): GlobalConfig {
  const g = config.globals?.find((item) => item.slug === slug)
  if (!g) {
    throw new NotFoundError(`Global "${slug}" not found`)
  }
  return g
}

function resolveCreatePayload(input: DocumentData | LocalCreateOptions): {
  data: DocumentData
  options: LocalCreateOptions
} {
  if ('data' in input && typeof input.data === 'object' && input.data !== null) {
    return { data: input.data as DocumentData, options: input }
  }
  return { data: input as DocumentData, options: {} }
}

function resolveUpdatePayload(
  idOrOptions: number | string | LocalUpdateOptions,
  maybeDataOrOptions?: DocumentData | Omit<LocalUpdateOptions, 'id'>,
): { id: number; data: DocumentData; options: Omit<LocalUpdateOptions, 'id' | 'data'> } {
  if (typeof idOrOptions === 'object' && idOrOptions !== null) {
    const id = parseId(idOrOptions.id)
    assertValidId(id)
    return {
      id,
      data: (idOrOptions.data as DocumentData) ?? {},
      options: idOrOptions,
    }
  }

  const id = parseId(idOrOptions)
  assertValidId(id)

  if (
    maybeDataOrOptions &&
    'data' in maybeDataOrOptions &&
    typeof maybeDataOrOptions.data === 'object' &&
    maybeDataOrOptions.data !== null
  ) {
    return {
      id,
      data: maybeDataOrOptions.data as DocumentData,
      options: maybeDataOrOptions,
    }
  }

  return {
    id,
    data: (maybeDataOrOptions as DocumentData) ?? {},
    options: {},
  }
}

function resolveDeletePayload(
  idOrOptions: number | string | LocalDeleteOptions,
  maybeOptions?: Omit<LocalDeleteOptions, 'id'>,
): { id: number; options: LocalDeleteOptions } {
  if (typeof idOrOptions === 'object' && idOrOptions !== null) {
    const id = parseId(idOrOptions.id)
    assertValidId(id)
    return { id, options: idOrOptions }
  }
  const id = parseId(idOrOptions)
  assertValidId(id)
  return { id, options: maybeOptions ?? {} }
}

/** Defaults a client applies when a call does not pass its own `overrideAccess` or `user`. */
export interface LontarClientDefaults {
  overrideAccess?: boolean
  user?: AuthUser | null
}

export function getLontar(config: Config): Promise<LontarClient> {
  return Promise.resolve(createLontarClient(config))
}

/**
 * The Local API with per-client defaults. `getLontar()` serves trusted server code and defaults to
 * `overrideAccess: true`; endpoint handlers get a client bound to the caller (ADR 0029).
 */
export function createLontarClient(
  config: Config,
  defaults: LontarClientDefaults = {},
): LontarClient {
  const client: LontarClient = {
    config,
    async find<T = DocumentData>(
      slug: string,
      options: LocalFindOptions = {},
    ): Promise<PaginatedDocs<T>> {
      const collection = resolveCollection(config, slug)
      return findOperation<T>({
        config,
        collection,
        where: options.where,
        sort: options.sort,
        page: options.page,
        limit: options.limit,
        depth: options.depth,
        draft: options.draft,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async findByID<T = DocumentData>(
      slug: string,
      idOrOptions: number | string | LocalFindByIDOptions,
      maybeOptions?: Omit<LocalFindByIDOptions, 'id'>,
    ): Promise<T | null> {
      const collection = resolveCollection(config, slug)
      const options: LocalFindByIDOptions =
        typeof idOrOptions === 'object' && idOrOptions !== null
          ? idOrOptions
          : { id: idOrOptions, ...maybeOptions }
      const id = parseId(options.id)
      assertValidId(id)

      return findByIDOperation<T>({
        config,
        collection,
        id,
        depth: options.depth,
        draft: options.draft,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async create<T = DocumentData>(
      slug: string,
      dataOrOptions: DocumentData | LocalCreateOptions,
    ): Promise<T> {
      const collection = resolveCollection(config, slug)
      const { data, options } = resolveCreatePayload(dataOrOptions)
      return createOperation<T>({
        config,
        collection,
        data,
        depth: options.depth,
        draft: options.draft,
        autosave: options.autosave,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async update<T = DocumentData>(
      slug: string,
      idOrOptions: number | string | LocalUpdateOptions,
      maybeDataOrOptions?: DocumentData | Omit<LocalUpdateOptions, 'id'>,
    ): Promise<T> {
      const collection = resolveCollection(config, slug)
      const { id, data, options } = resolveUpdatePayload(idOrOptions, maybeDataOrOptions)
      return updateOperation<T>({
        config,
        collection,
        id,
        data,
        depth: options.depth,
        draft: options.draft,
        autosave: options.autosave,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async delete<T = DocumentData>(
      slug: string,
      idOrOptions: number | string | LocalDeleteOptions,
      maybeOptions?: Omit<LocalDeleteOptions, 'id'>,
    ): Promise<T | null> {
      const collection = resolveCollection(config, slug)
      const { id, options } = resolveDeletePayload(idOrOptions, maybeOptions)
      return deleteOperation<T>({
        config,
        collection,
        id,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async publish<T = DocumentData>(
      slug: string,
      idOrOptions: number | string | LocalPublishOptions,
      maybeOptions?: Omit<LocalPublishOptions, 'id'>,
    ): Promise<T> {
      const collection = resolveCollection(config, slug)
      const options: LocalPublishOptions =
        typeof idOrOptions === 'object' && idOrOptions !== null
          ? idOrOptions
          : { id: idOrOptions, ...maybeOptions }
      const id = parseId(options.id)
      assertValidId(id)

      return publishOperation<T>({
        config,
        collection,
        id,
        depth: options.depth,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async unpublish<T = DocumentData>(
      slug: string,
      idOrOptions: number | string | LocalPublishOptions,
      maybeOptions?: Omit<LocalPublishOptions, 'id'>,
    ): Promise<T> {
      const collection = resolveCollection(config, slug)
      const options: LocalPublishOptions =
        typeof idOrOptions === 'object' && idOrOptions !== null
          ? idOrOptions
          : { id: idOrOptions, ...maybeOptions }
      const id = parseId(options.id)
      assertValidId(id)

      return unpublishOperation<T>({
        config,
        collection,
        id,
        depth: options.depth,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async findVersions(
      slug: string,
      idOrOptions: number | string,
      options: LocalFindVersionsOptions = {},
    ): Promise<PaginatedVersions> {
      const collection = resolveCollection(config, slug)
      const id = parseId(idOrOptions)
      assertValidId(id)

      return findVersionsOperation({
        config,
        collection,
        id,
        page: options.page,
        limit: options.limit,
        sort: options.sort,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async findVersionByID(
      slug: string,
      idOrOptions: number | string,
      versionIdOrOptions: number | string,
      options: LocalFindVersionByIDOptions = {},
    ): Promise<StoredVersion> {
      const collection = resolveCollection(config, slug)
      const id = parseId(idOrOptions)
      assertValidId(id)
      const versionId = parseId(versionIdOrOptions)
      assertValidId(versionId)

      return findVersionByIDOperation({
        config,
        collection,
        id,
        versionId,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async restoreVersion<T = DocumentData>(
      slug: string,
      idOrOptions: number | string,
      versionIdOrOptions: number | string,
      options: LocalRestoreVersionOptions = {},
    ): Promise<T> {
      const collection = resolveCollection(config, slug)
      const id = parseId(idOrOptions)
      assertValidId(id)
      const versionId = parseId(versionIdOrOptions)
      assertValidId(versionId)

      return restoreVersionOperation<T>({
        config,
        collection,
        id,
        versionId,
        draft: options.draft,
        depth: options.depth,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async findGlobal<T = DocumentData>(
      slug: string,
      options: LocalFindGlobalOptions = {},
    ): Promise<T> {
      const global = resolveGlobal(config, slug)
      return findGlobalOperation<T>({
        config,
        global,
        depth: options.depth,
        draft: options.draft,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async updateGlobal<T = DocumentData>(
      slug: string,
      dataOrOptions: DocumentData | LocalUpdateGlobalOptions = {},
    ): Promise<T> {
      const global = resolveGlobal(config, slug)
      const isOptions =
        'data' in dataOrOptions &&
        typeof dataOrOptions.data === 'object' &&
        dataOrOptions.data !== null
      const data = (isOptions ? dataOrOptions.data! : dataOrOptions) as DocumentData
      const options = isOptions ? (dataOrOptions as LocalUpdateGlobalOptions) : {}

      return updateGlobalOperation<T>({
        config,
        global,
        data,
        depth: options.depth,
        draft: options.draft,
        autosave: options.autosave,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async publishGlobal<T = DocumentData>(
      slug: string,
      options: LocalPublishGlobalOptions = {},
    ): Promise<T> {
      const global = resolveGlobal(config, slug)
      return publishGlobalOperation<T>({
        config,
        global,
        depth: options.depth,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async unpublishGlobal<T = DocumentData>(
      slug: string,
      options: LocalPublishGlobalOptions = {},
    ): Promise<T> {
      const global = resolveGlobal(config, slug)
      return unpublishGlobalOperation<T>({
        config,
        global,
        depth: options.depth,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async findGlobalVersions(
      slug: string,
      options: LocalFindGlobalVersionsOptions = {},
    ): Promise<PaginatedVersions> {
      const global = resolveGlobal(config, slug)
      return findGlobalVersionsOperation({
        config,
        global,
        page: options.page,
        limit: options.limit,
        sort: options.sort,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async findGlobalVersionByID(
      slug: string,
      versionIdOrOptions: number | string,
      options: LocalFindGlobalVersionByIDOptions = {},
    ): Promise<StoredVersion> {
      const global = resolveGlobal(config, slug)
      const versionId = parseId(versionIdOrOptions)
      assertValidId(versionId)

      return findGlobalVersionByIDOperation({
        config,
        global,
        versionId,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },

    async restoreGlobalVersion<T = DocumentData>(
      slug: string,
      versionIdOrOptions: number | string,
      options: LocalRestoreGlobalVersionOptions = {},
    ): Promise<T> {
      const global = resolveGlobal(config, slug)
      const versionId = parseId(versionIdOrOptions)
      assertValidId(versionId)

      return restoreGlobalVersionOperation<T>({
        config,
        global,
        versionId,
        draft: options.draft,
        depth: options.depth,
        overrideAccess: options.overrideAccess ?? defaults.overrideAccess ?? true,
        user: options.user === undefined ? defaults.user : options.user,
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      })
    },
  }
  return client
}
