import './env'
import config from '../lontar.config'
import { getLontar } from '@lontar/core'

async function main() {
  console.log('Connecting to Lontar client...')
  const client = await getLontar(config)

  console.log('Updating post with explicit slugs...')
  await client.update('posts', 1, {
    data: {
      title: 'Exploring Lontar CMS with MySQL on Coolify',
      slug: 'exploring-lontar-cms',
      excerpt:
        'A real-time test of multi-locale content powered by Lontar CMS and MySQL over Docker network.',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Welcome to Lontar CMS! This post demonstrates multi-locale functionality running smoothly on Next.js and MySQL in Coolify.',
              },
            ],
          },
        ],
      },
    },
    locale: 'en',
    overrideAccess: true,
  })

  await client.update('posts', 1, {
    data: {
      title: 'Eksplorasi Lontar CMS dengan MySQL di Coolify',
      slug: 'eksplorasi-lontar-cms',
      excerpt:
        'Uji coba konten multi-bahasa secara real-time ditenagai Lontar CMS dan MySQL melalui jaringan Docker.',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Selamat datang di Lontar CMS! Postingan ini membuktikan fungsionalitas multi-bahasa berjalan lancar di Next.js dan MySQL di Coolify.',
              },
            ],
          },
        ],
      },
    },
    locale: 'id',
    overrideAccess: true,
  })

  console.log('Publishing post...')
  await client.publish('posts', 1, { overrideAccess: true })

  console.log('Verifying published post in both locales...')
  const enDoc = await client.findByID('posts', 1, { locale: 'en' })
  const idDoc = await client.findByID('posts', 1, { locale: 'id' })

  console.log('\n--- English (en) ---')
  console.log(`Title: ${enDoc?.title}`)
  console.log(`Slug: ${enDoc?.slug}`)
  console.log(`Status: ${enDoc?._status}`)

  console.log('\n--- Indonesian (id) ---')
  console.log(`Title: ${idDoc?.title}`)
  console.log(`Slug: ${idDoc?.slug}`)
  console.log(`Status: ${idDoc?._status}`)

  console.log('\n✓ Post updated and published successfully!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
