import { useState, type FormEvent } from 'react'
import { Navigate, useRouter } from '@tanstack/react-router'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAuth } from '../context/AuthContext'
import { BrandMark } from '../layout/BrandMark'
import { FullPageLoading } from '../layout/FullPageState'

export function LoginView() {
  const { user, signIn, isLoading: isAuthLoading } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthLoading) {
    return <FullPageLoading>Checking authentication...</FullPageLoading>
  }

  if (user) {
    const searchStr = router.state.location.searchStr
    const redirect = new URLSearchParams(searchStr).get('redirect')
    const to = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
    return <Navigate to={to} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await signIn({ email, password })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="lt:flex lt:min-h-screen lt:items-center lt:justify-center lt:bg-background lt:p-6">
      <Card className="lt:w-full lt:max-w-[400px] lt:gap-0 lt:rounded-[calc(var(--lontar-radius)*1.5)] lt:p-9 lt:shadow-md">
        <div className="lt:mb-7 lt:text-center">
          <div className="lt:mb-4 lt:inline-flex lt:items-center lt:gap-2.5 lt:font-bold">
            <BrandMark />
          </div>
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
            <Label htmlFor="lontar-login-password">Password</Label>
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
      </Card>
    </div>
  )
}
