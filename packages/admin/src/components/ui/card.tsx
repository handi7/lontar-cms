// Adapted from shadcn/ui (new-york v4). Differences from upstream:
//   - every utility carries the `lt:` prefix (docs/adr/0019)
//   - CardHeader drops upstream's `@container/card-header` and
//     `has-data-[slot=card-action]` grid, and CardAction is left out: nothing in
//     the admin puts an action in a card header
//   - rounded-lg rather than rounded-xl, so cards keep the corner radius the
//     rest of the admin derives from --lontar-radius
import * as React from 'react'

import { cn } from '../../lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'lt:flex lt:flex-col lt:gap-6 lt:rounded-lg lt:border lt:bg-card lt:py-6 lt:text-card-foreground lt:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('lt:flex lt:flex-col lt:gap-1.5 lt:px-6', className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('lt:leading-none lt:font-semibold', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('lt:text-sm lt:text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('lt:px-6', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('lt:flex lt:items-center lt:px-6', className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
