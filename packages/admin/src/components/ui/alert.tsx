// Adapted from shadcn/ui (new-york v4). Differences from upstream:
//   - every utility carries the `lt:` prefix (docs/adr/0019)
//   - `destructive` uses the --lontar-error-* tokens (tinted background,
//     border and text) rather than red text on the card colour, and a
//     `success` variant is added on the --lontar-success-* tokens. Both sets
//     are part of the documented theming surface in README.md
//   - the icon grid (`has-[>svg]:grid-cols-…`) is dropped, along with
//     AlertTitle and AlertDescription: every alert in the admin is a single
//     line of text
//   - `role` defaults to "alert" as upstream, but can be overridden; a success
//     message should be announced politely with role="status"
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const alertVariants = cva(
  'lt:relative lt:w-full lt:rounded-md lt:border lt:px-4 lt:py-3 lt:text-sm',
  {
    variants: {
      variant: {
        default: 'lt:bg-card lt:text-card-foreground',
        destructive: 'lt:border-error-border lt:bg-error-bg lt:text-error-text',
        success: 'lt:border-success-border lt:bg-success-bg lt:text-success-text',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  role = 'alert',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Alert, alertVariants }
