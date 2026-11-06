// Adapted from shadcn/ui (new-york). Differences from the upstream source, all
// forced by docs/adr/0019:
//   - every utility carries the `lt:` prefix; an unprefixed class emits no CSS
//   - SelectContent's Portal receives an explicit container inside the
//     .lontar-admin wrapper (rule 3), and renders nothing until it exists —
//     Radix reads a null container as "use document.body", which is the exact
//     leak this guards against
//   - the enter/exit animation classes are gone: they come from tw-animate-css,
//     whose unprefixed @keyframes the build guard rejects
//   - bare `border` is paired with `border-border`, since the default border
//     colour normally comes from preflight, which the admin does not ship
//   - shadow scale uses the Tailwind v4 names (`shadow-sm` -> `shadow-xs`)
import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

import { usePortalContainer } from '@/context/PortalContainer'
import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'lt:flex lt:h-9 lt:w-full lt:items-center lt:justify-between lt:whitespace-nowrap lt:rounded-md lt:border lt:border-input lt:bg-transparent lt:px-3 lt:py-2 lt:text-sm lt:shadow-xs lt:ring-offset-background lt:data-[placeholder]:text-muted-foreground lt:focus:outline-none lt:focus:ring-1 lt:focus:ring-ring lt:disabled:cursor-not-allowed lt:disabled:opacity-50 lt:[&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="lt:h-4 lt:w-4 lt:opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('lt:flex lt:cursor-default lt:items-center lt:justify-center lt:py-1', className)}
    {...props}
  >
    <ChevronUp className="lt:h-4 lt:w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('lt:flex lt:cursor-default lt:items-center lt:justify-center lt:py-1', className)}
    {...props}
  >
    <ChevronDown className="lt:h-4 lt:w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => {
  const container = usePortalContainer()
  if (!container) return null

  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          'lt:relative lt:z-50 lt:max-h-[var(--radix-select-content-available-height)] lt:min-w-[8rem] lt:overflow-y-auto lt:overflow-x-hidden lt:rounded-md lt:border lt:border-border lt:bg-popover lt:text-popover-foreground lt:shadow-md lt:origin-[var(--radix-select-content-transform-origin)]',
          position === 'popper' &&
            'lt:data-[side=bottom]:translate-y-1 lt:data-[side=left]:-translate-x-1 lt:data-[side=right]:translate-x-1 lt:data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'lt:p-1',
            position === 'popper' &&
              'lt:h-[var(--radix-select-trigger-height)] lt:w-full lt:min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('lt:px-2 lt:py-1.5 lt:text-sm lt:font-semibold', className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'lt:relative lt:flex lt:w-full lt:cursor-default lt:select-none lt:items-center lt:rounded-sm lt:py-1.5 lt:pl-2 lt:pr-8 lt:text-sm lt:outline-none lt:focus:bg-accent lt:focus:text-accent-foreground lt:data-[disabled]:pointer-events-none lt:data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="lt:absolute lt:right-2 lt:flex lt:h-3.5 lt:w-3.5 lt:items-center lt:justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="lt:h-4 lt:w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('lt:-mx-1 lt:my-1 lt:h-px lt:bg-muted', className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
