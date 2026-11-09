import { describe, expect, it } from 'vitest'
import { resolvePreviewUrl } from './url'

describe('resolvePreviewUrl', () => {
  it('resolves templates with populated tokens', () => {
    const result = resolvePreviewUrl('https://example.com/posts/{slug}?id={id}', {
      slug: 'hello-world',
      id: 42,
    })

    expect(result.ready).toBe(true)
    expect(result.missingTokens).toEqual([])
    expect(result.url).toBe('https://example.com/posts/hello-world?id=42')
    expect(result.origin).toBe('https://example.com')
  })

  it('encodes special characters in token values', () => {
    const result = resolvePreviewUrl('https://example.com/search?q={query}', {
      query: 'hello & world/foo',
    })

    expect(result.ready).toBe(true)
    expect(result.url).toBe('https://example.com/search?q=hello%20%26%20world%2Ffoo')
  })

  it('reports missing tokens when values are undefined, null or empty string', () => {
    const result = resolvePreviewUrl('https://example.com/posts/{slug}/edit/{locale}', {
      slug: '   ',
      locale: undefined,
    })

    expect(result.ready).toBe(false)
    expect(result.missingTokens).toEqual(['slug', 'locale'])
    expect(result.url).toBeUndefined()
  })

  it('resolves relative URLs and derives origin from window.location', () => {
    const result = resolvePreviewUrl('/posts/{slug}?preview=1', {
      slug: 'my-post',
    })

    expect(result.ready).toBe(true)
    expect(result.url).toBe('/posts/my-post?preview=1')
    expect(result.origin).toBeDefined()
  })
})
