import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  CollectionPermission,
  GlobalPermission,
  PermissionsResponse,
} from '@lontar/core/client'
import {
  fetchDocumentPermissions,
  fetchGlobalPermissions,
  fetchPermissions,
  queryKeys,
} from '../api/client'
import { AuthContext } from './AuthContext'

export interface PermissionsContextValue {
  permissions: PermissionsResponse | null
  isLoading: boolean
  isPermissionsLoading: boolean
  error: Error | null
  userId: string | null
  getCollectionPermission: (slug: string) => CollectionPermission | undefined
  getGlobalPermission: (slug: string) => GlobalPermission | undefined
  canReadCollection: (slug: string) => boolean
  canCreateInCollection: (slug: string) => boolean
  canDeleteInCollection: (slug: string) => boolean
  canReadGlobal: (slug: string) => boolean
  canUpdateGlobal: (slug: string) => boolean
  /**
   * Whether a custom view is shown to this user. False until the permissions say true, unlike
   * the collection helpers: a view must stay hidden while they load. Cosmetic only; the endpoints
   * a view calls enforce access.
   */
  canViewCustomView: (key: string) => boolean
  canExecuteCollectionAction: (slug: string, actionKey: string) => boolean
  canExecuteGlobalAction: (slug: string, actionKey: string) => boolean
}

export const PermissionsContext = createContext<PermissionsContextValue | null>(null)

export interface PermissionsProviderProps {
  apiBase: string
  children: ReactNode
  user?: { id: string } | null
}

export function PermissionsProvider({
  apiBase,
  user: propUser,
  children,
}: PermissionsProviderProps) {
  const auth = useContext(AuthContext)
  const user = propUser !== undefined ? propUser : auth?.user

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.permissions(apiBase, user?.id),
    queryFn: () => fetchPermissions(apiBase),
    staleTime: 1000 * 60 * 5,
    enabled: Boolean(user),
  })

  const value = useMemo<PermissionsContextValue>(() => {
    const permissions = data ?? null

    const getCollectionPermission = (slug: string): CollectionPermission | undefined => {
      return permissions?.collections?.[slug]
    }

    const getGlobalPermission = (slug: string): GlobalPermission | undefined => {
      return permissions?.globals?.[slug]
    }

    const canReadCollection = (slug: string): boolean => {
      const p = getCollectionPermission(slug)
      return p ? p.read !== false : true
    }

    const canCreateInCollection = (slug: string): boolean => {
      const p = getCollectionPermission(slug)
      return p ? p.create !== false : true
    }

    const canDeleteInCollection = (slug: string): boolean => {
      const p = getCollectionPermission(slug)
      return p ? p.delete !== false : true
    }

    const canReadGlobal = (slug: string): boolean => {
      const p = getGlobalPermission(slug)
      return p ? p.read !== false : true
    }

    const canUpdateGlobal = (slug: string): boolean => {
      const p = getGlobalPermission(slug)
      return p ? p.update !== false : true
    }

    const canViewCustomView = (key: string): boolean => permissions?.views?.[key] === true

    const canExecuteCollectionAction = (slug: string, actionKey: string): boolean => {
      const p = getCollectionPermission(slug)
      return p ? p.actions?.[actionKey] !== false : true
    }

    const canExecuteGlobalAction = (slug: string, actionKey: string): boolean => {
      const p = getGlobalPermission(slug)
      return p ? p.actions?.[actionKey] !== false : true
    }

    return {
      permissions,
      isLoading,
      isPermissionsLoading: Boolean(user && isLoading),
      error: error ?? null,
      userId: user?.id ?? null,
      getCollectionPermission,
      getGlobalPermission,
      canReadCollection,
      canCreateInCollection,
      canDeleteInCollection,
      canReadGlobal,
      canUpdateGlobal,
      canViewCustomView,
      canExecuteCollectionAction,
      canExecuteGlobalAction,
    }
  }, [data, isLoading, error, user])

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext)
  if (!ctx) {
    throw new Error('usePermissions must be used within a PermissionsProvider')
  }
  return ctx
}

export function useDocumentPermissions(
  apiBase: string,
  slug: string,
  id?: string | number,
  hasDrafts?: boolean,
) {
  const { getCollectionPermission, userId } = usePermissions()
  const fallback = getCollectionPermission(slug)

  const query = useQuery({
    queryKey:
      id !== undefined
        ? queryKeys.documentPermissions(apiBase, slug, id, hasDrafts, userId)
        : ['_lontar_document_permissions', apiBase, slug, 'anonymous', userId ?? 'anonymous'],
    queryFn: () =>
      id !== undefined ? fetchDocumentPermissions(apiBase, slug, id, { draft: hasDrafts }) : null,
    enabled: id !== undefined && Boolean(slug),
    staleTime: 1000 * 60,
  })

  return {
    data: query.data ?? fallback,
    isLoading: query.isLoading,
    error: query.error ?? null,
  }
}

export function useGlobalPermissions(apiBase: string, slug: string) {
  const { getGlobalPermission, userId } = usePermissions()
  const fallback = getGlobalPermission(slug)

  const query = useQuery({
    queryKey: queryKeys.globalPermissions(apiBase, slug, userId),
    queryFn: () => fetchGlobalPermissions(apiBase, slug),
    enabled: Boolean(slug),
    staleTime: 1000 * 60,
  })

  return {
    data: query.data ?? fallback,
    isLoading: query.isLoading,
    error: query.error ?? null,
  }
}
