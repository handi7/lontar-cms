import { useState, type FormEvent } from 'react'
import { Navigate, useRouter } from '@tanstack/react-router'
import { ApiClientError, formatApiErrorMessage, requestPasswordReset } from '../api/client'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAdmin } from '../context/AdminContext'
import { useAuth } from '../context/AuthContext'
import { BrandMark } from '../layout/BrandMark'
import { FullPageLoading } from '../layout/FullPageState'

export interface LoginFormProps {
  emailEnabled: boolean
  onForgotPassword: () => void
  onSignIn: (credentials: { email: string; password: string }) => Promise<void>
}

function formatLoginError(err: unknown): string {
  if (err instanceof ApiClientError && err.status === 429) {
    if (err.retryAfter) {
      return `Too many login attempts. Please try again in ${err.retryAfter} second${err.retryAfter === 1 ? '' : 's'}.`
    }
    return 'Too many login attempts. Please try again later.'
  }
  return err instanceof Error ? err.message : 'Invalid email or password'
}

function LoginForm(props: LoginFormProps) {
  const { emailEnabled, onForgotPassword, onSignIn } = props
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await onSignIn({ email, password })
    } catch (err) {
      setError(formatLoginError(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <div className="lt:mb-7 lt:text-center">
        <h1 className="lt:mt-0 lt:mb-1.5 lt:text-[1.375rem] lt:font-bold lt:text-foreground">
          Sign in to Admin
        </h1>
        <p className="lt:m-0 lt:text-sm lt:text-muted-foreground">
          Enter your credentials to access the admin panel
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="lt:mb-5">
          {error}
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
        className="lt:flex lt:flex-col lt:gap-5"
      >
        <div className="lt:flex lt:flex-col lt:gap-2">
          <Label htmlFor="lontar-login-email">Email</Label>
          <Input
            id="lontar-login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            autoComplete="email"
          />
        </div>

        <div className="lt:flex lt:flex-col lt:gap-2">
          <div className="lt:flex lt:items-center lt:justify-between">
            <Label htmlFor="lontar-login-password">Password</Label>
            {emailEnabled && (
              <button
                type="button"
                onClick={onForgotPassword}
                className="lt:cursor-pointer lt:border-0 lt:bg-transparent lt:p-0 lt:text-xs lt:text-muted-foreground lt:underline lt:hover:text-foreground"
              >
                Forgot password?
              </button>
            )}
          </div>
          <Input
            id="lontar-login-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <Button type="submit" disabled={isSubmitting} className="lt:mt-2 lt:h-10 lt:w-full">
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>
    </div>
  )
}

export interface ForgotPasswordFormProps {
  apiBase: string
  onBack: () => void
}

function ForgotPasswordForm(props: ForgotPasswordFormProps) {
  const { apiBase, onBack } = props
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await requestPasswordReset(apiBase, email)
      setSuccess(true)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="lt:flex lt:flex-col lt:gap-5">
      <div className="lt:mb-2 lt:text-center">
        <h2 className="lt:mt-0 lt:mb-1.5 lt:text-lg lt:font-bold lt:text-foreground">
          Reset password
        </h2>
        <p className="lt:m-0 lt:text-sm lt:text-muted-foreground">
          Enter your email and we will send you a reset link.
        </p>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {success ? (
        <div className="lt:flex lt:flex-col lt:gap-4">
          <Alert className="lt:border-success-border lt:bg-success-bg lt:text-success-text">
            If an account with that email exists, we have sent a password reset link.
          </Alert>
          <Button variant="outline" onClick={onBack} className="lt:w-full">
            Back to Sign In
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lt:flex lt:flex-col lt:gap-4"
        >
          <div className="lt:flex lt:flex-col lt:gap-2">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="email"
            />
          </div>
          <Button type="submit" disabled={isSubmitting} className="lt:w-full">
            {isSubmitting ? 'Sending link...' : 'Send reset link'}
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={onBack}
            className="lt:w-full lt:text-sm lt:text-muted-foreground"
          >
            Back to Sign In
          </Button>
        </form>
      )}
    </div>
  )
}

export function LoginView() {
  const { user, signIn, isLoading: isAuthLoading } = useAuth()
  const { config, apiBase } = useAdmin()
  const router = useRouter()
  const [isForgotPassword, setIsForgotPassword] = useState(false)

  const emailEnabled = Boolean(config.auth?.emailEnabled)

  if (isAuthLoading) {
    return <FullPageLoading>Checking authentication...</FullPageLoading>
  }

  if (user) {
    const searchStr = router.state.location.searchStr
    const redirect = new URLSearchParams(searchStr).get('redirect')
    const to = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
    return <Navigate to={to} replace />
  }

  return (
    <div className="lt:flex lt:min-h-screen lt:items-center lt:justify-center lt:bg-background lt:p-6">
      <Card className="lt:w-full lt:max-w-[400px] lt:gap-0 lt:rounded-[calc(var(--lontar-radius)*1.5)] lt:p-9 lt:shadow-md">
        <div className="lt:mb-4 lt:inline-flex lt:items-center lt:justify-center lt:gap-2.5 lt:font-bold">
          <BrandMark />
        </div>

        {isForgotPassword ? (
          <ForgotPasswordForm apiBase={apiBase} onBack={() => setIsForgotPassword(false)} />
        ) : (
          <LoginForm
            emailEnabled={emailEnabled}
            onForgotPassword={() => setIsForgotPassword(true)}
            onSignIn={signIn}
          />
        )}
      </Card>
    </div>
  )
}
