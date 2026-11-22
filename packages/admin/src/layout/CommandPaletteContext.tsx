import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface CommandPaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

/**
 * Whether a key event came from somewhere that is not ours. The admin lives inside a host page, so
 * ⌘K typed in the host's own search box, or anywhere else in its tree, belongs to the host.
 * Events from `document.body` (nothing focused) and from inside the admin are ours.
 */
export function isOutsideAdmin(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target === document.body || target === document.documentElement) return false
  return target.closest('.lontar-admin') === null
}

export function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 'k' &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.defaultPrevented &&
    !isOutsideAdmin(event.target)
  )
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const setOpen = useCallback((next: boolean) => setOpenState(next), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return
      event.preventDefault()
      setOpenState((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const value = useMemo(() => ({ open, setOpen }), [open, setOpen])
  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error('useCommandPalette must be used within a CommandPaletteProvider')
  }
  return ctx
}
