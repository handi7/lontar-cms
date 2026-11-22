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

/** The root `admin` block: dashboard widgets (ADR 0029). */
export function validateAdminConfig(config: Pick<Config, 'admin'>): string[] {
  const admin: unknown = config.admin
  if (admin === undefined) return []
  if (typeof admin !== 'object' || admin === null) return ['Config admin must be an object.']
  return validateDashboard((admin as { dashboard?: unknown }).dashboard)
}
