import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import type { ClientCollection, ClientCustomView, ClientGlobal } from '@lontar/core/client'
import type { AdminUser } from '../api/client'
import { Button } from '../components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/utils'
import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'
import { useCommandPalette } from './CommandPaletteContext'
import { useNavModel } from './useNavModel'
import { useSidebarCollapsed } from './useSidebarCollapsed'

// The active state keys on the `data-status="active"` attribute TanStack Router
// sets on a matching Link, not on `activeProps`. The router concatenates
// `activeProps.className` onto `className` without running it through cn(), so
// an active `lt:text-foreground` would sit next to the base
// `lt:text-muted-foreground` and the winner would be whichever Tailwind emits
// later. A `data-[status=active]:` variant always sorts after the base utility.
const navLinkClass =
  'lt:block lt:rounded-md lt:px-3 lt:py-2 lt:font-medium lt:text-muted-foreground lt:no-underline lt:transition-colors lt:hover:bg-accent lt:hover:text-foreground lt:data-[status=active]:bg-accent lt:data-[status=active]:font-semibold lt:data-[status=active]:text-foreground'

const navGroupClass = 'lt:flex lt:flex-col lt:gap-1'

interface NavTitleProps {
  collapsed: boolean
  children: string
}

function NavTitle({ collapsed, children }: NavTitleProps) {
  // The rail has no room for a heading, so a rule keeps the groups apart.
  if (collapsed) return <div role="separator" className="lt:mx-2 lt:h-px lt:bg-border" />
  return (
    <div className="lt:px-3 lt:py-1 lt:text-xs lt:font-semibold lt:tracking-wider lt:text-muted-foreground lt:uppercase">
      {children}
    </div>
  )
}

interface NavItemRenderProps {
  className: string
  content: ReactNode
}

interface NavItemProps {
  label: string
  collapsed: boolean
  render: (props: NavItemRenderProps) => ReactNode
}

// An expanded item shows its label. A collapsed one shows the label's initial, keeps the label for
// screen readers, and explains itself in a tooltip.
function NavItem({ label, collapsed, render }: NavItemProps) {
  if (!collapsed) return <>{render({ className: navLinkClass, content: label })}</>

  const link = render({
    className: cn(navLinkClass, 'lt:px-0 lt:text-center'),
    content: (
      <>
        <span aria-hidden="true">{(label[0] ?? '').toUpperCase()}</span>
        <span className="lt:sr-only">{label}</span>
      </>
    ),
  })
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

interface ViewsNavProps {
  views: ClientCustomView[]
  collapsed: boolean
}

function ViewsNav({ views, collapsed }: ViewsNavProps) {
  if (views.length === 0) return null
  return (
    <div className={navGroupClass}>
      <NavTitle collapsed={collapsed}>Views</NavTitle>
      {views.map((view) => (
        <NavItem
          key={view.key}
          label={view.label}
          collapsed={collapsed}
          render={({ className, content }) => (
            <Link to="/views/$key" params={{ key: view.key }} className={className}>
              {content}
            </Link>
          )}
        />
      ))}
    </div>
  )
}

interface GlobalsNavProps {
  globals?: ClientGlobal[]
  collapsed: boolean
}

function GlobalsNav({ globals, collapsed }: GlobalsNavProps) {
  if (!globals || globals.length === 0) return null
  return (
    <div className={navGroupClass}>
      <NavTitle collapsed={collapsed}>Globals</NavTitle>
      {globals.map((g) => (
        <NavItem
          key={g.slug}
          label={g.label}
          collapsed={collapsed}
          render={({ className, content }) => (
            <Link to="/globals/$slug" params={{ slug: g.slug }} className={className}>
              {content}
            </Link>
          )}
        />
      ))}
    </div>
  )
}

interface AccountLinkProps {
  user: AdminUser
  collapsed: boolean
}

function AccountLink({ user, collapsed }: AccountLinkProps) {
  const initial = (user.name?.[0] || user.email?.[0] || 'A').toUpperCase()
  const link = (
    <Link
      to="/account"
      className={cn(
        'lt:flex lt:items-center lt:gap-3 lt:rounded-md lt:p-1.5 lt:no-underline lt:transition-colors lt:hover:bg-accent',
        collapsed && 'lt:justify-center',
      )}
      aria-label="Account settings"
    >
      <div className="lt:flex lt:size-[34px] lt:shrink-0 lt:items-center lt:justify-center lt:rounded-full lt:bg-primary lt:text-sm lt:font-semibold lt:text-primary-foreground">
        {initial}
      </div>
      {!collapsed && (
        <div className="lt:flex lt:min-w-0 lt:flex-col">
          <span className="lt:truncate lt:text-[0.8125rem] lt:font-semibold lt:text-foreground">
            {user.name || 'Admin'}
          </span>
          <span className="lt:truncate lt:text-xs lt:text-muted-foreground">{user.email}</span>
        </div>
      )}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{user.name || user.email}</TooltipContent>
    </Tooltip>
  )
}

interface SignOutButtonProps {
  onSignOut: () => void
  isSigningOut: boolean
  collapsed: boolean
}

function SignOutButton({ onSignOut, isSigningOut, collapsed }: SignOutButtonProps) {
  const label = isSigningOut ? 'Signing out...' : 'Sign out'
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onSignOut}
      disabled={isSigningOut}
      className="lt:w-full lt:text-muted-foreground lt:shadow-none lt:hover:border-destructive lt:hover:text-destructive"
      aria-label="Sign out"
    >
      {collapsed ? <LogOut aria-hidden="true" /> : label}
    </Button>
  )
}

