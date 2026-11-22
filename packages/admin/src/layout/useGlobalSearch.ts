import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { searchDocs } from '../api/client'
import { useAdmin } from '../context/AdminContext'

export const SEARCH_DEBOUNCE_MS = 250

/** The typed text, as it was a moment ago. Typing never waits on the network. */
function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/**
 * Searches every collection the user can read for `term` (`GET /_lontar/search`), after a short
 * pause in typing. Idle while `enabled` is false or the term is blank.
 */
export function useGlobalSearch(term: string, locale: string | undefined, enabled: boolean) {
  const { apiBase } = useAdmin()
  const debounced = useDebounced(term.trim(), SEARCH_DEBOUNCE_MS)
  const active = enabled && debounced !== ''

  const query = useQuery({
    queryKey: ['global-search', debounced, locale],
    queryFn: ({ signal }) => searchDocs(apiBase, debounced, { locale, signal }),
    enabled: active,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })

  return {
    results: active ? (query.data ?? []) : [],
    // True from the first keystroke until the answer for the current text has arrived.
    isSearching: enabled && term.trim() !== '' && (debounced !== term.trim() || query.isFetching),
    isError: active && query.isError,
  }
}
