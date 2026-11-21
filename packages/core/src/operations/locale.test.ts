import { describe, expect, it } from 'vitest'
import { fields as f } from '../fields'
import type { Config } from '../config/types'
import { mergeDraftLocaleData, projectCanonicalDoc, resolveOperationLocale } from './locale'

const fields = {
  title: f.text({ localized: true }),
  slug: f.text(),
  body: f.richText({ localized: true }),
  seo: f.group({ fields: { heading: f.text({ localized: true }), canonical: f.text() } }),
  items: f.array({ fields: { label: f.text({ localized: true }) } }),
}

describe('mergeDraftLocaleData with locale=all', () => {
  it('keeps locales that the body does not mention', () => {
    const merged = mergeDraftLocaleData(
      fields,
      { title: { en: 'News', id: 'Berita' }, slug: 'news' },
      { title: { id: 'Baru' } },
      'all',
      'en',
    )
    expect(merged.title).toEqual({ en: 'News', id: 'Baru' })
    expect(merged.slug).toBe('news')
  })

  it('merges localized subfields of groups and array rows per locale', () => {
    const merged = mergeDraftLocaleData(
      fields,
      {
        seo: { heading: { en: 'A', id: 'B' }, canonical: '/x' },
        items: [{ id: 'r1', label: { en: 'one', id: 'satu' } }],
      },
      {
        seo: { heading: { id: 'C' } },
        items: [{ id: 'r1', label: { id: 'dua' } }],
      },
      'all',
      'en',
    )
    expect(merged.seo).toEqual({ heading: { en: 'A', id: 'C' }, canonical: '/x' })
    expect(merged.items).toEqual([{ id: 'r1', label: { en: 'one', id: 'dua' } }])
  })

  it('replaces a legacy richText document instead of adding a locale key to it', () => {
    const legacy = { type: 'doc', content: [] }
    const merged = mergeDraftLocaleData(
      fields,
      { body: legacy },
      { body: { en: legacy } },
      'all',
      'en',
    )
    expect(merged.body).toEqual({ en: legacy })
  })
})

describe('mergeDraftLocaleData with a single locale', () => {
  it('moves a legacy richText document under the default locale', () => {
    const legacy = { type: 'doc', content: [] }
    const merged = mergeDraftLocaleData(
      fields,
      { body: legacy },
      { body: { type: 'doc' } },
      'id',
      'en',
    )
    expect(merged.body).toEqual({ en: legacy, id: { type: 'doc' } })
  })
})

describe('resolveOperationLocale with localization.fallback', () => {
  const make = (fallback?: boolean) =>
    ({
      localization: { locales: ['en', 'id'], defaultLocale: 'en', fallback },
    }) as unknown as Config

  it('leaves fallback to the default locale when it is not disabled', () => {
    expect(resolveOperationLocale(make(), 'id')).toEqual({ locale: 'id', fallbackLocale: 'en' })
    expect(resolveOperationLocale(make(true), 'id', 'en').fallbackLocale).toBe('en')
  })

  it('turns fallback off for every read when fallback is false', () => {
    expect(resolveOperationLocale(make(false), 'id').fallbackLocale).toBe(false)
    expect(resolveOperationLocale(make(false), 'id', 'en').fallbackLocale).toBe(false)
  })
})

describe('projectCanonicalDoc is idempotent for localized richText', () => {
  const body = { type: 'doc', content: [{ type: 'paragraph' }] }
  const fields = { body: f.richText({ localized: true }), title: f.text({ localized: true }) }
  const ctx = { locale: 'id', defaultLocale: 'en' }

  it('keeps a richText document that is already projected', () => {
    const once = projectCanonicalDoc({ body: { id: body }, title: { id: 'Halo' } }, fields, ctx)
    expect(once.body).toEqual(body)
    expect(projectCanonicalDoc(once, fields, ctx)).toEqual(once)
  })
})
