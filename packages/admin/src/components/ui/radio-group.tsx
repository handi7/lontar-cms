// Adapted from shadcn/ui (new-york v4). Differences from the upstream source:
//   - every utility carries the `lt:` prefix (docs/adr/0019)
//   - the Item is a <button>, with cursor-pointer and outline-none
//   - the checked fill uses `primary`, with a lucide Circle indicator
import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { Circle } from 'lucide-react'

import { cn } from '../../lib/utils'

export type RadioGroupProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>

const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupProps
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn('lt:grid lt:gap-2', className)} {...props} />
))
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

export type RadioGroupItemProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>

const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'lt:peer lt:size-4 lt:shrink-0 lt:cursor-pointer lt:rounded-full lt:border lt:border-input lt:bg-transparent lt:p-0 lt:text-primary lt:shadow-xs lt:outline-none lt:transition-shadow lt:focus-visible:ring-1 lt:focus-visible:ring-ring lt:disabled:cursor-not-allowed lt:disabled:opacity-50 lt:aria-invalid:border-destructive lt:data-[state=checked]:border-primary lt:data-[state=checked]:text-primary',
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="lt:flex lt:items-center lt:justify-center">
      <Circle className="lt:size-2 lt:fill-primary lt:text-primary" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
))
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }
