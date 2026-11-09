import type { CSSProperties } from 'react'
import Link from 'next/link'
import type {
  Media,
  Page,
  PageLayoutBlock,
  PageLayoutCallToActionBlock,
  PageLayoutGalleryBlock,
  PageLayoutHeroBlock,
  PageLayoutRichTextBlock,
} from '@/lontar-types'
import { RichText } from '@/app/components/RichText'

function isMedia(val: unknown): val is Media {
  return typeof val === 'object' && val !== null && 'url' in val
}

function isPage(val: unknown): val is Page {
  return typeof val === 'object' && val !== null && 'slug' in val
}

function HeroBlockView({ block }: { block: PageLayoutHeroBlock }) {
  const bg = isMedia(block.backgroundImage) ? block.backgroundImage.url : undefined
  const style: CSSProperties = {
    padding: '4rem 2rem',
    borderRadius: '16px',
    backgroundColor: '#0f172a',
    color: '#ffffff',
    textAlign: 'center',
    backgroundImage: bg
      ? `linear-gradient(rgba(15, 23, 42, 0.75), rgba(15, 23, 42, 0.75)), url(${bg})`
      : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    marginBottom: '2.5rem',
  }

  return (
    <section data-testid="block-hero" data-block-type="hero" style={style}>
      <h1
        data-testid="hero-heading"
        style={{
          fontSize: '2.75rem',
          fontWeight: 800,
          letterSpacing: '-0.025em',
          margin: '0 0 1rem',
          lineHeight: 1.2,
        }}
      >
        {block.heading}
      </h1>
      {block.subheading && (
        <p
          data-testid="hero-subheading"
          style={{
            fontSize: '1.25rem',
            lineHeight: 1.6,
            maxWidth: '680px',
            margin: '0 auto',
            color: '#e2e8f0',
          }}
        >
          {block.subheading}
        </p>
      )}
    </section>
  )
}

function RichTextBlockView({ block }: { block: PageLayoutRichTextBlock }) {
  return (
    <section
      data-testid="block-richText"
      data-block-type="richText"
      style={{
        margin: '2rem 0',
        fontSize: '1.0625rem',
        lineHeight: 1.7,
        color: '#334155',
      }}
    >
      <RichText content={block.content} />
    </section>
  )
}

function GalleryBlockView({ block }: { block: PageLayoutGalleryBlock }) {
  const images = block.images || []
  if (images.length === 0) return null

  return (
    <section
      data-testid="block-gallery"
      data-block-type="gallery"
      style={{
        margin: '2.5rem 0',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {images.map((item, idx) => {
          const media = isMedia(item.image) ? item.image : null
          if (!media) return null
          return (
            <figure
              key={item.id || idx}
              data-testid="gallery-item"
              style={{
                margin: 0,
                borderRadius: '12px',
                overflow: 'hidden',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <img
                src={media.url}
                alt={item.caption || media.alt || 'Gallery image'}
                style={{
                  width: '100%',
                  height: '220px',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
              {item.caption && (
                <figcaption
                  data-testid="gallery-caption"
                  style={{
                    padding: '0.75rem 1rem',
                    fontSize: '0.875rem',
                    color: '#64748b',
                    fontStyle: 'italic',
                  }}
                >
                  {item.caption}
                </figcaption>
              )}
            </figure>
          )
        })}
      </div>
    </section>
  )
}

function CallToActionBlockView({ block }: { block: PageLayoutCallToActionBlock }) {
  let href = '#'
  let isExternal = false

  if (block.linkType === 'external' && block.externalUrl) {
    href = block.externalUrl
    isExternal = true
  } else if (block.linkType === 'internal' && block.internalPage) {
    if (isPage(block.internalPage) && block.internalPage.slug) {
      href = `/${block.internalPage.slug}`
    } else if (typeof block.internalPage === 'number') {
      href = `/${block.internalPage}`
    }
  }

  const linkProps = isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {}

  return (
    <section
      data-testid="block-callToAction"
      data-block-type="callToAction"
      style={{
        margin: '3rem 0',
        padding: '3rem 2rem',
        borderRadius: '16px',
        backgroundColor: '#eff6ff',
        border: '1px solid #bfdbfe',
        textAlign: 'center',
      }}
    >
      <h2
        data-testid="cta-headline"
        style={{
          fontSize: '2rem',
          fontWeight: 700,
          color: '#1e3a8a',
          margin: '0 0 1.5rem',
        }}
      >
        {block.headline}
      </h2>
      <Link
        href={href}
        data-testid="cta-button"
        {...linkProps}
        style={{
          display: 'inline-block',
          padding: '0.875rem 2rem',
          backgroundColor: '#2563eb',
          color: '#ffffff',
          fontWeight: 600,
          borderRadius: '8px',
          textDecoration: 'none',
          fontSize: '1rem',
          boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
        }}
      >
        {block.buttonLabel}
      </Link>
    </section>
  )
}

export function BlockRenderer({ blocks }: { blocks?: PageLayoutBlock[] | null }) {
  if (!blocks || blocks.length === 0) return null

  return (
    <div data-testid="page-blocks">
      {blocks.map((block) => {
        switch (block.blockType) {
          case 'hero':
            return <HeroBlockView key={block.id} block={block} />
          case 'richText':
            return <RichTextBlockView key={block.id} block={block} />
          case 'gallery':
            return <GalleryBlockView key={block.id} block={block} />
          case 'callToAction':
            return <CallToActionBlockView key={block.id} block={block} />
          default:
            return null
        }
      })}
    </div>
  )
}
