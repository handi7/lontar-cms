import { describe, expect, it } from 'vitest'
import { humanize } from './humanize'

describe('humanize', () => {
  it.each([
    ['posts', 'Posts'],
    ['site-settings', 'Site Settings'],
    ['publishedAt', 'Published At'],
    ['seo_title', 'Seo Title'],
  ])('turns %j into %j', (name, label) => {
    expect(humanize(name)).toBe(label)
  })
})