export interface SidebarUserProfileProps {
  user: AdminUser
  onSignOut: () => void
  isSigningOut: boolean
  collapsed: boolean
}

function SidebarUserProfile(props: SidebarUserProfileProps) {
  const { user, onSignOut, isSigningOut, collapsed } = props
  return (
    <div
      className={cn(
        'lt:flex lt:shrink-0 lt:flex-col lt:gap-3 lt:border-t lt:bg-card lt:p-4',
        collapsed && 'lt:items-center lt:px-2',
      )}
    >
      <ThemeToggle compact={collapsed} />
      <AccountLink user={user} collapsed={collapsed} />
      <SignOutButton onSignOut={onSignOut} isSigningOut={isSigningOut} collapsed={collapsed} />
    </div>
  )
}

const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

interface PaletteButtonProps {
  collapsed: boolean
  onOpen: () => void
}

function PaletteButton({ collapsed, onOpen }: PaletteButtonProps) {
  const shortcut = isApple() ? '⌘K' : 'Ctrl K'
  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Open command palette"
      aria-keyshortcuts="Control+K Meta+K"
      onClick={onOpen}
      className={cn(
        'lt:w-full lt:text-muted-foreground lt:shadow-none',
        !collapsed && 'lt:justify-between',
      )}
    >
      <Search aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="lt:mr-auto">Search</span>
          <kbd className="lt:text-xs lt:text-muted-foreground">{shortcut}</kbd>
        </>
      )}
    </Button>
  )
  if (!collapsed) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">Search ({shortcut})</TooltipContent>
    </Tooltip>
  )
}

interface SidebarBodyProps {
  collapsed: boolean
  collections: ClientCollection[]
  globals?: ClientGlobal[]
  views: ClientCustomView[]
  isAdmin: boolean
  user: AdminUser | null
  onSignOut: () => void
  isSigningOut: boolean
  onOpenPalette: () => void
  /** A link in the nav was followed; the drawer closes on it. */
  onNavigate?: () => void
  /** The brand row's trailing control (the collapse toggle). */
  headerAction?: ReactNode
}

