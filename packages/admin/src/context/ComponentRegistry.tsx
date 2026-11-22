import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react'

/**
 * Components a host registers on `<Admin components>`, by the string key the config refers to.
 * Each slot (field input, dashboard widget, custom view) has its own props interface, so the
 * registry itself does not constrain them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- slot props differ per slot
export type AdminComponents = Record<string, ComponentType<any>>

interface ComponentRegistryValue {
  components: AdminComponents
  /** True the first time a missing key is reported, so each key warns once. */
  reportMissing: (key: string) => boolean
}

const EMPTY: AdminComponents = {}

const ComponentRegistryContext = createContext<ComponentRegistryValue>({
  components: EMPTY,
  reportMissing: () => false,
})

export interface ComponentRegistryProviderProps {
  components?: AdminComponents
  children: ReactNode
}

export function ComponentRegistryProvider({
  components = EMPTY,
  children,
}: ComponentRegistryProviderProps) {
  const reported = useRef(new Set<string>())
  const value = useMemo<ComponentRegistryValue>(
    () => ({
      components,
      reportMissing: (key) => {
        if (reported.current.has(key)) return false
        reported.current.add(key)
        return true
      },
    }),
    [components],
  )
  return (
    <ComponentRegistryContext.Provider value={value}>{children}</ComponentRegistryContext.Provider>
  )
}

export function useComponentRegistry(): ComponentRegistryValue {
  return useContext(ComponentRegistryContext)
}
