import { describe, expect, it } from 'vitest'
import { scopeEmittedCss, UnscopedCssError } from './scoped-css'

describe('scopeEmittedCss', () => {
  describe('rewrites the selectors Tailwind emits its theme on', () => {
    it('rewrites :root', () => {
      expect(scopeEmittedCss(':root{--lt-spacing:.25rem}')).toBe(
        '.lontar-admin{--lt-spacing:.25rem}',
      )
    })

    it('collapses :root, :host to a single wrapper selector', () => {
      expect(scopeEmittedCss(':root,:host{--lt-spacing:.25rem}')).toBe(
        '.lontar-admin{--lt-spacing:.25rem}',
      )
    })

    it('keeps the cascade layer around a rewritten rule', () => {
      expect(scopeEmittedCss('@layer theme{:root,:host{--lt-color-primary:#0f172a}}')).toBe(
        '@layer theme{.lontar-admin{--lt-color-primary:#0f172a}}',
      )
    })

    it('rewrites :root inside a media query', () => {
      expect(scopeEmittedCss('@media (min-width:40rem){:root{--lt-spacing:.5rem}}')).toBe(
        '@media (min-width:40rem){.lontar-admin{--lt-spacing:.5rem}}',
      )
    })

    it('rewrites a :root descendant selector without mangling the rest', () => {
      expect(scopeEmittedCss(':root .lontar-admin .btn{color:red}')).toBe(
        '.lontar-admin .lontar-admin .btn{color:red}',
      )
    })
  })

  describe("scopes Tailwind's universal property fallback", () => {
    const fallback = (selector: string) =>
      `@layer properties{@supports (-webkit-hyphens:none){${selector}{--tw-border-style:solid}}}`

    it('confines the universal selector to the wrapper', () => {
      expect(scopeEmittedCss(fallback('*'))).toBe(fallback('.lontar-admin,.lontar-admin *'))
    })

    it('confines the pseudo-element selectors too', () => {
      expect(scopeEmittedCss(fallback('*,:before,:after,::backdrop'))).toBe(
        fallback(
          '.lontar-admin,.lontar-admin *,.lontar-admin:before,.lontar-admin :before,' +
            '.lontar-admin:after,.lontar-admin :after,' +
            '.lontar-admin::backdrop,.lontar-admin ::backdrop',
        ),
      )
    })

    it('leaves an already-scoped selector alone', () => {
      const css = fallback('.lontar-admin *')
      expect(scopeEmittedCss(css)).toBe(css)
    })

    it('still rejects a universal selector outside that layer', () => {
      expect(() => scopeEmittedCss('@layer utilities{*{box-sizing:border-box}}')).toThrow(
        UnscopedCssError,
      )
    })
  })

  describe('allows what legitimately ships', () => {
    it('allows rules scoped under the wrapper', () => {
      const css = '.lontar-admin .lontar-btn{padding:0.5rem}'
      expect(scopeEmittedCss(css)).toBe(css)
    })

    it('allows the wrapper itself', () => {
      const css = '.lontar-admin{--lontar-radius:6px}'
      expect(scopeEmittedCss(css)).toBe(css)
    })

    it('nests prefixed Tailwind utilities under the wrapper', () => {
      expect(scopeEmittedCss('.lt\\:flex{display:flex}')).toBe(
        '.lontar-admin .lt\\:flex{display:flex}',
      )
    })

    it('nests prefixed utilities carrying variants', () => {
      expect(
        scopeEmittedCss('.lt\\:hover\\:bg-primary:hover{background:var(--lontar-primary)}'),
      ).toBe('.lontar-admin .lt\\:hover\\:bg-primary:hover{background:var(--lontar-primary)}')
    })

    it('nests a utility whose selector starts with a pseudo-class', () => {
      expect(
        scopeEmittedCss(
          ':is(:where(.lt\\:peer):disabled~.lt\\:peer-disabled\\:opacity-50){opacity:.5}',
        ),
      ).toBe(
        '.lontar-admin :is(:where(.lt\\:peer):disabled~.lt\\:peer-disabled\\:opacity-50){opacity:.5}',
      )
    })

    it('nests each selector of a list once, keeping commas inside :is() intact', () => {
      expect(scopeEmittedCss('.lt\\:a:is(.x,.y),.lt\\:b{color:red}')).toBe(
        '.lontar-admin .lt\\:a:is(.x,.y),.lontar-admin .lt\\:b{color:red}',
      )
    })

    it('allows keyframes with a lontar- name, including their percent steps', () => {
      const css = '@keyframes lontar-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'
      expect(scopeEmittedCss(css)).toBe(css)
    })

    it('allows @property registering a prefixed custom property', () => {
      const css = '@property --lt-rotate-x{syntax:"*";inherits:false}'
      expect(scopeEmittedCss(css)).toBe(css)
    })

    it("allows Tailwind's own --tw- internals, which the prefix does not rename", () => {
      const css = '@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}'
      expect(scopeEmittedCss(css)).toBe(css)
    })
  })

  // #143: host CSS is usually unlayered, and an unlayered rule beats every
  // layered one whatever its specificity.
  describe('moves the reset and the utilities out of their cascade layers', () => {
    it('unwraps the utilities layer', () => {
      expect(
        scopeEmittedCss('@layer utilities{.lt\\:flex{display:flex}.lt\\:p-2{padding:.5rem}}'),
      ).toBe('.lontar-admin .lt\\:flex{display:flex}.lontar-admin .lt\\:p-2{padding:.5rem}')
    })

    it('unwraps the base layer', () => {
      expect(scopeEmittedCss('@layer base{.lontar-admin h1{margin:.67em 0}}')).toBe(
        '.lontar-admin h1{margin:.67em 0}',
      )
    })

    it('keeps a media query inside the unwrapped layer', () => {
      expect(
        scopeEmittedCss('@layer utilities{@media (hover:hover){.lt\\:hover\\:x:hover{color:red}}}'),
      ).toBe('@media (hover:hover){.lontar-admin .lt\\:hover\\:x:hover{color:red}}')
    })

    it('keeps the source order of the unwrapped rules', () => {
      expect(
        scopeEmittedCss(
          '@layer base{.lontar-admin p{margin:1em 0}}@layer utilities{.lt\\:m-0{margin:0}}.lontar-admin .lontar-btn{margin:0}',
        ),
      ).toBe(
        '.lontar-admin p{margin:1em 0}.lontar-admin .lt\\:m-0{margin:0}.lontar-admin .lontar-btn{margin:0}',
      )
    })

    it('leaves the theme and properties layers and the layer order statement alone', () => {
      const css =
        '@layer theme,base,components,utilities;@layer theme{.lontar-admin{--lt-spacing:.25rem}}'
      expect(scopeEmittedCss(css)).toBe(css)
    })
  })

  describe('rejects anything that would reach the host page', () => {
    it.each([
      ['a bare element selector', 'body{margin:0}', 'body'],
      ['the html element', 'html{font-size:16px}', 'html'],
      ['the universal selector', '*{box-sizing:border-box}', '*'],
      ['preflight-style grouped elements', 'h1,h2,h3{font-size:inherit}', 'h1'],
      ['an unprefixed utility', '.flex{display:flex}', '.flex'],
      ['an unscoped class of our own', '.lontar-btn{padding:0}', '.lontar-btn'],
      ['unprefixed keyframes', '@keyframes spin{from{opacity:0}}', '@keyframes spin'],
      ['an unprefixed @property', '@property --rotate{syntax:"*"}', '@property --rotate'],
      ['a font-face', '@font-face{font-family:Inter;src:url(a.woff2)}', '@font-face'],
    ])('rejects %s', (_label, css, expected) => {
      expect(() => scopeEmittedCss(css)).toThrow(UnscopedCssError)
      try {
        scopeEmittedCss(css)
      } catch (error) {
        expect((error as UnscopedCssError).violations).toContain(expected)
      }
    })

    it('reports every offender at once rather than only the first', () => {
      try {
        scopeEmittedCss('body{margin:0}.flex{display:flex}.lontar-admin{color:red}')
        expect.unreachable('should have thrown')
      } catch (error) {
        expect((error as UnscopedCssError).violations).toEqual(['body', '.flex'])
      }
    })

    it('names the offending selector in the message', () => {
      expect(() => scopeEmittedCss('body{margin:0}')).toThrow(/body/)
    })

    it('rejects a rule that is only partly scoped', () => {
      try {
        scopeEmittedCss('.lontar-admin .btn,.btn{padding:0}')
        expect.unreachable('should have thrown')
      } catch (error) {
        expect((error as UnscopedCssError).violations).toEqual(['.btn'])
      }
    })
  })
})
