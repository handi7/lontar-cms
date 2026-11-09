import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export interface ViewHeaderProps {
  title: ReactNode
  level?: 1 | 2
  breadcrumbs?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

// Page title row shared by every view: title with optional supporting content
// underneath (a subtitle, an item count, document metadata), and actions on
// the right.
export function ViewHeader({ title, level = 1, breadcrumbs, children, actions }: ViewHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className="lt:mb-7 lt:flex lt:items-center lt:justify-between lt:gap-4">
      <div>
        {breadcrumbs}
        <Heading
          className={cn(
            'lt:m-0 lt:font-bold lt:text-foreground',
            level === 1 ? 'lt:text-[1.75rem]' : 'lt:text-xl',
          )}
        >
          {title}
        </Heading>
        {children}
      </div>
      {actions && <div className="lt:flex lt:items-center lt:gap-3">{actions}</div>}
    </header>
  )
}

export interface ViewSubtitleProps {
  children: ReactNode
}

export function ViewSubtitle({ children }: ViewSubtitleProps) {
  return <p className="lt:mt-1 lt:mb-0 lt:text-muted-foreground">{children}</p>
}
