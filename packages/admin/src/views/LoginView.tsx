import { useState, type FormEvent } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useAuth } from '../context/AuthContext'

export function LoginView() {
  const { user, signIn, isLoading: isAuthLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthLoading) {
    return (
      <div className="lontar-init-loading">
        <div className="lontar-spinner" />
        <p>Checking authentication...</p>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" />
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
    <div className="lontar-login-container">
      <div className="lontar-login-card">
        <div className="lontar-login-header">
          <div className="lontar-login-brand">
            <span className="lontar-brand-icon">L</span>
            <span className="lontar-brand-name">Lontar CMS</span>
          </div>
          <h1 className="lontar-login-title">Sign in to Admin</h1>
          <p className="lontar-login-subtitle">Enter your credentials to access the admin panel</p>
        </div>

        {error && (
          <div className="lontar-alert lontar-alert-error" role="alert">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="lontar-login-form"
        >
          <div className="lontar-field">
            <label htmlFor="lontar-login-email" className="lontar-label">
              Email
            </label>
            <input
              id="lontar-login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="lontar-input"
              autoComplete="email"
            />
          </div>

          <div className="lontar-field">
            <label htmlFor="lontar-login-password" className="lontar-label">
              Password
            </label>
            <input
              id="lontar-login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="lontar-input"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="lontar-btn lontar-btn-primary lontar-login-submit"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
