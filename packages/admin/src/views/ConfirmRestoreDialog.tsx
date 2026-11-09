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

export interface ConfirmRestoreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  versionNumber?: number
}

export function ConfirmRestoreDialog({
  open,
  onOpenChange,
  onConfirm,
  versionNumber,
}: ConfirmRestoreDialogProps) {
  const versionText = versionNumber ? `version #${versionNumber}` : 'this version'

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore {versionText}?</AlertDialogTitle>
          <AlertDialogDescription>
            Restoring will create a new snapshot with the contents of {versionText}. Any unsaved
            changes in the form will be replaced.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: 'default' })} onClick={onConfirm}>
            Restore
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
