'use client'

import { useEffect, useState } from 'react'
import type { CustomFieldProps, DashboardWidgetProps, CustomViewProps } from '@lontar/admin'
import { useLontarFetch } from '@lontar/admin'

export function StarRating({ value, onChange, readOnly }: CustomFieldProps) {
  const rating = typeof value === 'number' ? value : 0

  return (
    <div data-testid="star-rating" className="flex items-center gap-1 py-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          onClick={() => onChange(star)}
          className={`text-2xl p-1 transition-colors ${
            star <= rating ? 'text-amber-500' : 'text-gray-300'
          } ${readOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:scale-110'}`}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
      <span className="text-sm text-gray-500 ml-2" data-testid="star-rating-value">
        {rating > 0 ? `${rating}/5` : 'No rating'}
      </span>
    </div>
  )
}

export function PendingPostsWidget({ width: _width }: DashboardWidgetProps) {
  const lontarFetch = useLontarFetch()
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    lontarFetch('/stats/pending-posts')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch pending posts')
        return res.json()
      })
      .then((data: { count?: number }) => {
        if (active) {
          setCount(data.count ?? 0)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) {
          setCount(0)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [lontarFetch])

  return (
    <div
      data-testid="pending-posts-widget"
      className="rounded-lg border border-border p-4 bg-card shadow-sm flex flex-col justify-between"
    >
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">Pending Posts</h3>
        <p className="text-2xl font-bold mt-2" data-testid="pending-posts-count">
          {loading ? '...' : count}
        </p>
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        Draft posts awaiting review or publication
      </p>
    </div>
  )
}

export function AnalyticsView({ label }: CustomViewProps) {
  return (
    <div data-testid="analytics-view" className="p-6 space-y-4">
      <h2 className="text-xl font-semibold text-foreground">{label} Overview</h2>
      <p className="text-muted-foreground">
        Custom analytics view demo demonstrating extensible admin navigation and view mounting.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="text-sm font-medium text-muted-foreground">Page Views</div>
          <div className="text-2xl font-bold mt-1">12,450</div>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="text-sm font-medium text-muted-foreground">Unique Visitors</div>
          <div className="text-2xl font-bold mt-1">3,820</div>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="text-sm font-medium text-muted-foreground">Bounce Rate</div>
          <div className="text-2xl font-bold mt-1">42%</div>
        </div>
      </div>
    </div>
  )
}
