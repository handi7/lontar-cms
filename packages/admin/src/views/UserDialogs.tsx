import { useState, useEffect } from 'react'
import { validatePassword } from '@lontar/core/client'
import type { UserDoc } from '../api/client'
import {
  createUser,
  updateUser,
  disableUser,
  adminSetUserPassword,
  formatApiErrorMessage,
} from '../api/client'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
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

export interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: string[]
  defaultRole: string
  apiBase: string
  onSuccess: () => void
  emailEnabled?: boolean
}

export function CreateUserDialog(props: CreateUserDialogProps) {
  const { open, onOpenChange, roles, defaultRole, apiBase, onSuccess, emailEnabled } = props
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(defaultRole)
  const [sendInvite, setSendInvite] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setEmail('')
      setPassword('')
      setRole(defaultRole)
      setSendInvite(false)
      setError(null)
    }
  }, [open, defaultRole])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!email.trim() || !email.includes('@')) {
      setError('A valid email address is required')
      return
    }
    if (!sendInvite) {
      const passwordError = validatePassword(password, 'Password')
      if (passwordError) {
        setError(passwordError)
        return
      }
    }

    setIsSubmitting(true)
    try {
      await createUser(apiBase, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        invite: sendInvite ? true : undefined,
        password: sendInvite ? undefined : password,
      })
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create new user</DialogTitle>
          <DialogDescription>
            {sendInvite
              ? 'Invite a new team member with role access.'
              : 'Add a new user account with role access.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lt:flex lt:flex-col lt:gap-4"
        >
          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="create-user-name">Name</Label>
            <Input
              id="create-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Doe"
              required
            />
          </div>

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="create-user-email">Email</Label>
            <Input
              id="create-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. jane@example.com"
              required
            />
          </div>

          {emailEnabled && (
            <div className="lt:flex lt:items-center lt:gap-2 lt:pt-1">
              <Checkbox
                id="create-user-invite"
                checked={sendInvite}
                onCheckedChange={(checked) => setSendInvite(checked === true)}
              />
              <Label
                htmlFor="create-user-invite"
                className="lt:cursor-pointer lt:text-sm lt:font-normal"
              >
                Send invitation email (user sets their own password)
              </Label>
            </div>
          )}

          {!sendInvite && (
            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="create-user-password">Password</Label>
              <Input
                id="create-user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </div>
          )}

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="create-user-role">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="create-user-role">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : sendInvite ? 'Send invitation' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface EditUserDialogProps {
  user: UserDoc | null
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: string[]
  isCurrentUser: boolean
  apiBase: string
  onSuccess: () => void
}

export function EditUserDialog(props: EditUserDialogProps) {
  const { user, open, onOpenChange, roles, isCurrentUser, apiBase, onSuccess } = props
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (user && open) {
      setName(user.name || '')
      setRole(user.role || '')
      setError(null)
    }
  }, [user, open])

  if (!user) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    setIsSubmitting(true)
    try {
      await updateUser(apiBase, user.id, {
        name: name.trim(),
        role: isCurrentUser ? undefined : role,
      })
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Update user profile and permissions.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lt:flex lt:flex-col lt:gap-4"
        >
          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="edit-user-email">Email (read-only)</Label>
            <Input id="edit-user-email" value={user.email} disabled className="lt:opacity-70" />
          </div>

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="edit-user-name">Name</Label>
            <Input
              id="edit-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="edit-user-role">Role</Label>
            {isCurrentUser ? (
              <div className="lt:text-xs lt:text-muted-foreground">
                <span className="lt:font-semibold">{user.role}</span> (You cannot change your own
                role)
              </div>
            ) : (
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="edit-user-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface ResetPasswordDialogProps {
  user: UserDoc | null
  open: boolean
  onOpenChange: (open: boolean) => void
  apiBase: string
  onSuccess: () => void
}

export function ResetPasswordDialog(props: ResetPasswordDialogProps) {
  const { user, open, onOpenChange, apiBase, onSuccess } = props
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setPassword('')
      setConfirmPassword('')
      setError(null)
    }
  }, [open])

  if (!user) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const passwordError = validatePassword(password, 'Password')
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsSubmitting(true)
    try {
      await adminSetUserPassword(apiBase, user.id, password)
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for <span className="lt:font-semibold">{user.email}</span>. Active
            sessions will be invalidated.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lt:flex lt:flex-col lt:gap-4"
        >
          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="reset-user-password">New password</Label>
            <Input
              id="reset-user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />
          </div>

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="reset-user-confirm-password">Confirm new password</Label>
            <Input
              id="reset-user-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Resetting...' : 'Reset password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface DisableUserDialogProps {
  user: UserDoc | null
  open: boolean
  onOpenChange: (open: boolean) => void
  apiBase: string
  onSuccess: () => void
}

export function DisableUserDialog(props: DisableUserDialogProps) {
  const { user, open, onOpenChange, apiBase, onSuccess } = props
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
    }
  }, [open])

  if (!user) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await disableUser(apiBase, user.id, reason.trim() || undefined)
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suspend user account</DialogTitle>
          <DialogDescription>
            Suspending <span className="lt:font-semibold">{user.email}</span> will revoke all active
            sessions and prevent the user from logging in until re-enabled.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lt:flex lt:flex-col lt:gap-4"
        >
          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="disable-reason">Reason (optional)</Label>
            <Input
              id="disable-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Terms violation or requested by user"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? 'Suspending...' : 'Suspend account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
