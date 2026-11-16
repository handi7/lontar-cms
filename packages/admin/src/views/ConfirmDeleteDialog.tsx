import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { buttonVariants } from '../components/ui/button'

export interface ConfirmDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  title?: string
  description?: string
  confirmLabel?: string
}

// Replaces window.confirm for deleting a document (#136): same question, but
// styled, themed, and non-blocking. Controlled by the caller, since the button
// that asks for it may sit in a table row the dialog is not part of.
export function ConfirmDeleteDialog(props: ConfirmDeleteDialogProps) {
  const {
    open,
    onOpenChange,
    onConfirm,
    title = 'Delete document',
    description = 'Are you sure you want to delete this document? This cannot be undone.',
    confirmLabel = 'Delete',
  } = props

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
