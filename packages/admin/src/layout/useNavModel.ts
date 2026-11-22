import { useMemo } from 'react'
import type { ClientCollection, ClientGlobal } from '@lontar/core/client'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

export interface NavModel {
  collections: ClientCollection[]
  globals: ClientGlobal[] | undefined
  isAdmin: boolean
  canCreate: (slug: string) => boolean
}

/**
 * What the signed-in user can reach, shared by the sidebar and the command palette so the two
 * never disagree about which collections, globals and screens exist for them.
 */
export function useNavModel(): NavModel {
  const { config } = useAdmin()
  const { canReadCollection, canReadGlobal, canCreateInCollection } = usePermissions()
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

  return {
    collections,
    globals,
    isAdmin: user?.role === adminRole,
    canCreate: canCreateInCollection,
  }
}
