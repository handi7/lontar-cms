// Adapted from shadcn/ui. Differences from upstream forced by ADR 0019:
//   - every utility carries the `lt:` prefix
//   - the Portal receives an explicit container inside .lontar-admin (rule 3)
//   - animation classes are omitted: enter/exit keyframes are unprefixed
//   - panel sits on `card`, not `background`
//   - styled exclusively with mapped theme tokens
import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { usePortalContainer } from '../../context/PortalContainer'
import { cn } from '../../lib/utils'

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

export type SheetOverlayProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Overlay>,
  SheetOverlayProps
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn('lt:fixed lt:inset-0 lt:z-50 lt:bg-black/50', className)}
    {...props}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

export type SheetSide = 'top' | 'bottom' | 'left' | 'right'

function getSheetSideClass(side: SheetSide): string {
  switch (side) {
    case 'top':
      return 'lt:inset-x-0 lt:top-0 lt:border-b'
    case 'bottom':
      return 'lt:inset-x-0 lt:bottom-0 lt:border-t'
    case 'left':
      return 'lt:inset-y-0 lt:left-0 lt:h-full lt:w-3/4 lt:border-r lt:sm:max-w-sm'
    case 'right':
    default:
      return 'lt:inset-y-0 lt:right-0 lt:h-full lt:w-3/4 lt:border-l lt:sm:max-w-xl'
  }
}

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Content
> {
  side?: SheetSide
}

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => {
  const container = usePortalContainer()
  if (!container) return null

  return (
    <SheetPortal container={container}>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(
          'lt:fixed lt:z-50 lt:flex lt:flex-col lt:gap-4 lt:bg-card lt:p-6 lt:text-card-foreground lt:shadow-lg lt:transition lt:ease-in-out',
          getSheetSideClass(side),
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          aria-label="Close"
          className="lt:absolute lt:right-4 lt:top-4 lt:rounded-sm lt:opacity-70 lt:ring-offset-background lt:transition-opacity lt:hover:opacity-100 lt:focus:outline-none lt:focus:ring-2 lt:focus:ring-ring lt:focus:ring-offset-2 lt:disabled:pointer-events-none"
        >
          <X className="lt:size-4" />
          <span className="lt:sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = SheetPrimitive.Content.displayName

export type SheetHeaderProps = React.ComponentProps<'div'>

function SheetHeader({ className, ...props }: SheetHeaderProps) {
  return (
    <div
      className={cn('lt:flex lt:flex-col lt:gap-1.5 lt:text-left lt:shrink-0', className)}
      {...props}
    />
  )
}
SheetHeader.displayName = 'SheetHeader'

export type SheetFooterProps = React.ComponentProps<'div'>

function SheetFooter({ className, ...props }: SheetFooterProps) {
  return (
    <div
      className={cn(
        'lt:flex lt:flex-col-reverse lt:sm:flex-row lt:sm:justify-end lt:gap-2 lt:shrink-0',
        className,
      )}
      {...props}
    />
  )
}
SheetFooter.displayName = 'SheetFooter'

export type SheetTitleProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Title>,
  SheetTitleProps
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('lt:text-lg lt:font-semibold lt:text-foreground', className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

export type SheetDescriptionProps = React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Description
>

const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Description>,
  SheetDescriptionProps
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('lt:text-sm lt:text-muted-foreground', className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
