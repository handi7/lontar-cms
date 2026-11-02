import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { DocumentData, PaginatedDocs } from '../database/adapter'
import {
  createOperation,
  deleteOperation,
  findByIDOperation,
  findGlobalOperation,
  findOperation,
  NotFoundError,
  updateGlobalOperation,
  updateOperation,
  ValidationError,
} from '../operations'
import type { Where } from '../query/types'

export interface LocalFindOptions {
  where?: Where
  sort?: string
  page?: number
  limit?: number
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalFindByIDOptions {
  id?: number | string
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalCreateOptions {
  data?: DocumentData
  depth?: number
  overrideAccess?: boolean
  user?: AuthUser | null
}

export interface LocalUpdateOptions {
  id?: number | string
  data?: DocumentData
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

export interface LontarClient {
  readonly config: Config
  find<T = DocumentData>(
    collectionSlug: string,
    options?: LocalFindOptions,
  ): Promise<PaginatedDocs<T>>
  findByID<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalFindByIDOptions,
    maybeOptions?: Omit<LocalFindByIDOptions, 'id'>,
  ): Promise<T | null>
  create<T = DocumentData>(
    collectionSlug: string,
    dataOrOptions: DocumentData | LocalCreateOptions,
  ): Promise<T>
  update<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalUpdateOptions,
    maybeDataOrOptions?: DocumentData | Omit<LocalUpdateOptions, 'id'>,
  ): Promise<T>
  delete<T = DocumentData>(
    collectionSlug: string,
    idOrOptions: number | string | LocalDeleteOptions,
    maybeOptions?: Omit<LocalDeleteOptions, 'id'>,
  ): Promise<T | null>
  findGlobal<T = DocumentData>(globalSlug: string, options?: LocalFindGlobalOptions): Promise<T>
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
