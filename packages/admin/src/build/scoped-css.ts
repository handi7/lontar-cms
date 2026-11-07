// Build-time guard for architecture rule 7 in AGENTS.md: the admin's stylesheet
// ships into someone else's page, so nothing it emits may match an element
// outside the `.lontar-admin` wrapper.
//
// Tailwind emits theme variables as `@layer theme { :root { ... } }` and there is
// no supported option to change that selector, so `:root`/`:host` are rewritten
// here instead. Prefixed utilities (`.lt\:flex`) are top-level class selectors by
// construction; the `lt` prefix keeps them from colliding with the host app, and
// this step nests them under the wrapper as well. See docs/adr/0019.
//
// It also moves the reset and the utilities out of their cascade layers. The
// stylesheet is loaded into a page whose own CSS is usually unlayered (Tailwind
// v3's preflight, Bootstrap's reboot, a hand-written reset), and an unlayered
// rule beats every layered one whatever its specificity: `button {
// background-color: transparent }` would beat `lt:bg-primary` (#143). Unlayered,
// the admin's rules compete on specificity instead, which they win:
//   - utilities become `.lontar-admin .lt\:x`, (0,2,0) or more, so they beat
//     host element, attribute and universal selectors;
//   - the reset stays at (0,1,1) at most (`.lontar-admin h1`), so every utility
//     still overrides it, which is what the `base` layer was there for.
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
// Layers whose rules ship unlayered. `theme` and `properties` only declare
// custom properties on the wrapper, which no host rule competes with.
const UNLAYERED = new Set(['base', 'utilities'])

const ROOT_SELECTOR = /^:(?:root|host)(?=$|[\s>+~])/

/** `:root, :host` -> `.lontar-admin`, leaving every other selector untouched. */
function rewriteRootSelector(selector: string): string {
  if (!selector.includes(':root') && !selector.includes(':host')) return selector

  const rewritten = selector
    .split(',')
    .map((part) => part.trim().replace(ROOT_SELECTOR, SCOPE_CLASS))

  return [...new Set(rewritten)].join(',')
}

/** `.lt\:flex` -> `.lontar-admin .lt\:flex`. Every utility is used inside the wrapper. */
function scopeUtilitySelector(selector: string): string {
  if (selector.includes(SCOPE_CLASS) || !selector.includes(UTILITY_PREFIX)) return selector
  return `${SCOPE_CLASS} ${selector}`
}

/** `@layer utilities { a{} b{} }` -> `a{} b{}`, in place, so source order is kept. */
function unwrapLayers(root: Root): void {
  root.walkAtRules('layer', (atRule) => {
    if (!atRule.nodes || !UNLAYERED.has(atRule.params.trim())) return
    const children = [...atRule.nodes]
    const spacing = children.map((child) => child.raws.before)
    atRule.replaceWith(...children)
    // Moving a node makes postcss guess its leading whitespace; keep what it had.
    children.forEach((child, i) => (child.raws.before = spacing[i]))
  })
}

function isScoped(selector: string): boolean {
  return selector.includes(SCOPE_CLASS)
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
 * Rewrites `:root`/`:host` to the admin wrapper, nests utilities under it, moves
 * the reset and utilities out of their cascade layers, then throws if any
 * selector left in the stylesheet could match an element outside the wrapper.
 */
export function scopeEmittedCss(css: string, from = 'styles.css'): string {
  const root = postcss.parse(css, { from })

  root.walkRules((rule) => {
    const rewritten = rewriteRootSelector(rule.selector)
    rule.selector = isInPropertiesLayer(rule) ? scopeUniversalSelector(rewritten) : rewritten
    if (!isInsideKeyframes(rule) && rule.selector.includes(UTILITY_PREFIX)) {
      rule.selectors = rule.selectors.map(scopeUtilitySelector)
    }
  })
  unwrapLayers(root)

  const violations = collectViolations(root)
  if (violations.length > 0) throw new UnscopedCssError(violations)

  return root.toString()
}
