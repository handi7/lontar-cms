/**
 * Props of a component registered for `admin.dashboard.widgets`. Anything else a widget needs comes
 * from the exported hooks: `useAdminConfig()`, `useAuth()` and `useLontarFetch()`.
 */
export interface DashboardWidgetProps {
  /** The width the config gave this widget, for components that adapt their layout. */
  width: 'full' | 'half'
}
