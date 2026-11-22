import type { Config } from './types'

const WIDGET_WIDTHS = new Set(['full', 'half'])

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function validateWidget(widget: unknown, index: number): string[] {
  const where = `Config admin.dashboard.widgets[${index}]`
  if (typeof widget !== 'object' || widget === null) return [`${where}: must be an object.`]
  const { component, width } = widget as { component?: unknown; width?: unknown }
  const issues: string[] = []
  if (!isNonEmptyString(component)) {
    issues.push(`${where}: component must be a non-empty string.`)
  }
  if (width !== undefined && (typeof width !== 'string' || !WIDGET_WIDTHS.has(width))) {
    issues.push(`${where}: width must be "full" or "half".`)
  }
  return issues
}

function validateDashboard(dashboard: unknown): string[] {
  if (dashboard === undefined) return []
  if (typeof dashboard !== 'object' || dashboard === null) {
    return ['Config admin.dashboard must be an object.']
  }
  const { widgets } = dashboard as { widgets?: unknown }
  if (widgets === undefined) return []
  if (!Array.isArray(widgets)) return ['Config admin.dashboard.widgets must be an array.']
  return (widgets as unknown[]).flatMap((widget, index) => validateWidget(widget, index))
}

const VIEW_KEY = /^[a-z][a-z0-9-]*$/

function validateView(view: unknown, index: number, seen: Set<string>): string[] {
  const where = `Config admin.views[${index}]`
  if (typeof view !== 'object' || view === null) return [`${where}: must be an object.`]
  const { key, label, component, access } = view as Record<string, unknown>
  const issues: string[] = []
  if (typeof key !== 'string' || !VIEW_KEY.test(key)) {
    issues.push(
      `${where}: key must be kebab-case (lowercase letters, digits and hyphens, starting with a letter), since it becomes the last segment of the view's URL.`,
    )
  } else if (seen.has(key)) {
    issues.push(`${where}: key "${key}" is used twice.`)
  } else {
    seen.add(key)
  }
  if (!isNonEmptyString(label)) issues.push(`${where}: label must be a non-empty string.`)
  if (!isNonEmptyString(component)) issues.push(`${where}: component must be a non-empty string.`)
  if (access !== undefined && typeof access !== 'function') {
    issues.push(`${where}: access must be a function.`)
  }
  return issues
}

function validateViews(views: unknown, collections: Config['collections']): string[] {
  if (views === undefined) return []
  if (!Array.isArray(views)) return ['Config admin.views must be an array.']
  if (views.length === 0) return []
  const seen = new Set<string>()
  const issues = (views as unknown[]).flatMap((view, index) => validateView(view, index, seen))
  // `/views/$key` would shadow the edit route `/$collection/$id` of a collection named "views".
  if ((collections ?? []).some((collection) => collection.slug === 'views')) {
    issues.push(
      'Collection slug "views" conflicts with admin.views: the admin serves custom views at "/views/<key>", which would shadow that collection\'s edit route. Rename the collection or remove admin.views.',
    )
  }
  return issues
}

/** The root `admin` block: dashboard widgets and custom views (ADR 0029). */
export function validateAdminConfig(config: Pick<Config, 'admin' | 'collections'>): string[] {
  const admin: unknown = config.admin
  if (admin === undefined) return []
  if (typeof admin !== 'object' || admin === null) return ['Config admin must be an object.']
  const { dashboard, views } = admin as { dashboard?: unknown; views?: unknown }
  return [...validateDashboard(dashboard), ...validateViews(views, config.collections)]
}
