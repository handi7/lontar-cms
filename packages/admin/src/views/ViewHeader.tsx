import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

// Page title row shared by every view: title with optional supporting content
// underneath (a subtitle, an item count, document metadata), and actions on
// the right.
export function ViewHeader({
  title,
  level = 1,
  children,
  actions,
}: {
  title: ReactNode
  level?: 1 | 2
  children?: ReactNode
  actions?: ReactNode
}) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className="lt:mb-7 lt:flex lt:items-center lt:justify-between lt:gap-4">
      <div>
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

export function ViewSubtitle({ children }: { children: ReactNode }) {
  return <p className="lt:mt-1 lt:mb-0 lt:text-muted-foreground">{children}</p>
}
