// Markup shared by RelationshipPicker and UploadPicker: the search bar, the
// inline results list, its rows and status lines, and the bordered card a
// selected document is shown in. Presentation only; each picker keeps its own
// state, queries and form wiring.
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { cn } from '../lib/utils'

/** Compact outline button used for every picker action. */
export function PickerButton({
  className,
  destructive,
  ...props
}: ComponentProps<typeof Button> & { destructive?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'lt:h-7 lt:px-2 lt:shadow-none',
        destructive &&
          'lt:text-destructive lt:hover:border-error-border lt:hover:bg-error-bg lt:hover:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

/** Opens a document in a new tab; rendered as a button for consistency. */
export function PickerViewLink({ href, testId }: { href: string; testId: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="lt:h-7 lt:px-2 lt:shadow-none">
      <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
        View ↗
      </a>
    </Button>
  )
}

export function PickerSearchBar({
  onCancel,
  cancelTestId,
  ...inputProps
}: ComponentProps<typeof Input> & { onCancel?: () => void; cancelTestId: string }) {
  return (
    <div className="lt:flex lt:items-center lt:gap-2">
      <Input
        type="text"
        onKeyDown={(e) => {
          // Enter would otherwise submit the surrounding document form.
          if (e.key === 'Enter') {
            e.preventDefault()
          }
        }}
        {...inputProps}
      />
      {onCancel && (
        <PickerButton onClick={onCancel} data-testid={cancelTestId}>
          Cancel
        </PickerButton>
      )}
    </div>
  )
}

export function PickerResults({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        // Sits inside PickerPopover, which supplies the border and shadow.
        'lt:mt-1 lt:flex lt:max-h-55 lt:flex-col lt:overflow-y-auto',
        className,
      )}
      {...props}
    />
  )
}

/**
 * One row in the results list. Every row has a transparent 1px border from
 * Button; only its bottom edge is coloured, which draws the divider without a
 * `divide-y` on the parent (whose zero-specificity selector would lose to the
 * row's own border utilities).
 */
export function PickerOption({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'lt:h-auto lt:w-full lt:shrink-0 lt:justify-between lt:gap-3 lt:rounded-none lt:border-b-border lt:px-3 lt:py-2 lt:text-left lt:font-normal lt:last:border-b-transparent',
        className,
      )}
      {...props}
    />
  )
}

export function PickerStatus({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      className={cn(
        'lt:p-3 lt:text-center lt:text-sm',
        error ? 'lt:text-error-text' : 'lt:text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}

/** Bordered row a chosen document is displayed in. */
export function PickerCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'lt:flex lt:items-center lt:justify-between lt:gap-3 lt:rounded-md lt:border lt:bg-card lt:px-3 lt:py-2',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Floats a picker's search over the form instead of pushing the fields below
 * it down (#136). `open` is the picker's own `isSearching` state, so when the
 * search shows and hides is unchanged; Escape and an outside click now close it
 * too. Radix moves focus to the first focusable element inside, the search
 * input, when it opens.
 */
export function PickerPopover({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="lt:w-(--radix-popover-trigger-width) lt:min-w-80 lt:p-2"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

/** Full-width trigger shown in place of an empty single-value picker. */
export function PickerEmptyTrigger({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'lt:w-full lt:justify-start lt:font-normal lt:text-muted-foreground lt:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

export const pickerTitleClass = 'lt:truncate lt:font-medium lt:text-foreground'
export const pickerActionsClass = 'lt:flex lt:shrink-0 lt:items-center lt:gap-1.5'
export const pickerThumbClass = 'lt:shrink-0 lt:rounded-sm lt:border lt:object-cover'
