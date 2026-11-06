// Adapted from shadcn/ui (new-york): `lt:` prefix on every utility, and the
// Tailwind v4 shadow names (upstream's `shadow-sm` is v4's `shadow-xs`).
import * as React from 'react'

import { cn } from '../../lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'lt:flex lt:min-h-15 lt:w-full lt:rounded-md lt:border lt:border-input lt:bg-transparent lt:px-3 lt:py-2 lt:text-base lt:shadow-xs lt:placeholder:text-muted-foreground lt:focus-visible:outline-none lt:focus-visible:ring-1 lt:focus-visible:ring-ring lt:disabled:cursor-not-allowed lt:disabled:opacity-50 lt:md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
