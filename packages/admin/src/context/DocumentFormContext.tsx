import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { getValueByPath } from '@lontar/core/client'

export interface DocumentFormValue {
  /** The form's current values, as the editor sees them. */
  values: Record<string, unknown>
  /** One value by dotted path, e.g. `seo.title` or `rows.0.note`. */
  getValue: (path: string) => unknown
}

const EMPTY: Record<string, unknown> = {}

const DocumentFormContext = createContext<DocumentFormValue>({
  values: EMPTY,
  getValue: () => undefined,
})

export interface DocumentFormProviderProps {
  values: Record<string, unknown>
  children: ReactNode
}

export function DocumentFormProvider({ values, children }: DocumentFormProviderProps) {
  const value = useMemo<DocumentFormValue>(
    () => ({ values, getValue: (path) => getValueByPath(values, path) }),
    [values],
  )
  return <DocumentFormContext.Provider value={value}>{children}</DocumentFormContext.Provider>
}

/**
 * The document being edited, read-only, for field components that depend on sibling values. It
 * has no setter on purpose: a component writes only its own value, through `onChange`, so access
 * locks and validation stay in force.
 */
export function useDocumentForm(): DocumentFormValue {
  return useContext(DocumentFormContext)
}
