import { useState, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ClientAction } from '@lontar/core/client'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { buttonVariants } from '../components/ui/button'
import { CustomComponent } from '../components/CustomComponent'
import { queryKeys } from '../api/query-keys'

export interface UseDeclarativeActionOptions {
  apiBase: string
  scopeType: 'collection' | 'global'
  slug: string
  locale?: string
}

export interface ActionTarget {
  id?: number | string
  doc?: Record<string, unknown> | null
  ids?: Array<number | string>
  onSuccess?: () => void
}

export interface UseDeclarativeActionResult {
  isPending: boolean
  actionSuccess: string | null
  actionError: string | null
  clearMessages: () => void
  triggerAction: (action: ClientAction, target?: ActionTarget) => void
  dialogs: ReactNode
}

function formatConfirmMessage(confirm: string, count: number): string {
  return confirm.replace(/\{count\}/g, String(count))
}

function buildEndpointUrl(
  apiBase: string,
  scopeType: 'collection' | 'global',
  slug: string,
  action: ClientAction,
  id?: number | string,
  locale?: string,
): string {
  const basePath = scopeType === 'collection' ? `${apiBase}/${slug}` : `${apiBase}/globals/${slug}`
  let path = action.path ?? ''
  if (id !== undefined) {
    path = path.replace(':id', encodeURIComponent(String(id)))
  }
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return `${basePath}${path}${query}`
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, unknown>
    if (body && typeof body === 'object') {
      if (typeof body.error === 'string' && body.error.trim()) return body.error
      if (typeof body.message === 'string' && body.message.trim()) return body.message
    }
  } catch {
    const text = await res.text().catch(() => '')
    if (text.trim()) return text
  }
  return fallback
}

async function extractSuccessMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, unknown>
    if (
      body &&
      typeof body === 'object' &&
      typeof body.message === 'string' &&
      body.message.trim()
    ) {
      return body.message
    }
  } catch {
    // Empty or non-JSON body on 2xx is fine
  }
  return fallback
}

function invalidateActionQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  scopeType: 'collection' | 'global',
  slug: string,
  apiBase: string,
  id?: number | string,
): void {
  if (scopeType === 'collection') {
    void queryClient.invalidateQueries({ queryKey: [slug] })
    if (id !== undefined) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documentPrefix(slug, id),
      })
    }
  } else {
    void queryClient.invalidateQueries({ queryKey: queryKeys.global(slug) })
    void queryClient.invalidateQueries({
      queryKey: queryKeys.globalVersions(apiBase, slug),
    })
  }
}

interface ActionDialogsProps {
  action: ClientAction | null
  target: ActionTarget | null
  isConfirmOpen: boolean
  isComponentOpen: boolean
  onCloseConfirm: () => void
  onCloseComponent: () => void
  onConfirm: () => void
}

function ActionConfirmDialog({
  action,
  target,
  isOpen,
  onClose,
  onConfirm,
}: {
  action: ClientAction
  target: ActionTarget | null
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  if (!action.confirm) return null
  const count = target?.ids ? target.ids.length : 1
  const confirmDescription = formatConfirmMessage(action.confirm, count)
  const isDestructive = action.variant === 'destructive'

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action.label}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={isDestructive ? buttonVariants({ variant: 'destructive' }) : undefined}
            onClick={onConfirm}
          >
            {action.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ActionComponentDialog({
  action,
  target,
  isOpen,
  onClose,
}: {
  action: ClientAction
  target: ActionTarget | null
  isOpen: boolean
  onClose: () => void
}) {
  if (!action.component) return null
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
        </DialogHeader>
        <CustomComponent
          name={action.component}
          componentProps={{
            actionKey: action.key,
            label: action.label,
            id: target?.id,
            ids: target?.ids,
            doc: target?.doc,
            close: onClose,
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function ActionDialogs({
  action,
  target,
  isConfirmOpen,
  isComponentOpen,
  onCloseConfirm,
  onCloseComponent,
  onConfirm,
}: ActionDialogsProps) {
  if (!action) return null
  return (
    <>
      <ActionConfirmDialog
        action={action}
        target={target}
        isOpen={isConfirmOpen}
        onClose={onCloseConfirm}
        onConfirm={onConfirm}
      />
      <ActionComponentDialog
        action={action}
        target={target}
        isOpen={isComponentOpen}
        onClose={onCloseComponent}
      />
    </>
  )
}

export function useDeclarativeAction(
  options: UseDeclarativeActionOptions,
): UseDeclarativeActionResult {
  const { apiBase, scopeType, slug, locale } = options
  const queryClient = useQueryClient()

  const [activeAction, setActiveAction] = useState<ClientAction | null>(null)
  const [activeTarget, setActiveTarget] = useState<ActionTarget | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isComponentOpen, setIsComponentOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const clearMessages = useCallback(() => {
    setActionSuccess(null)
    setActionError(null)
  }, [])

  const executeEndpoint = useCallback(
    async (action: ClientAction, target?: ActionTarget) => {
      setIsPending(true)
      setActionSuccess(null)
      setActionError(null)

      const id = target?.id
      const url = buildEndpointUrl(apiBase, scopeType, slug, action, id, locale)
      const body = target?.ids !== undefined ? JSON.stringify({ ids: target.ids }) : undefined

      try {
        const res = await fetch(url, {
          method: (action.method ?? 'post').toUpperCase(),
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body,
        })

        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, `Action "${action.label}" failed`)
          setActionError(errorMsg)
          return
        }

        const successMsg = await extractSuccessMessage(res, `${action.label} succeeded`)
        setActionSuccess(successMsg)
        invalidateActionQueries(queryClient, scopeType, slug, apiBase, id)
        target?.onSuccess?.()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `Action "${action.label}" failed`)
      } finally {
        setIsPending(false)
      }
    },
    [apiBase, scopeType, slug, locale, queryClient],
  )

  const triggerAction = useCallback(
    (action: ClientAction, target?: ActionTarget) => {
      setActiveAction(action)
      setActiveTarget(target ?? null)

      if (action.component) {
        setIsComponentOpen(true)
      } else if (action.confirm) {
        setIsConfirmOpen(true)
      } else {
        void executeEndpoint(action, target)
      }
    },
    [executeEndpoint],
  )

  const handleConfirm = useCallback(() => {
    setIsConfirmOpen(false)
    if (activeAction) {
      void executeEndpoint(activeAction, activeTarget ?? undefined)
    }
  }, [activeAction, activeTarget, executeEndpoint])

  const dialogs = (
    <ActionDialogs
      action={activeAction}
      target={activeTarget}
      isConfirmOpen={isConfirmOpen}
      isComponentOpen={isComponentOpen}
      onCloseConfirm={() => setIsConfirmOpen(false)}
      onCloseComponent={() => setIsComponentOpen(false)}
      onConfirm={handleConfirm}
    />
  )

  return {
    isPending,
    actionSuccess,
    actionError,
    clearMessages,
    triggerAction,
    dialogs,
  }
}