function SidebarBody(props: SidebarBodyProps) {
  const { collapsed, collections, globals, views, isAdmin, user, headerAction, onNavigate } = props
  return (
    <>
      <div
        className={cn(
          'lt:flex lt:shrink-0 lt:items-center lt:justify-between lt:gap-2 lt:border-b lt:py-5',
          collapsed ? 'lt:flex-col lt:px-2' : 'lt:px-6',
        )}
      >
        <Link
          to="/"
          aria-label="Lontar CMS"
          className="lt:flex lt:items-center lt:gap-2.5 lt:text-lg lt:font-bold lt:text-foreground lt:no-underline"
        >
          {collapsed ? (
            <span className="lt:flex lt:size-7 lt:items-center lt:justify-center lt:rounded-md lt:bg-primary lt:text-sm lt:font-extrabold lt:text-primary-foreground">
              L
            </span>
          ) : (
            <BrandMark />
          )}
        </Link>
        {headerAction}
      </div>

      <div className={cn('lt:shrink-0 lt:pt-4', collapsed ? 'lt:px-2' : 'lt:px-3')}>
        <PaletteButton
          collapsed={collapsed}
          onOpen={() => {
            onNavigate?.()
            props.onOpenPalette()
          }}
        />
      </div>

      {/* Following any link inside the nav, from a drawer, should put the drawer away. */}
      <nav
        className={cn(
          'lt:flex lt:min-h-0 lt:flex-1 lt:flex-col lt:gap-5 lt:overflow-y-auto lt:py-4',
          collapsed ? 'lt:px-2' : 'lt:px-3',
        )}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) onNavigate?.()
        }}
      >
        <div className={navGroupClass}>
          <NavItem
            label="Dashboard"
            collapsed={collapsed}
            render={({ className, content }) => (
              <Link to="/" activeOptions={{ exact: true }} className={className}>
                {content}
              </Link>
            )}
          />
        </div>

        {collections.length > 0 && (
          <div className={navGroupClass}>
            <NavTitle collapsed={collapsed}>Collections</NavTitle>
            {collections.map((col) => (
              <NavItem
                key={col.slug}
                label={col.labels.plural}
                collapsed={collapsed}
                render={({ className, content }) => (
                  <Link to="/$collection" params={{ collection: col.slug }} className={className}>
                    {content}
                  </Link>
                )}
              />
            ))}
          </div>
        )}

        <GlobalsNav globals={globals} collapsed={collapsed} />

        <ViewsNav views={views} collapsed={collapsed} />

        {isAdmin && (
          <div className={navGroupClass}>
            <NavTitle collapsed={collapsed}>Administration</NavTitle>
            <NavItem
              label="Users"
              collapsed={collapsed}
              render={({ className, content }) => (
                <Link to="/users" className={className}>
                  {content}
                </Link>
              )}
            />
          </div>
        )}
      </nav>

      {user && (
        <SidebarUserProfile
          user={user}
          onSignOut={props.onSignOut}
          isSigningOut={props.isSigningOut}
          collapsed={collapsed}
        />
      )}
    </>
  )
}

export function Sidebar() {
  const { user, signOut } = useAuth()
  const { collections, globals, views, isAdmin } = useNavModel()
  const { setOpen: setPaletteOpen } = useCommandPalette()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { collapsed, toggle } = useSidebarCollapsed()

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

  const shared = {
    collections,
    globals,
    views,
    isAdmin,
    user,
    onOpenPalette: () => setPaletteOpen(true),
    isSigningOut,
    onSignOut: () => {
      void handleSignOut()
    },
  }

  return (
    <>
      {/* Below the md breakpoint the sidebar is a drawer behind this bar. */}
      <div className="lt:sticky lt:top-0 lt:z-30 lt:flex lt:items-center lt:gap-3 lt:border-b lt:bg-card lt:px-4 lt:py-2.5 lt:md:hidden">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
        <Link
          to="/"
          className="lt:flex lt:items-center lt:gap-2.5 lt:text-lg lt:font-bold lt:text-foreground lt:no-underline"
        >
          <BrandMark />
        </Link>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="lt:w-[280px] lt:max-w-[85vw] lt:gap-0 lt:p-0 lt:md:hidden"
        >
          <SheetTitle className="lt:sr-only">Navigation</SheetTitle>
          <SidebarBody {...shared} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Sticky to the top of whatever scrolls the page, at the viewport's height (dvh, so mobile
          browser chrome does not hide the footer). Only the nav scrolls; the brand and the footer
          stay in view (#140). Sticky rather than a full-height inner scroll container, because the
          admin renders inside a host page and the document is what scrolls there.
          Collapsing animates the aside's width while the inner column takes its new width at once
          (the aside's minus its 1px border), so the content never reflows mid-animation: the aside
          wipes over it like a curtain. */}
      <aside
        className={cn(
          'lt:sticky lt:top-0 lt:hidden lt:h-dvh lt:shrink-0 lt:overflow-hidden lt:border-r lt:bg-card lt:md:flex',
          'lt:motion-safe:transition-[width] lt:motion-safe:duration-200 lt:motion-safe:ease-out',
          collapsed ? 'lt:w-[72px]' : 'lt:w-[250px]',
        )}
      >
        <div
          className={cn(
            'lt:flex lt:h-full lt:shrink-0 lt:flex-col',
            collapsed ? 'lt:w-[71px]' : 'lt:w-[249px]',
          )}
        >
          <SidebarBody
            {...shared}
            collapsed={collapsed}
            headerAction={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
                onClick={toggle}
                className="lt:size-8 lt:text-muted-foreground"
              >
                {collapsed ? (
                  <PanelLeftOpen aria-hidden="true" />
                ) : (
                  <PanelLeftClose aria-hidden="true" />
                )}
              </Button>
            }
          />
        </div>
      </aside>
    </>
  )
}
