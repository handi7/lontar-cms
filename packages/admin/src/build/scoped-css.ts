// Build-time guard for architecture rule 7 in AGENTS.md: the admin's stylesheet
// ships into someone else's page, so nothing it emits may match an element
// outside the `.lontar-admin` wrapper.
//
// Tailwind emits theme variables as `@layer theme { :root { ... } }` and there is
// no supported option to change that selector, so `:root`/`:host` are rewritten
// here instead. Prefixed utilities (`.lt\:flex`) are top-level class selectors by
// construction and cannot be nested under the wrapper — the `lt` prefix is what
// keeps them from colliding with the host app. See docs/adr/0019.
import postcss from 'postcss'
import type { AtRule, Container, Document, Root, Rule } from 'postcss'

const SCOPE_CLASS = '.lontar-admin'
const UTILITY_PREFIX = '.lt\\:'
const KEYFRAMES_PREFIX = 'lontar-'
// Tailwind names its internal custom properties `--tw-*` whatever prefix is
// configured, and registers them with @property at the top level. They are
// namespaced and inherit: false, so they change nothing on their own.
const PROPERTY_PREFIXES = ['--lt-', '--lontar-', '--tw-']
// Tailwind puts a Safari fallback for those same properties in `@layer
// properties`, declared on `*, :before, :after, ::backdrop`. It cannot be
// turned off, so it is scoped instead. A universal selector anywhere else is
// still an error — that is how an accidental preflight import gets caught.
const PROPERTIES_LAYER = 'properties'

const ROOT_SELECTOR = /^:(?:root|host)(?=$|[\s>+~])/

/** `:root, :host` -> `.lontar-admin`, leaving every other selector untouched. */
function rewriteRootSelector(selector: string): string {
  if (!selector.includes(':root') && !selector.includes(':host')) return selector

  const rewritten = selector
    .split(',')
    .map((part) => part.trim().replace(ROOT_SELECTOR, SCOPE_CLASS))

  return [...new Set(rewritten)].join(',')
}

function isScoped(selector: string): boolean {
  return selector.includes(SCOPE_CLASS) || selector.includes(UTILITY_PREFIX)
}

function isInPropertiesLayer(rule: Rule): boolean {
  let node: Container | Document | undefined = rule.parent
  while (node) {
    const atRule = node as AtRule
    if (
      node.type === 'atrule' &&
      atRule.name === 'layer' &&
      atRule.params.trim() === PROPERTIES_LAYER
    ) {
      return true
    }
    node = node.parent
  }
  return false
}

/** `*, :before` -> the same, confined to the wrapper and its descendants. */
function scopeUniversalSelector(selector: string): string {
  return selector
    .split(',')
    .map((part) => part.trim())
    .flatMap((part) => {
      if (part.includes(SCOPE_CLASS)) return [part]
      if (part === '*') return [SCOPE_CLASS, `${SCOPE_CLASS} *`]
      if (part.startsWith(':')) return [`${SCOPE_CLASS}${part}`, `${SCOPE_CLASS} ${part}`]
      return [part]
    })
    .join(',')
}

function isInsideKeyframes(rule: Rule): boolean {
  const parent = rule.parent
  return parent?.type === 'atrule' && (parent as AtRule).name.endsWith('keyframes')
}

/** At-rules that register something globally rather than matching a selector. */
function atRuleViolation(atRule: AtRule): string | null {
  const params = atRule.params.trim()

  if (atRule.name.endsWith('keyframes') && !params.startsWith(KEYFRAMES_PREFIX)) {
    return `@keyframes ${params}`
  }
  if (atRule.name === 'property' && !PROPERTY_PREFIXES.some((p) => params.startsWith(p))) {
    return `@property ${params}`
  }
  if (atRule.name === 'font-face') {
    return '@font-face'
  }
  return null
}

function collectViolations(root: Root): string[] {
  const violations: string[] = []

  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return
    for (const selector of rule.selectors) {
      if (!isScoped(selector)) violations.push(selector)
    }
  })

  root.walkAtRules((atRule) => {
    const violation = atRuleViolation(atRule)
    if (violation) violations.push(violation)
  })

  return [...new Set(violations)]
}

export class UnscopedCssError extends Error {
  readonly violations: string[]

  constructor(violations: string[]) {
    super(
      `@lontar/admin: ${violations.length} selector(s) would escape the ${SCOPE_CLASS} wrapper ` +
        `and leak into the host app:\n` +
        violations.map((v) => `  ${v}`).join('\n') +
        `\n\nEvery rule must be nested under ${SCOPE_CLASS} or written as a prefixed ` +
        `Tailwind utility (lt:flex). See docs/adr/0019-admin-shadcn-tailwind-scoping.md.`,
    )
    this.name = 'UnscopedCssError'
    this.violations = violations
  }
}

/**
 * Rewrites `:root`/`:host` to the admin wrapper, then throws if any selector
 * left in the stylesheet could match an element outside it.
 */
export function scopeEmittedCss(css: string, from = 'styles.css'): string {
  const root = postcss.parse(css, { from })

  root.walkRules((rule) => {
    const rewritten = rewriteRootSelector(rule.selector)
    rule.selector = isInPropertiesLayer(rule) ? scopeUniversalSelector(rewritten) : rewritten
  })

  const violations = collectViolations(root)
  if (violations.length > 0) throw new UnscopedCssError(violations)

  return root.toString()
}
