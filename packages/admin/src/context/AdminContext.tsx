import { createContext, useContext } from 'react'
import type { ClientCollection, ClientConfig } from '@lontar/core/client'

export interface AdminContextValue {
  config: ClientConfig
  apiBase: string
  basePath: string
}

export const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext)
  if (!ctx) {
    throw new Error('useAdmin must be used within an AdminContext.Provider')
  }
  return ctx
}

export function useCollection(slug?: string): ClientCollection | undefined {
  const { config } = useAdmin()
  if (!slug) return undefined
  return config.collections.find((c) => c.slug === slug)
}
