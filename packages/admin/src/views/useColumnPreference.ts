import { useCallback, useMemo, useState } from 'react'
import type { ClientCollection, CollectionPermission } from '@lontar/core/client'
import { usePermissions } from '../context/PermissionsContext'
import {
  columnsStorageKey,
  readStoredColumns,
  resolveColumnKeys,
  sameColumns,
  selectableColumnKeys,
  titleColumnKey,
  writeStoredColumns,
  defaultColumnKeys,
} from './columns'

export interface ColumnPreference {
  /** The columns to render, in order. */
  keys: string[]
  /** Everything the picker offers. */
  selectable: string[]
  titleKey: string
  isCustomized: boolean
  toggle: (key: string, visible: boolean) => void
  reset: () => void
}

/** A user's column choice for one collection, kept in `localStorage` and scoped by user id. */
export function useColumnPreference(
  collection: ClientCollection,
  permission: CollectionPermission | undefined,
): ColumnPreference {
  const fieldPermissions = permission?.fields
  const { userId } = usePermissions()
  const storageKey = columnsStorageKey(userId, collection.slug)

  const [loaded, setLoaded] = useState(() => ({
    storageKey,
    stored: readStoredColumns(storageKey),
  }))
  // A different user or collection has its own choice, so read it before rendering anything.
  let current = loaded
  if (loaded.storageKey !== storageKey) {
    current = { storageKey, stored: readStoredColumns(storageKey) }
    setLoaded(current)
  }

  const keys = useMemo(
    () => resolveColumnKeys(collection, fieldPermissions, current.stored),
    [collection, fieldPermissions, current.stored],
  )
  const selectable = useMemo(
    () => selectableColumnKeys(collection, fieldPermissions),
    [collection, fieldPermissions],
  )
  const defaults = useMemo(
    () => defaultColumnKeys(collection, fieldPermissions),
    [collection, fieldPermissions],
  )

  const save = useCallback(
    (next: string[] | null) => {
      writeStoredColumns(storageKey, next)
      setLoaded({ storageKey, stored: next })
    },
    [storageKey],
  )

  const titleKey = titleColumnKey(collection)
  const toggle = useCallback(
    (key: string, visible: boolean) => {
      if (key === titleKey) return
      const next = new Set(keys)
      if (visible) next.add(key)
      else next.delete(key)
      save(selectable.filter((k) => next.has(k)))
    },
    [keys, selectable, titleKey, save],
  )

  const reset = useCallback(() => save(null), [save])

  return {
    keys,
    selectable,
    titleKey,
    isCustomized: !sameColumns(keys, defaults),
    toggle,
    reset,
  }
}
