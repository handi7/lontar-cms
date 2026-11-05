import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchSession,
  setOnUnauthorized,
  signIn as apiSignIn,
  signOut as apiSignOut,
  type AdminSession,
  type AdminUser,
} from '../api/client'

export interface AuthContextValue {
  user: AdminUser | null
  session: AdminSession | null
  isLoading: boolean
  signIn: (credentials: { email: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

function clearUserData(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.removeQueries({
    predicate: (query) => !String(query.queryKey[0]).startsWith('_lontar_'),
  })
}

export function AuthProvider({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['_lontar_session', apiBase],
    queryFn: () => fetchSession(apiBase),
    staleTime: 1000 * 60 * 5,
  })

  const userId = data?.user?.id
  const prevUserIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (prevUserIdRef.current && userId && prevUserIdRef.current !== userId) {
      clearUserData(queryClient)
    }
    prevUserIdRef.current = userId
  }, [userId, queryClient])

  useEffect(() => {
    setOnUnauthorized(() => {
      clearUserData(queryClient)
      queryClient.setQueryData(['_lontar_session', apiBase], null)
      void queryClient.invalidateQueries({ queryKey: ['_lontar_session'] })
    })
    return () => {
      setOnUnauthorized(null)
    }
  }, [queryClient, apiBase])

  const signInMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiSignIn(apiBase, credentials),
    onSuccess: async (result) => {
      const sessionData = await fetchSession(apiBase)
      queryClient.setQueryData(
        ['_lontar_session', apiBase],
        sessionData ??
          (result.user ? { user: result.user, session: result.session ?? null } : null),
      )
    },
  })

  const signOutMutation = useMutation({
    mutationFn: () => apiSignOut(apiBase),
    onSuccess: () => {
      clearUserData(queryClient)
      queryClient.setQueryData(['_lontar_session', apiBase], null)
      void queryClient.invalidateQueries({ queryKey: ['_lontar_session'] })
    },
  })

  const value = useMemo<AuthContextValue>(
    () => ({
      user: data?.user ?? null,
      session: data?.session ?? null,
      isLoading,
      signIn: async (credentials) => {
        await signInMutation.mutateAsync(credentials)
      },
      signOut: async () => {
        await signOutMutation.mutateAsync()
      },
    }),
    [data, isLoading, signInMutation, signOutMutation],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
