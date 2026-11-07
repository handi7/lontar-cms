import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { ClientGlobal } from '@lontar/core/client'
import type { AdminUser } from '../api/client'
import { Button } from '../components/ui/button'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'
import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'

// The active state keys on the `data-status="active"` attribute TanStack Router
// sets on a matching Link, not on `activeProps`. The router concatenates
// `activeProps.className` onto `className` without running it through cn(), so
// an active `lt:text-foreground` would sit next to the base
// `lt:text-muted-foreground` and the winner would be whichever Tailwind emits
// later. A `data-[status=active]:` variant always sorts after the base utility.
const navLinkClass =
  'lt:block lt:rounded-md lt:px-3 lt:py-2 lt:font-medium lt:text-muted-foreground lt:no-underline lt:transition-colors lt:hover:bg-accent lt:hover:text-foreground lt:data-[status=active]:bg-accent lt:data-[status=active]:font-semibold lt:data-[status=active]:text-foreground'

const navGroupClass = 'lt:flex lt:flex-col lt:gap-1'

function NavTitle({ children }: { children: string }) {
  return (
    <div className="lt:px-3 lt:py-1 lt:text-xs lt:font-semibold lt:tracking-wider lt:text-muted-foreground lt:uppercase">
      {children}
    </div>
  )
}

function GlobalsNav({ globals }: { globals?: ClientGlobal[] }) {
  if (!globals || globals.length === 0) return null
  return (
    <div className={navGroupClass}>
      <NavTitle>Globals</NavTitle>
      {globals.map((g) => (
        <Link key={g.slug} to="/globals/$slug" params={{ slug: g.slug }} className={navLinkClass}>
          {g.label}
        </Link>
      ))}
    </div>
  )
}

function SidebarUserProfile({
  user,
  onSignOut,
  isSigningOut,
}: {
  user: AdminUser
  onSignOut: () => void
  isSigningOut: boolean
}) {
  const initial = (user.name?.[0] || user.email?.[0] || 'A').toUpperCase()

  return (
    <div className="lt:flex lt:flex-col lt:gap-3 lt:border-t lt:bg-card lt:p-4">
      <ThemeToggle />
      <div className="lt:flex lt:items-center lt:gap-3">
        <div className="lt:flex lt:size-[34px] lt:shrink-0 lt:items-center lt:justify-center lt:rounded-full lt:bg-primary lt:text-sm lt:font-semibold lt:text-primary-foreground">
          {initial}
        </div>
        <div className="lt:flex lt:min-w-0 lt:flex-col">
          <span className="lt:truncate lt:text-[0.8125rem] lt:font-semibold lt:text-foreground">
            {user.name || 'Admin'}
          </span>
          <span className="lt:truncate lt:text-xs lt:text-muted-foreground">{user.email}</span>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onSignOut}
        disabled={isSigningOut}
        className="lt:w-full lt:text-muted-foreground lt:shadow-none lt:hover:border-destructive lt:hover:text-destructive"
        aria-label="Sign out"
      >
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </Button>
    </div>
  )
}

export function Sidebar() {
  const { config } = useAdmin()
  const { user, signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await signOut()
    } catch {
      // Failed to sign out on server; remain signed in
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <aside className="lt:flex lt:w-[250px] lt:shrink-0 lt:flex-col lt:border-r lt:bg-card">
      <div className="lt:border-b lt:px-6 lt:py-5">
        <Link
          to="/"
          className="lt:flex lt:items-center lt:gap-2.5 lt:text-lg lt:font-bold lt:text-foreground lt:no-underline"
        >
          <BrandMark />
        </Link>
      </div>

      <nav className="lt:flex lt:flex-1 lt:flex-col lt:gap-5 lt:px-3 lt:py-4">
        <div className={navGroupClass}>
          <Link to="/" activeOptions={{ exact: true }} className={navLinkClass}>
            Dashboard
          </Link>
        </div>

        <div className={navGroupClass}>
          <NavTitle>Collections</NavTitle>
          {config.collections.map((col) => (
            <Link
              key={col.slug}
              to="/$collection"
              params={{ collection: col.slug }}
              className={navLinkClass}
            >
              {col.labels.plural}
            </Link>
          ))}
        </div>

        <GlobalsNav globals={config.globals} />
      </nav>

      {user && (
        <SidebarUserProfile
          user={user}
          onSignOut={() => {
            void handleSignOut()
          }}
          isSigningOut={isSigningOut}
        />
      )}
    </aside>
  )
}
