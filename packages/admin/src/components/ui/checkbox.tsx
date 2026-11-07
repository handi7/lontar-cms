// Adapted from shadcn/ui (new-york v4). Differences from the upstream source:
//   - every utility carries the `lt:` prefix (docs/adr/0019), including
//     `peer`, which Label's `lt:peer-disabled:` variants key on
//   - the Root is a <button>, so `bg-transparent`, `p-0` and `cursor-pointer`
//     restate what preflight would have reset (ADR 0019, #116 amendment)
//   - the checked fill uses `primary`, and the indicator a lucide Check
import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'

import { cn } from '../../lib/utils'

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'lt:peer lt:size-4 lt:shrink-0 lt:cursor-pointer lt:rounded-[4px] lt:border lt:border-input lt:bg-transparent lt:p-0 lt:shadow-xs lt:outline-none lt:transition-shadow lt:focus-visible:ring-1 lt:focus-visible:ring-ring lt:disabled:cursor-not-allowed lt:disabled:opacity-50 lt:aria-invalid:border-destructive lt:data-[state=checked]:border-primary lt:data-[state=checked]:bg-primary lt:data-[state=checked]:text-primary-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="lt:flex lt:items-center lt:justify-center lt:text-current">
      <Check className="lt:size-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
