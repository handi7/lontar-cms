import { collection, defineConfig, fields as f } from '@lontar/core'
import { mysqlAdapter } from '@lontar/db-mysql'

const posts = collection({
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['id', 'title', 'views', 'createdAt'],
  },
  fields: {
    title: f.text({ required: true }),
    views: f.number(),
  },
})

export default defineConfig({
  secret: process.env.LONTAR_SECRET || 'dev-secret-at-least-32-chars-long-12345',
  db: mysqlAdapter({
    url: process.env.DATABASE_URL || 'mysql://lontar:lontar@127.0.0.1:3306/lontar',
  }),
  collections: [posts],
})
