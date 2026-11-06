import { defineConfig } from 'vitest/config'

// No setup file: happy-dom implements everything Radix primitives call at
// runtime (ResizeObserver, DOMRect, pointer capture, scrollIntoView), so there
// is nothing to polyfill. src/test/dom-environment.test.ts pins that, so moving
// to an environment that lacks one fails there instead of deep inside a
// component test.
export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
})
