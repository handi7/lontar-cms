// Adapted from shadcn/ui (new-york). Differences from the upstream source, all
// forced by docs/adr/0019:
//   - every utility carries the `lt:` prefix
//   - the Portal receives an explicit container inside the .lontar-admin
//     wrapper (rule 3), and nothing renders until it exists. The overlay and
//     content are `position: fixed`, so they still cover the viewport from
//     inside the wrapper; nothing on the wrapper creates a containing block
//   - the enter/exit animation classes are gone: they come from tw-animate-css,
//     whose unprefixed @keyframes the build check rejects
//   - the panel sits on `card`, not `background`, which maps to the page
//     background (--lontar-bg) and would read as grey
//   - Title and Description reset the margins the base layer gives h2 and p
//   - AlertDialogTrigger is left out: the admin opens the dialog from state,
//     because the button that asks for it lives in a table row
import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'

import { usePortalContainer } from '../../context/PortalContainer'
import { cn } from '../../lib/utils'
import { buttonVariants } from './button'

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogContent = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => {
  const container = usePortalContainer()
  if (!container) return null

  return (
    <AlertDialogPrimitive.Portal container={container}>
      <AlertDialogPrimitive.Overlay className="lt:fixed lt:inset-0 lt:z-50 lt:bg-black/50" />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          'lt:fixed lt:top-1/2 lt:left-1/2 lt:z-50 lt:grid lt:w-full lt:max-w-[calc(100%-2rem)] lt:-translate-x-1/2 lt:-translate-y-1/2 lt:gap-4 lt:rounded-lg lt:border lt:bg-card lt:p-6 lt:text-card-foreground lt:shadow-lg lt:sm:max-w-lg',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
})
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('lt:flex lt:flex-col lt:gap-2 lt:text-left', className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
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

const AlertDialogTitle = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('lt:m-0 lt:text-lg lt:font-semibold', className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('lt:m-0 lt:text-sm lt:text-muted-foreground', className)}
    {...props}
  />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: 'outline' }), className)}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
