// Radix primitives drive pointer capture, scrolling and resize observation,
// none of which happy-dom implements. Without these the components throw before
// they ever render, so the stubs are the price of unit-testing them at all.
// Enough for the portal-container test in this package; #119 covers the rest.

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

if (!globalThis.DOMRect) {
  globalThis.DOMRect = class DOMRect {
    constructor(
      readonly x = 0,
      readonly y = 0,
      readonly width = 0,
      readonly height = 0,
    ) {}
    get top(): number {
      return this.y
    }
    get left(): number {
      return this.x
    }
    get right(): number {
      return this.x + this.width
    }
    get bottom(): number {
      return this.y + this.height
    }
    toJSON(): object {
      return { ...this }
    }
    static fromRect(other?: DOMRectInit): DOMRect {
      return new DOMRect(other?.x, other?.y, other?.width, other?.height)
    }
  }
}
