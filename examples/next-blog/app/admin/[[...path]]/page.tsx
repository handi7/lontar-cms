'use client'

import { Admin, type AdminComponents } from '@lontar/admin'
import '@lontar/admin/styles.css'
import { StarRating, PendingPostsWidget, AnalyticsView } from '../components'

const adminComponents: AdminComponents = {
  'star-rating': StarRating,
  'pending-posts-widget': PendingPostsWidget,
  'analytics-view': AnalyticsView,
}

export default function AdminPage() {
  return <Admin apiBase="/api" basePath="/admin" components={adminComponents} />
}
