// Adapted from shadcn/ui (new-york v4) `command`, which wraps cmdk. Differences from upstream,
// per docs/adr/0019:
//   - every utility carries the `lt:` prefix
//   - there is no CommandDialog: the palette composes `Command` inside our own `Dialog`, whose
//     Portal already renders into the scoped container (rule 3), rather than cmdk's dialog
//   - cmdk marks the highlighted row with `data-selected`, styled here with theme utilities
import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'

import { cn } from '../../lib/utils'

const Command = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'lt:flex lt:h-full lt:w-full lt:flex-col lt:overflow-hidden lt:rounded-md lt:bg-card lt:text-card-foreground',
      className,
    )}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

const CommandInput = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="lt:flex lt:items-center lt:gap-2 lt:border-b lt:px-3">
    <Search aria-hidden="true" className="lt:size-4 lt:shrink-0 lt:text-muted-foreground" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'lt:flex lt:h-11 lt:w-full lt:border-0 lt:bg-transparent lt:py-3 lt:text-sm lt:text-foreground lt:outline-none lt:placeholder:text-muted-foreground lt:disabled:cursor-not-allowed lt:disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
))
CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('lt:max-h-[300px] lt:overflow-x-hidden lt:overflow-y-auto', className)}
    {...props}
  />
))
CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn('lt:py-6 lt:text-center lt:text-sm lt:text-muted-foreground', className)}
    {...props}
  />
))
CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'lt:overflow-hidden lt:p-1 lt:text-foreground lt:[&_[cmdk-group-heading]]:px-2 lt:[&_[cmdk-group-heading]]:py-1.5 lt:[&_[cmdk-group-heading]]:text-xs lt:[&_[cmdk-group-heading]]:font-medium lt:[&_[cmdk-group-heading]]:text-muted-foreground',
      className,
    )}
    {...props}
  />
))
CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandItem = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'lt:relative lt:flex lt:cursor-pointer lt:items-center lt:gap-2 lt:rounded-sm lt:px-2 lt:py-2 lt:text-sm lt:outline-none lt:select-none lt:data-[disabled=true]:pointer-events-none lt:data-[disabled=true]:opacity-50 lt:data-[selected=true]:bg-accent lt:data-[selected=true]:text-accent-foreground',
      className,
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem }
