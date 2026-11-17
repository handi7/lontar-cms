import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { formatApiErrorMessage, verifyEmail } from '../api/client'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useAdmin } from '../context/AdminContext'
import { BrandMark } from '../layout/BrandMark'

export function VerifyEmailView() {
  const { apiBase } = useAdmin()
  const router = useRouter()
  const searchStr = router.state.location.searchStr
  const searchParams = new URLSearchParams(searchStr)
  const token = searchParams.get('token')
  const urlError = searchParams.get('error')

  const [isLoading, setIsLoading] = useState(Boolean(token && !urlError))
  const [error, setError] = useState<string | null>(
    urlError ? 'Email verification link is invalid or has expired.' : null,
  )
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token || urlError) return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    verifyEmail(apiBase, token)
      .then(() => {
        if (!cancelled) {
          setSuccess(true)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(formatApiErrorMessage(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [apiBase, token, urlError])

  return (
    <div className="lt:flex lt:min-h-screen lt:items-center lt:justify-center lt:bg-background lt:p-6">
      <Card className="lt:w-full lt:max-w-[400px] lt:gap-0 lt:rounded-[calc(var(--lontar-radius)*1.5)] lt:p-9 lt:shadow-md">
        <div className="lt:mb-6 lt:text-center">
          <BrandMark />
          <h1 className="lt:mt-3 lt:mb-1.5 lt:text-[1.375rem] lt:font-bold lt:text-foreground">
            Verify Email
          </h1>
          <p className="lt:m-0 lt:text-sm lt:text-muted-foreground">
            Confirm your email address to access your Lontar CMS account.
          </p>
        </div>

        {!token && !urlError ? (
          <div className="lt:flex lt:flex-col lt:gap-5">
            <Alert variant="destructive">
              Invalid or missing verification token. Please sign in or contact an administrator to
              request a new verification email.
            </Alert>
            <Button asChild className="lt:w-full">
              <Link to="/login">Go to Sign In</Link>
            </Button>
          </div>
        ) : isLoading ? (
          <div className="lt:flex lt:flex-col lt:items-center lt:gap-4 lt:py-6">
            <p className="lt:text-sm lt:text-muted-foreground">Verifying your email address...</p>
          </div>
        ) : success ? (
          <div className="lt:flex lt:flex-col lt:gap-5">
            <Alert className="lt:border-success-border lt:bg-success-bg lt:text-success-text">
              Your email address has been verified successfully!
            </Alert>
            <Button asChild className="lt:w-full">
              <Link to="/login">Sign in to Admin</Link>
            </Button>
          </div>
        ) : (
          <div className="lt:flex lt:flex-col lt:gap-5">
            <Alert variant="destructive">
              {error || 'Failed to verify email. The token may be expired or already used.'}
            </Alert>
            <Button asChild className="lt:w-full">
              <Link to="/login">Go to Sign In</Link>
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
