// Adapted from shadcn/ui (new-york): `lt:` prefix on every utility, no
// "use client", React.ComponentRef instead of the deprecated React.ElementRef.
// Upstream wraps the class string in a variant-less cva() call; with no
// variants that is just a string, so it is inlined here.
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'

import { cn } from '../../lib/utils'

const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'lt:text-sm lt:font-medium lt:leading-none lt:peer-disabled:cursor-not-allowed lt:peer-disabled:opacity-70',
      className,
    )}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
