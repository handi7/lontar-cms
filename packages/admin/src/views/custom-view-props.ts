/**
 * Props of a component registered for `admin.views`. The page title is rendered by Lontar; the
 * component fills the page below it. Anything else it needs comes from the exported hooks:
 * `useAdminConfig()`, `useAuth()` and `useLontarFetch()`.
 *
 * Hiding a view is cosmetic. The endpoints a view calls must enforce access themselves.
 */
export interface CustomViewProps {
  /** The view's `key`, the last segment of its URL. (`key` itself is reserved by React.) */
  viewKey: string
  /** The view's label, as shown in the sidebar and the page title. */
  label: string
}
