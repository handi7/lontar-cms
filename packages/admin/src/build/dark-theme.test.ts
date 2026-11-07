// Pins the dark theme's token blocks in styles.css (docs/adr/0020). They are
// declared twice, for the system preference and for an explicit choice, and
// nothing but this test keeps the copies in step.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../styles.css'), 'utf8')
const root = postcss.parse(css)

function declarations(rule: Rule | undefined): Map<string, string> {
  const out = new Map<string, string>()
  rule?.each((node) => {
    if (node.type === 'decl') out.set(node.prop, node.value)
  })
  return out
}

function findRule(selector: string, inMedia?: string): Rule | undefined {
  let found: Rule | undefined
  root.walkRules((rule) => {
    if (rule.selector !== selector) return
    const parent = rule.parent
    const media = parent?.type === 'atrule' && 'params' in parent ? parent.params : undefined
    if (media === inMedia) found = rule
  })
  return found
}

// The public tokens, as README.md documents them. --lontar-radius is the one
// token that is not a colour and has no dark value.
function lightTokens(): Map<string, string> {
  let light: Map<string, string> | undefined
  root.walkRules('.lontar-admin', (rule) => {
    const decls = declarations(rule)
    if (decls.has('--lontar-bg')) light = decls
  })
  if (!light) throw new Error('light token block not found')
  return new Map(
    [...light].filter(([prop]) => prop.startsWith('--lontar-') && !prop.endsWith('-subtle')),
  )
}

const systemDark = declarations(
  findRule(".lontar-admin:not([data-theme='light'])", '(prefers-color-scheme: dark)'),
)
const explicitDark = declarations(findRule(".lontar-admin[data-theme='dark']"))

describe('dark theme tokens', () => {
  it('declares the system and explicit dark blocks identically', () => {
    expect(systemDark.size).toBeGreaterThan(0)
    expect(Object.fromEntries(explicitDark)).toEqual(Object.fromEntries(systemDark))
  })

  it('gives every public colour token a dark value', () => {
    const colourTokens = [...lightTokens().keys()].filter((t) => t !== '--lontar-radius')
    const missing = colourTokens.filter((t) => !explicitDark.has(t))
    expect(missing).toEqual([])
  })

  it('declares nothing in the dark blocks that the light theme does not have', () => {
    const light = lightTokens()
    const extra = [...explicitDark.keys()].filter((t) => t !== 'color-scheme' && !light.has(t))
    expect(extra).toEqual([])
  })

  it('switches native controls with the theme', () => {
    expect(explicitDark.get('color-scheme')).toBe('dark')
    let lightScheme: string | undefined
    root.walkRules('.lontar-admin', (rule) => {
      const decls = declarations(rule)
      if (decls.has('--lontar-bg')) lightScheme = decls.get('color-scheme')
    })
    expect(lightScheme).toBe('light')
  })
})

// A colour written straight into a rule ignores the theme: it stays the same
// in dark mode, where it is usually wrong. Colours belong in the token blocks.
describe('hand-written rules', () => {
  it('use tokens rather than colour literals', () => {
    const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i
    const offenders: string[] = []
    root.walkDecls((decl: Declaration) => {
      if (decl.prop.startsWith('--lontar-')) return
      if (literal.test(decl.value)) {
        const parent = decl.parent as Rule | undefined
        offenders.push(`${parent?.selector ?? '?'} { ${decl.prop}: ${decl.value} }`)
      }
    })
    expect(offenders).toEqual([])
  })
})
