import { useMemo } from 'react'
import type { ClientCollection, ClientCustomView, ClientGlobal } from '@lontar/core/client'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

export interface NavModel {
  collections: ClientCollection[]
  globals: ClientGlobal[] | undefined
  /** Custom views the user may see, in config order. */
  views: ClientCustomView[]
  isAdmin: boolean
  canCreate: (slug: string) => boolean
}

/**
 * What the signed-in user can reach, shared by the sidebar and the command palette so the two
 * never disagree about which collections, globals and screens exist for them.
 */
export function useNavModel(): NavModel {
  const { config } = useAdmin()
  const { canReadCollection, canReadGlobal, canCreateInCollection, canViewCustomView } =
    usePermissions()
  const { user } = useAuth()
  const adminRole = config.auth?.adminRole ?? 'admin'

  const collections = useMemo(
    () => config.collections.filter((col) => canReadCollection(col.slug)),
    [config.collections, canReadCollection],
  )
  const globals = useMemo(
    () => config.globals?.filter((g) => canReadGlobal(g.slug)),
    [config.globals, canReadGlobal],
  )

  const views = useMemo(
    () => (config.admin?.views ?? []).filter((view) => canViewCustomView(view.key)),
    [config.admin?.views, canViewCustomView],
  )

  return {
    collections,
    globals,
    views,
    isAdmin: user?.role === adminRole,
    canCreate: canCreateInCollection,
  }
}
