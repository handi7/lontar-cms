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
  NotFoundError,
  publishOperation,
  restoreVersionOperation,
  unpublishOperation,
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
}

export interface LocalFindByIDOptions {
  id?: number | string
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
}

export interface LocalCreateOptions {
  data?: DocumentData
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
}

export interface LocalUpdateOptions {
  id?: number | string
  data?: DocumentData
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
  draft?: boolean
}

export interface LocalPublishOptions {
  id?: number | string
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalFindVersionsOptions {
  page?: number
  limit?: number
  sort?: string
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalFindVersionByIDOptions {
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalRestoreVersionOptions {
  draft?: boolean
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalDeleteOptions {
  id?: number | string
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalFindGlobalOptions {
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalUpdateGlobalOptions {
  data?: DocumentData
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
}

// Target for module augmentation from generated types (lontar generate:types)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LontarCollections {}

// Target for module augmentation from generated types (lontar generate:types)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LontarGlobals {}

export interface LontarClient {
  readonly config: Config
  find<K extends keyof LontarCollections>(
    collectionSlug: K,
    options?: LocalFindOptions,
  ): Promise<PaginatedDocs<LontarCollections[K]>>
  find<T = DocumentData>(
    collectionSlug: string,
    options?: LocalFindOptions,
  ): Promise<PaginatedDocs<T>>

  findByID<K extends keyof LontarCollections>(
    collectionSlug: K,
    idOrOptions: number | string | LocalFindByIDOptions,
    maybeOptions?: Omit<LocalFindByIDOptions, 'id'>,
  ): Promise<LontarCollections[K] | null>
  findByID<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalFindByIDOptions,
    maybeOptions?: Omit<LocalFindByIDOptions, 'id'>,
  ): Promise<T | null>

  create<K extends keyof LontarCollections>(
    collectionSlug: K,
    dataOrOptions: Partial<LontarCollections[K]> | LocalCreateOptions,
  ): Promise<LontarCollections[K]>
  create<T = DocumentData>(
    collectionSlug: string,
    dataOrOptions: DocumentData | LocalCreateOptions,
  ): Promise<T>

  update<K extends keyof LontarCollections>(
    collectionSlug: K,
    idOrOptions: number | string | LocalUpdateOptions,
    maybeDataOrOptions?: Partial<LontarCollections[K]> | Omit<LocalUpdateOptions, 'id'>,
  ): Promise<LontarCollections[K]>
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

  findGlobal<K extends keyof LontarGlobals>(
    globalSlug: K,
    options?: LocalFindGlobalOptions,
  ): Promise<LontarGlobals[K]>
  findGlobal<T = DocumentData>(globalSlug: string, options?: LocalFindGlobalOptions): Promise<T>

  updateGlobal<K extends keyof LontarGlobals>(
    globalSlug: K,
    dataOrOptions?: Partial<LontarGlobals[K]> | LocalUpdateGlobalOptions,
  ): Promise<LontarGlobals[K]>
  updateGlobal<T = DocumentData>(
    globalSlug: string,
    dataOrOptions?: DocumentData | LocalUpdateGlobalOptions,
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

export function getLontar(config: Config): Promise<LontarClient> {
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
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
        overrideAccess: options.overrideAccess ?? true,
        user: options.user,
      })
    },
  }
  return Promise.resolve(client)
}
