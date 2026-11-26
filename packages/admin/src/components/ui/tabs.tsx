// Adapted from shadcn/ui (new-york v4). Differences from upstream:
//   - every utility carries the `lt:` prefix (docs/adr/0019)
//   - TabsList uses `lt:flex-wrap lt:h-auto` so many tabs wrap cleanly on narrow screens
//   - TabsTrigger sets `lt:cursor-pointer` and `lt:outline-none` (no Tailwind preflight)
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '../../lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('lt:flex lt:flex-col lt:gap-2', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'lt:bg-muted lt:text-muted-foreground lt:inline-flex lt:min-h-9 lt:w-fit lt:max-w-full lt:flex-wrap lt:items-center lt:justify-start lt:gap-1 lt:rounded-lg lt:p-[3px]',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'lt:inline-flex lt:h-8 lt:items-center lt:justify-center lt:gap-1.5 lt:rounded-md lt:border lt:border-transparent lt:bg-transparent lt:px-2.5 lt:py-1 lt:text-sm lt:font-medium lt:whitespace-nowrap lt:text-muted-foreground lt:cursor-pointer lt:outline-none lt:transition-[color,box-shadow] lt:hover:text-foreground lt:focus-visible:border-ring lt:focus-visible:ring-2 lt:focus-visible:ring-ring/50 lt:disabled:pointer-events-none lt:disabled:opacity-50 lt:data-[state=active]:bg-background lt:data-[state=active]:text-foreground lt:data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('lt:flex-1 lt:outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
