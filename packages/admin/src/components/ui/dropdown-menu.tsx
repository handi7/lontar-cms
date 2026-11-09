// Adapted from shadcn/ui (new-york). Differences from upstream, per docs/adr/0019:
//   - every utility carries the `lt:` prefix
//   - DropdownMenuContent's Portal receives an explicit container inside the
//     .lontar-admin wrapper (rule 3), and renders nothing until it exists
//   - enter/exit animation classes removed (no unprefixed @keyframes)
//   - uses theme utilities (lt:border-border, lt:bg-popover, lt:text-popover-foreground)
import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'

import { usePortalContainer } from '../../context/PortalContainer'
import { cn } from '../../lib/utils'

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export interface DropdownMenuContentProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
> {
  sideOffset?: number
}

const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(({ className, sideOffset = 4, ...props }, ref) => {
  const container = usePortalContainer()
  if (!container) return null

  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'lt:z-50 lt:min-w-32 lt:overflow-hidden lt:rounded-md lt:border lt:border-border lt:bg-popover lt:p-1 lt:text-popover-foreground lt:shadow-md lt:outline-none',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
})
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

export interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
> {
  inset?: boolean
}

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'lt:relative lt:flex lt:cursor-pointer lt:select-none lt:items-center lt:gap-2 lt:rounded-sm lt:px-2 lt:py-1.5 lt:text-sm lt:outline-none lt:transition-colors lt:hover:bg-accent lt:hover:text-accent-foreground lt:focus:bg-accent lt:focus:text-accent-foreground lt:data-[disabled]:pointer-events-none lt:data-[disabled]:opacity-50 lt:[&>svg]:size-4 lt:[&>svg]:shrink-0',
      inset && 'lt:pl-8',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export interface DropdownMenuLabelProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Label
> {
  inset?: boolean
}

const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  DropdownMenuLabelProps
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('lt:px-2 lt:py-1.5 lt:text-sm lt:font-semibold', inset && 'lt:pl-8', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Separator
>

const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  DropdownMenuSeparatorProps
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('lt:-mx-1 lt:my-1 lt:h-px lt:bg-border', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuRadioGroup,
}
