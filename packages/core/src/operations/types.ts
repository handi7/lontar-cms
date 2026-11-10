import type { AuthUser } from '../auth/types'
import type { CollectionConfig, Config, GlobalConfig } from '../config/types'
import type { DocumentData } from '../database/adapter'
import type { Where } from '../query/types'

export interface OperationContext {
  config: Config
  user?: AuthUser | null
  overrideAccess?: boolean
  req?: Request
}

export interface FindOperationArgs extends OperationContext {
  collection: CollectionConfig
  where?: Where
  sort?: string
  page?: number
  limit?: number
  depth?: number
  draft?: boolean
}

export interface FindByIDOperationArgs extends OperationContext {
  collection: CollectionConfig
  id: number
  depth?: number
  draft?: boolean
}

export interface CreateOperationArgs extends OperationContext {
  collection: CollectionConfig
  data: DocumentData
  depth?: number
  draft?: boolean
  autosave?: boolean
}

export interface UpdateOperationArgs extends OperationContext {
  collection: CollectionConfig
  id: number
  data: DocumentData
  depth?: number
  draft?: boolean
  autosave?: boolean
}

export interface DeleteOperationArgs extends OperationContext {
  collection: CollectionConfig
  id: number
}

export interface FindGlobalOperationArgs extends OperationContext {
  global: GlobalConfig
  depth?: number
  draft?: boolean
}

export interface UpdateGlobalOperationArgs extends OperationContext {
  global: GlobalConfig
  data: DocumentData
  depth?: number
  draft?: boolean
  autosave?: boolean
}
