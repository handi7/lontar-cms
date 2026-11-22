import { useCallback, useState } from 'react'
import { usePermissions } from '../context/PermissionsContext'
import {
  readStoredViewMode,
  viewModeStorageKey,
  writeStoredViewMode,
  type ListViewMode,
} from './media'

export interface ViewModePreference {
  mode: ListViewMode
  setMode: (mode: ListViewMode) => void
}

/** Table or grid for one collection, kept in `localStorage` and scoped by user id like the columns. */
export function useViewMode(slug: string, enabled: boolean): ViewModePreference {
  const { userId } = usePermissions()
  const storageKey = viewModeStorageKey(userId, slug)
  const [loaded, setLoaded] = useState(() => ({
    storageKey,
    stored: readStoredViewMode(storageKey),
  }))
  let current = loaded
  if (loaded.storageKey !== storageKey) {
    current = { storageKey, stored: readStoredViewMode(storageKey) }
    setLoaded(current)
  }

  const setMode = useCallback(
    (mode: ListViewMode) => {
      writeStoredViewMode(storageKey, mode)
      setLoaded({ storageKey, stored: mode })
    },
    [storageKey],
  )

  // Only upload collections have a grid; the others always show the table.
  return { mode: enabled ? (current.stored ?? 'table') : 'table', setMode }
}
