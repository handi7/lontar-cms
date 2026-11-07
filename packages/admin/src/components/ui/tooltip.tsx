// Adapted from shadcn/ui (new-york v4). Differences from the upstream source,
// all forced by docs/adr/0019:
//   - every utility carries the `lt:` prefix
//   - TooltipContent's Portal receives an explicit container inside the
//     .lontar-admin wrapper (rule 3), and renders nothing until it exists
//   - the enter/exit animation classes are gone (tw-animate-css)
//   - the arrow is Radix's SVG filled with `primary`, rather than upstream's
//     rotated square, which relies on a `bg-` plus `fill-` pair and a
//     calc() offset that the prefix makes awkward
// As upstream v4 does, each Tooltip carries its own Provider, so a tooltip
// works anywhere in the tree without a provider at the admin root.
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { usePortalContainer } from '../../context/PortalContainer'
import { cn } from '../../lib/utils'

function Tooltip({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root {...props} />
    </TooltipPrimitive.Provider>
  )
}

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, children, ...props }, ref) => {
  const container = usePortalContainer()
  if (!container) return null

  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'lt:z-50 lt:w-fit lt:origin-(--radix-tooltip-content-transform-origin) lt:rounded-md lt:bg-primary lt:px-3 lt:py-1.5 lt:text-xs lt:text-balance lt:text-primary-foreground',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="lt:fill-primary" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent }
