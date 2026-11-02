import { collection } from '../config/collection'
import { defineConfig } from '../config/define-config'
import type { DatabaseAdapter } from '../database/adapter'
import { fields as f } from '../fields'

/** The M0 walking-skeleton collection: one text and one number field. */
export const Posts = collection({
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'views', 'createdAt'] },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: {
    title: f.text({ required: true, maxLength: 120 }),
    views: f.number({ integer: true, min: 0 }),
  },
})

/** A distinctive value, so a test can assert it never reaches ClientConfig. */
export const SECRET = 'fixture-secret-must-not-leak'

function noDatabase(): never {
  throw new Error('fakeAdapter has no database; this test should not reach it.')
}

export const fakeAdapter: DatabaseAdapter = {
  name: 'fake-adapter',
  find: noDatabase,
  findByID: noDatabase,
  create: noDatabase,
  update: noDatabase,
  delete: noDatabase,
  findGlobal: noDatabase,
  updateGlobal: noDatabase,
  toSchemaFile: noDatabase,
  migrate: noDatabase,
}

export const postsConfig = defineConfig({
  secret: SECRET,
  db: fakeAdapter,
  collections: [Posts],
})
