import { useContext, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiKeyDoc, CreatedApiKeyDoc } from '../api/client'
import { createApiKey, formatApiErrorMessage, listApiKeys, revokeApiKey } from '../api/client'
import { queryKeys } from '../api/query-keys'
import { AuthContext } from '../context/AuthContext'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'

export interface CreateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiBase: string
  onCreated: () => void
}

const EXPIRATION_OPTIONS = [
  { label: '30 days', value: '2592000' },
  { label: '60 days', value: '5184000' },
  { label: '90 days', value: '7776000' },
  { label: '1 year', value: '31536000' },
  { label: 'No expiration', value: 'never' },
]

export function CreateApiKeyDialog(props: CreateApiKeyDialogProps) {
  const { open, onOpenChange, apiBase, onCreated } = props
  const [name, setName] = useState('')
  const [expiresIn, setExpiresIn] = useState('2592000')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createdResult, setCreatedResult] = useState<CreatedApiKeyDoc | null>(null)
  const [copied, setCopied] = useState(false)

  const handleClose = () => {
    setName('')
    setExpiresIn('2592000')
    setError(null)
    setCreatedResult(null)
    setCopied(false)
    onOpenChange(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Key name is required')
      return
    }

    setIsSubmitting(true)
    try {
      const expValue = expiresIn === 'never' ? null : Number(expiresIn)
      const res = await createApiKey(apiBase, {
        name: name.trim(),
        expiresIn: expValue,
      })
      setCreatedResult(res)
      onCreated()
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopy = async () => {
    if (!createdResult) return
    try {
      await navigator.clipboard.writeText(createdResult.key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="lt:max-w-md">
        <DialogHeader>
          <DialogTitle>{createdResult ? 'API Key Created' : 'Create API Key'}</DialogTitle>
          <DialogDescription>
            {createdResult
              ? 'Copy your API key now. You will not be able to view it again once this dialog is closed.'
              : 'Generate an API key to authenticate external services and scripts.'}
          </DialogDescription>
        </DialogHeader>

        {createdResult ? (
          <div className="lt:flex lt:flex-col lt:gap-4 lt:py-2">
            <Alert className="lt:border-warning-border lt:bg-warning-bg lt:text-warning-text">
              Save this key somewhere secure. This is the only time it will be shown.
            </Alert>

            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="created-api-key">API Key</Label>
              <div className="lt:flex lt:gap-2">
                <Input
                  id="created-api-key"
                  readOnly
                  value={createdResult.key}
                  className="lt:font-mono lt:text-xs"
                />
                <Button type="button" variant="outline" onClick={() => void handleCopy()}>
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="lt:flex lt:flex-col lt:gap-4 lt:py-2"
          >
            {error && <Alert variant="destructive">{error}</Alert>}

            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CI / Deployment Script"
                required
              />
            </div>

            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="api-key-expiration">Expiration</Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger id="api-key-expiration">
                  <SelectValue placeholder="Select expiration" />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create key'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function formatDate(val: string | null): string {
  if (!val) return 'Never'
  const d = new Date(val)
  return isNaN(d.getTime()) ? 'Invalid' : d.toLocaleDateString()
}

export interface ApiKeyRowProps {
  apiKey: ApiKeyDoc
  onRevoke: (id: string) => void
  isRevoking: boolean
}

function ApiKeyRow(props: ApiKeyRowProps) {
  const { apiKey, onRevoke, isRevoking } = props
  const isExpired = apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now()

  return (
    <div className="lt:flex lt:flex-col lt:gap-2 lt:rounded-md lt:border lt:border-border lt:p-3 lt:sm:flex-row lt:sm:items-center lt:sm:justify-between">
      <div className="lt:flex lt:flex-col lt:gap-1">
        <div className="lt:flex lt:items-center lt:gap-2">
          <span className="lt:text-sm lt:font-semibold lt:text-foreground">{apiKey.name}</span>
          <code className="lt:rounded lt:bg-muted lt:px-1.5 lt:py-0.5 lt:font-mono lt:text-xs lt:text-muted-foreground">
            {apiKey.start}
          </code>
          {isExpired && <Badge variant="destructive">Expired</Badge>}
        </div>
        <div className="lt:flex lt:flex-wrap lt:gap-x-4 lt:gap-y-1 lt:text-xs lt:text-muted-foreground">
          <span>Created: {formatDate(apiKey.createdAt)}</span>
          <span>Last used: {formatDate(apiKey.lastUsedAt)}</span>
          <span>Expires: {formatDate(apiKey.expiresAt)}</span>
        </div>
      </div>
      <div className="lt:flex lt:items-center lt:justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRevoke(apiKey.id)}
          disabled={isRevoking}
          className="lt:text-destructive lt:hover:border-destructive"
        >
          {isRevoking ? 'Revoking...' : 'Revoke'}
        </Button>
      </div>
    </div>
  )
}

export interface ApiKeysCardProps {
  apiBase: string
}

export function ApiKeysCard(props: ApiKeysCardProps) {
  const { apiBase } = props
  const auth = useContext(AuthContext)
  const user = auth?.user
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const {
    data: apiKeys = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.apiKeys(apiBase, user?.id),
    queryFn: () => listApiKeys(apiBase),
  })

  const handleRevoke = async (id: string) => {
    setActionError(null)
    setRevokingId(id)
    try {
      await revokeApiKey(apiBase, id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(apiBase, user?.id) })
    } catch (err) {
      setActionError(formatApiErrorMessage(err))
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="lt:flex lt:flex-row lt:items-center lt:justify-between">
        <div className="lt:flex lt:flex-col lt:gap-1">
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Personal API keys for machine-to-machine access and external services.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          Create API key
        </Button>
      </CardHeader>
      <CardContent className="lt:flex lt:flex-col lt:gap-4">
        {actionError && <Alert variant="destructive">{actionError}</Alert>}
        {isError && <Alert variant="destructive">Failed to load API keys.</Alert>}

        {isLoading ? (
          <div className="lt:py-4 lt:text-center lt:text-sm lt:text-muted-foreground">
            Loading API keys...
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="lt:rounded-md lt:border lt:border-dashed lt:border-border lt:p-6 lt:text-center lt:text-sm lt:text-muted-foreground">
            No API keys created yet. Generate a key to call the REST API from external servers.
          </div>
        ) : (
          <div className="lt:flex lt:flex-col lt:gap-3">
            {apiKeys.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                onRevoke={(id) => void handleRevoke(id)}
                isRevoking={revokingId === key.id}
              />
            ))}
          </div>
        )}

        <CreateApiKeyDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          apiBase={apiBase}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(apiBase, user?.id) })
          }}
        />
      </CardContent>
    </Card>
  )
}
