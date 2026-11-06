import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// Radix primitives portal into document.body, which is outside the
// .lontar-admin wrapper every admin style is scoped to, so portalled content
// would render unstyled. ADR 0019 rule 3: every *.Portal gets an explicit
// container pointing at a node inside the wrapper. The wrappers in
// components/ui are the only place that reads this, and eslint's
// no-restricted-imports keeps Radix out of everywhere else so the container
// cannot be bypassed.

export interface PortalContainerContextValue {
  /** Null until the target node has mounted, on the render after the first. */
  container: HTMLElement | null
}

export const PortalContainerContext = createContext<PortalContainerContextValue | null>(null)

export function usePortalContainer(): HTMLElement | null {
  const ctx = useContext(PortalContainerContext)
  if (!ctx) {
    throw new Error('usePortalContainer must be used within a PortalContainerProvider')
  }
  return ctx.container
}

export function PortalContainerProvider({ children }: { children: ReactNode }) {
  // A callback ref into state, not useRef: the context value has to change once
  // the node exists, and mutating a ref does not re-render the consumers.
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const value = useMemo(() => ({ container }), [container])

  return (
    <PortalContainerContext.Provider value={value}>
      {children}
      <div ref={setContainer} className="lontar-portal-root" />
    </PortalContainerContext.Provider>
  )
}
