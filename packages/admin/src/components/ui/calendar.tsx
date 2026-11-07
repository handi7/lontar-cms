// Adapted from shadcn/ui's Calendar, rewritten against react-day-picker v10
// (upstream targets v9; the class-name keys are the same). Differences:
//   - every utility carries the `lt:` prefix (docs/adr/0019)
//   - react-day-picker's own stylesheet is not imported; every part is styled
//     through `classNames` so nothing unscoped ships
//   - day and navigation buttons restate what preflight would have reset on a
//     <button> (ADR 0019, #116 amendment)
//   - range-selection, dropdown-caption and week-number styling is left out:
//     the admin only ever uses `mode="single"` with the default caption
//   - modifiers (selected, today, outside) style the day *cell*, so they reach
//     the button inside it through `[&>button]`; `today` is written to skip a
//     selected cell, so the two never compete for the same property
import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type ChevronProps } from 'react-day-picker'

import { cn } from '../../lib/utils'
import { buttonVariants } from './button'

function CalendarChevron({ orientation, className, size: _size, ...props }: ChevronProps) {
  const Icon = orientation === 'left' ? ChevronLeft : ChevronRight
  return <Icon className={cn('lt:size-4', className)} {...props} />
}

const navButton = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  'lt:size-8 lt:p-0 lt:opacity-60 lt:hover:opacity-100 lt:disabled:opacity-30',
)

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('lt:p-3', className)}
      classNames={{
        root: 'lt:w-fit',
        months: 'lt:relative lt:flex lt:flex-col lt:gap-4',
        month: 'lt:flex lt:w-full lt:flex-col lt:gap-4',
        nav: 'lt:absolute lt:inset-x-0 lt:top-0 lt:flex lt:w-full lt:items-center lt:justify-between',
        button_previous: navButton,
        button_next: navButton,
        month_caption: 'lt:flex lt:h-8 lt:w-full lt:items-center lt:justify-center lt:px-8',
        caption_label: 'lt:text-sm lt:font-medium',
        month_grid: 'lt:w-full lt:border-collapse',
        weekdays: 'lt:flex',
        weekday: 'lt:flex-1 lt:text-[0.8rem] lt:font-normal lt:text-muted-foreground',
        week: 'lt:mt-1 lt:flex lt:w-full',
        day: 'lt:relative lt:size-8 lt:p-0 lt:text-center lt:text-sm',
        day_button:
          'lt:flex lt:size-8 lt:cursor-pointer lt:items-center lt:justify-center lt:rounded-md lt:border-0 lt:bg-transparent lt:p-0 lt:font-normal lt:text-foreground lt:outline-none lt:hover:bg-accent lt:focus-visible:ring-1 lt:focus-visible:ring-ring',
        selected:
          'lt:[&>button]:bg-primary lt:[&>button]:text-primary-foreground lt:[&>button]:hover:bg-primary-hover',
        today: 'lt:[&:not([data-selected])>button]:bg-accent lt:[&>button]:font-semibold',
        outside: 'lt:[&:not([data-selected])>button]:text-muted-foreground',
        disabled: 'lt:[&>button]:opacity-50',
        hidden: 'lt:invisible',
        ...classNames,
      }}
      components={{ Chevron: CalendarChevron, ...components }}
      {...props}
    />
  )
}

export { Calendar }
