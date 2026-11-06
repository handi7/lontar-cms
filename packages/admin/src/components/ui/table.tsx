// Adapted from shadcn/ui (new-york v4). Differences from upstream:
//   - every utility carries the `lt:` prefix (docs/adr/0019)
//   - `lt:border-collapse` on the table: upstream gets it from preflight, and
//     without it adjacent row borders render doubled
//   - TableCell does not set `whitespace-nowrap`. Upstream does, which makes a
//     long title widen its column instead of wrapping; the admin's list view
//     has always wrapped cell text
//   - TableFooter and TableCaption are left out; nothing renders them
import * as React from 'react'

import { cn } from '../../lib/utils'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="lt:relative lt:w-full lt:overflow-x-auto">
      <table
        data-slot="table"
        className={cn('lt:w-full lt:caption-bottom lt:border-collapse lt:text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead data-slot="table-header" className={cn('lt:[&_tr]:border-b', className)} {...props} />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('lt:[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'lt:border-b lt:transition-colors lt:hover:bg-muted/50 lt:data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'lt:h-10 lt:px-2 lt:text-left lt:align-middle lt:font-medium lt:whitespace-nowrap lt:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td data-slot="table-cell" className={cn('lt:p-2 lt:align-middle', className)} {...props} />
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
