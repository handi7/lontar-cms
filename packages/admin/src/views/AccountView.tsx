import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AdminSession, AdminUser } from '../api/client'
import { changeMyPassword, formatApiErrorMessage, updateMe } from '../api/client'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'
import { ViewHeader, ViewSubtitle } from './ViewHeader'

export interface ProfileDetailsCardProps {
  user: AdminUser
  apiBase: string
}

function ProfileDetailsCard(props: ProfileDetailsCardProps) {
  const { user, apiBase } = props
  const queryClient = useQueryClient()
  const [name, setName] = useState(user.name || '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    setName(user.name || '')
  }, [user.name])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }

    setIsUpdating(true)
    try {
      await updateMe(apiBase, { name: name.trim() })
      setSuccess('Profile name updated successfully.')
      void queryClient.invalidateQueries({ queryKey: ['_lontar_session'] })
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile details</CardTitle>
        <CardDescription>Your public identity and display name.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lt:flex lt:flex-col lt:gap-4"
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          {success && (
            <Alert className="lt:border-success-border lt:bg-success-bg lt:text-success-text">
              {success}
            </Alert>
          )}

          <div className="lt:grid lt:grid-cols-1 lt:gap-4 lt:sm:grid-cols-2">
            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="account-email">Email</Label>
              <Input id="account-email" value={user.email} disabled className="lt:opacity-70" />
            </div>

            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="account-role">Role</Label>
              <div className="lt:flex lt:h-9 lt:items-center">
                <Badge variant="secondary">{user.role || 'editor'}</Badge>
              </div>
            </div>
          </div>

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="account-name">Display name</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
            />
          </div>

          <div className="lt:flex lt:justify-end">
            <Button type="submit" disabled={isUpdating}>
              {isUpdating ? 'Saving...' : 'Save profile'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export interface ChangePasswordCardProps {
  apiBase: string
}

function ChangePasswordCard(props: ChangePasswordCardProps) {
  const { apiBase } = props
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isChanging, setIsChanging] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!currentPassword) {
      setError('Current password is required')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }

    setIsChanging(true)
    try {
      await changeMyPassword(apiBase, { currentPassword, newPassword })
      setSuccess('Password changed successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsChanging(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Ensure your account is protected with a strong, unique password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lt:flex lt:flex-col lt:gap-4"
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          {success && (
            <Alert className="lt:border-success-border lt:bg-success-bg lt:text-success-text">
              {success}
            </Alert>
          )}

          <div className="lt:flex lt:flex-col lt:gap-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
            />
          </div>

          <div className="lt:grid lt:grid-cols-1 lt:gap-4 lt:sm:grid-cols-2">
            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </div>

            <div className="lt:flex lt:flex-col lt:gap-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
              />
            </div>
          </div>

          <div className="lt:flex lt:justify-end">
            <Button type="submit" disabled={isChanging}>
              {isChanging ? 'Changing password...' : 'Update password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export interface SessionCardProps {
  user: AdminUser
  session: AdminSession | null
  onSignOut: () => void
}

function SessionCard(props: SessionCardProps) {
  const { user, session, onSignOut } = props
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active session</CardTitle>
        <CardDescription>Manage your current session and sign out.</CardDescription>
      </CardHeader>
      <CardContent className="lt:flex lt:flex-col lt:gap-4">
        <div className="lt:flex lt:items-center lt:justify-between lt:rounded-md lt:border lt:border-border lt:p-3">
          <div className="lt:flex lt:flex-col">
            <span className="lt:text-sm lt:font-semibold lt:text-foreground">
              Current browser session
            </span>
            <span className="lt:text-xs lt:text-muted-foreground">
              User ID: {user.id} {session?.id ? `• Session: ${session.id.slice(0, 8)}...` : ''}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onSignOut}
            className="lt:text-destructive lt:hover:border-destructive"
          >
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function AccountView() {
  const { apiBase } = useAdmin()
  const { user, session, signOut } = useAuth()

  if (!user) {
    return (
      <div>
        <ViewHeader title="Account" />
        <Alert variant="destructive">You must be logged in to view account settings.</Alert>
      </div>
    )
  }

  return (
    <div className="lt:max-w-3xl">
      <ViewHeader title="Account">
        <ViewSubtitle>Manage your personal profile and account credentials.</ViewSubtitle>
      </ViewHeader>

      <div className="lt:flex lt:flex-col lt:gap-6">
        <ProfileDetailsCard user={user} apiBase={apiBase} />
        <ChangePasswordCard apiBase={apiBase} />
        <SessionCard
          user={user}
          session={session}
          onSignOut={() => {
            void signOut()
          }}
        />
      </div>
    </div>
  )
}
