import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchSession,
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

export function AuthProvider({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['_lontar_session', apiBase],
    queryFn: () => fetchSession(apiBase),
    staleTime: 1000 * 60 * 5,
  })

  const signInMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiSignIn(apiBase, credentials),
    onSuccess: (result) => {
      queryClient.setQueryData(['_lontar_session', apiBase], result)
    },
  })

  const signOutMutation = useMutation({
    mutationFn: () => apiSignOut(apiBase),
    onSuccess: () => {
      queryClient.setQueryData(['_lontar_session', apiBase], null)
      void queryClient.invalidateQueries()
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
