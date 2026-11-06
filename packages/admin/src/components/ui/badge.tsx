// Adapted from shadcn/ui (new-york v4). Differences from upstream:
//   - every utility carries the `lt:` prefix (docs/adr/0019)
//   - `secondary` keeps a visible border, and `success` and `muted` are added:
//     the list view's tags were bordered pills in those three colours, and
//     success uses the --lontar-success-* tokens rather than a new colour
//   - no `asChild`: no badge in the admin is a link, so the Slot dependency
//     would be dead weight here
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'lt:inline-flex lt:w-fit lt:shrink-0 lt:items-center lt:justify-center lt:gap-1 lt:overflow-hidden lt:rounded-full lt:border lt:px-2 lt:py-0.5 lt:text-xs lt:font-medium lt:whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'lt:border-transparent lt:bg-primary lt:text-primary-foreground',
        secondary: 'lt:border-border lt:bg-secondary lt:text-secondary-foreground',
        destructive: 'lt:border-transparent lt:bg-destructive lt:text-destructive-foreground',
        outline: 'lt:text-foreground',
        success: 'lt:border-success-border lt:bg-success-bg lt:text-success-text',
        muted: 'lt:border-border lt:bg-muted lt:text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
