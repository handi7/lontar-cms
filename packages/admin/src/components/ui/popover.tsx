// Adapted from shadcn/ui (new-york). Differences from the upstream source, all
// forced by docs/adr/0019:
//   - every utility carries the `lt:` prefix
//   - PopoverContent's Portal receives an explicit container inside the
//     .lontar-admin wrapper (rule 3), and renders nothing until it exists;
//     Radix reads a null container as "use document.body"
//   - the enter/exit animation classes are gone: they come from tw-animate-css,
//     whose unprefixed @keyframes the build check rejects
//   - PopoverAnchor is left out; nothing anchors a popover to another element
import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

import { usePortalContainer } from '../../context/PortalContainer'
import { cn } from '../../lib/utils'

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => {
  const container = usePortalContainer()
  if (!container) return null

  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'lt:z-50 lt:w-72 lt:origin-(--radix-popover-content-transform-origin) lt:rounded-md lt:border lt:bg-popover lt:p-4 lt:text-popover-foreground lt:shadow-md lt:outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
