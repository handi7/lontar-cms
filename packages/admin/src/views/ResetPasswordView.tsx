import { useState, type FormEvent } from 'react'
import { validatePassword } from '@lontar/core/client'
import { Link, useRouter } from '@tanstack/react-router'
import { formatApiErrorMessage, resetPassword } from '../api/client'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAdmin } from '../context/AdminContext'
import { BrandMark } from '../layout/BrandMark'

export function ResetPasswordView() {
  const { apiBase } = useAdmin()
  const router = useRouter()
  const searchStr = router.state.location.searchStr
  const token = new URLSearchParams(searchStr).get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!token) {
    return (
      <div className="lt:flex lt:min-h-screen lt:items-center lt:justify-center lt:bg-background lt:p-6">
        <Card className="lt:w-full lt:max-w-[400px] lt:gap-0 lt:rounded-[calc(var(--lontar-radius)*1.5)] lt:p-9 lt:shadow-md">
          <div className="lt:mb-6 lt:text-center">
            <BrandMark />
            <h1 className="lt:mt-3 lt:mb-1.5 lt:text-[1.375rem] lt:font-bold lt:text-foreground">
              Reset Password
            </h1>
          </div>
          <Alert variant="destructive" className="lt:mb-6">
            Invalid or missing reset token. Please request a new password reset link.
          </Alert>
          <Button asChild className="lt:w-full">
            <Link to="/login">Back to Sign In</Link>
          </Button>
        </Card>
      </div>
    )
  }

  const handleSubmit = async (e: FormEvent) => {
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
      await resetPassword(apiBase, { token, newPassword: password })
      setSuccess(true)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="lt:flex lt:min-h-screen lt:items-center lt:justify-center lt:bg-background lt:p-6">
      <Card className="lt:w-full lt:max-w-[400px] lt:gap-0 lt:rounded-[calc(var(--lontar-radius)*1.5)] lt:p-9 lt:shadow-md">
        <div className="lt:mb-6 lt:text-center">
          <BrandMark />
          <h1 className="lt:mt-3 lt:mb-1.5 lt:text-[1.375rem] lt:font-bold lt:text-foreground">
            Set New Password
          </h1>
          <p className="lt:m-0 lt:text-sm lt:text-muted-foreground">
            Please enter your new password below.
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="lt:mb-5">
            {error}
          </Alert>
        )}

        {success ? (
          <div className="lt:flex lt:flex-col lt:gap-5">
            <Alert className="lt:border-success-border lt:bg-success-bg lt:text-success-text">
              Your password has been reset successfully.
            </Alert>
            <Button asChild className="lt:w-full">
              <Link to="/login">Sign in with new password</Link>
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e)
            }}
            className="lt:flex lt:flex-col lt:gap-5"
          >
            <div className="lt:flex lt:flex-col lt:gap-2">
              <Label htmlFor="reset-new-password">New password</Label>
              <Input
                id="reset-new-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <div className="lt:flex lt:flex-col lt:gap-2">
              <Label htmlFor="reset-confirm-password">Confirm new password</Label>
              <Input
                id="reset-confirm-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" disabled={isSubmitting} className="lt:mt-2 lt:h-10 lt:w-full">
              {isSubmitting ? 'Saving password...' : 'Save new password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
