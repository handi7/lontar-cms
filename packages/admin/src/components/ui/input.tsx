// Adapted from shadcn/ui (new-york): `lt:` prefix on every utility, and the
// Tailwind v4 shadow names (upstream's `shadow-sm` is v4's `shadow-xs`).
import * as React from 'react'

import { cn } from '../../lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'lt:flex lt:h-9 lt:w-full lt:rounded-md lt:border lt:border-input lt:bg-transparent lt:px-3 lt:py-1 lt:text-base lt:shadow-xs lt:transition-colors lt:file:border-0 lt:file:bg-transparent lt:file:text-sm lt:file:font-medium lt:file:text-foreground lt:placeholder:text-muted-foreground lt:focus-visible:outline-none lt:focus-visible:ring-1 lt:focus-visible:ring-ring lt:disabled:cursor-not-allowed lt:disabled:opacity-50 lt:md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
