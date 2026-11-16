import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { usePortalContainer } from '../../context/PortalContainer'
import { cn } from '../../lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

export type DialogOverlayProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('lt:fixed lt:inset-0 lt:z-50 lt:bg-black/50', className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

export type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, ...props }, ref) => {
  const container = usePortalContainer()
  if (!container) return null

  return (
    <DialogPortal container={container}>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'lt:fixed lt:top-1/2 lt:left-1/2 lt:z-50 lt:grid lt:w-full lt:max-w-[calc(100%-2rem)] lt:-translate-x-1/2 lt:-translate-y-1/2 lt:gap-4 lt:rounded-lg lt:border lt:border-border lt:bg-card lt:p-6 lt:text-card-foreground lt:shadow-lg lt:sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="lt:absolute lt:top-4 lt:right-4 lt:rounded-sm lt:opacity-70 lt:transition-opacity lt:hover:opacity-100 lt:focus:outline-hidden lt:disabled:pointer-events-none">
          <X className="lt:size-4" />
          <span className="lt:sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

export type DialogHeaderProps = React.ComponentProps<'div'>

function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div className={cn('lt:flex lt:flex-col lt:gap-2 lt:text-left', className)} {...props} />
}
DialogHeader.displayName = 'DialogHeader'

export type DialogFooterProps = React.ComponentProps<'div'>

function DialogFooter({ className, ...props }: DialogFooterProps) {
  return (
    <div
      className={cn(
        'lt:flex lt:flex-col-reverse lt:gap-2 lt:sm:flex-row lt:sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}
DialogFooter.displayName = 'DialogFooter'

export type DialogTitleProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  DialogTitleProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'lt:m-0 lt:text-lg lt:font-semibold lt:leading-none lt:tracking-tight',
      className,
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export type DialogDescriptionProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
>

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  DialogDescriptionProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('lt:m-0 lt:text-sm lt:text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
