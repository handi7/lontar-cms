import { describe, expect, it } from 'vitest'

// Radix primitives call these at runtime and throw without them. happy-dom
// implements all of them, which is why vitest.config.ts has no setup file to
// polyfill them. If the environment ever changes (a happy-dom upgrade that
// drops one, or a move to jsdom, which lacks most of them), this fails with
// the missing API's name rather than as a TypeError inside a Select test.
describe('test DOM environment', () => {
  it.each<[string, object, string]>([
    ['ResizeObserver', globalThis, 'ResizeObserver'],
    ['DOMRect', globalThis, 'DOMRect'],
    ['PointerEvent', globalThis, 'PointerEvent'],
    ['Element.prototype.hasPointerCapture', Element.prototype, 'hasPointerCapture'],
    ['Element.prototype.setPointerCapture', Element.prototype, 'setPointerCapture'],
    ['Element.prototype.releasePointerCapture', Element.prototype, 'releasePointerCapture'],
    ['Element.prototype.scrollIntoView', Element.prototype, 'scrollIntoView'],
  ])('provides %s natively', (_name, owner, key) => {
    expect(typeof Reflect.get(owner, key)).toBe('function')
  })
})
