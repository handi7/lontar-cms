import type { CollectionConfig, Config, DatabaseAdapter, GlobalConfig } from '@lontar/core'

export const postsCollection: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  fields: {
    title: { type: 'text', required: true, maxLength: 120 },
    views: { type: 'number', integer: true, defaultValue: 0 },
    content: { type: 'richText' },
    author: { type: 'relationship', relationTo: 'users' },
    categories: { type: 'relationship', relationTo: 'categories', hasMany: true },
    publishedAt: { type: 'date' },
  },
}

export const categoriesCollection: CollectionConfig = {
  slug: 'categories',
  labels: { singular: 'Category', plural: 'Categories' },
  fields: {
    name: { type: 'text', required: true },
  },
}

export const tagsCollection: CollectionConfig = {
  slug: 'tags',
  labels: { singular: 'Tag', plural: 'Tags' },
  fields: {
    slug: { type: 'slug', unique: true, required: true },
  },
}

export const pagesCollection: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  fields: {
    title: { type: 'text', required: true },
    seo: {
      type: 'group',
      fields: {
        metaTitle: { type: 'text', maxLength: 60 },
        metaDescription: { type: 'textarea' },
      },
    },
    gallery: {
      type: 'array',
      fields: {
        caption: { type: 'text' },
        year: { type: 'number', integer: true },
      },
    },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text', required: true },
            subheading: { type: 'text' },
          },
        },
        {
          slug: 'cta',
          labels: { singular: 'Call to Action', plural: 'Calls to Action' },
          fields: {
            text: { type: 'text', required: true },
            buttonUrl: { type: 'text', required: true },
          },
        },
      ],
    },
  },
}

export const nestedCollection: CollectionConfig = {
  slug: 'nested_docs',
  labels: { singular: 'Nested Doc', plural: 'Nested Docs' },
  fields: {
    title: { type: 'text', required: true },
    seo: {
      type: 'group',
      fields: {
        metaTitle: { type: 'text' },
        featuredPost: { type: 'relationship', relationTo: 'posts' },
      },
    },
    gallery: {
      type: 'array',
      fields: {
        caption: { type: 'text' },
        featuredPost: { type: 'relationship', relationTo: 'posts' },
        tags: {
          type: 'array',
          fields: {
            name: { type: 'text' },
          },
        },
      },
    },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text', required: true },
            featuredPost: { type: 'relationship', relationTo: 'posts' },
          },
        },
        {
          slug: 'cta',
          labels: { singular: 'Call to Action', plural: 'Calls to Action' },
          fields: {
            text: { type: 'text', required: true },
            buttonUrl: { type: 'text', required: true },
            relatedPosts: { type: 'relationship', relationTo: 'posts', hasMany: true },
          },
        },
        {
          slug: 'galleryBlock',
          labels: { singular: 'Gallery Block', plural: 'Gallery Blocks' },
          fields: {
            images: {
              type: 'array',
              fields: {
                caption: { type: 'text' },
              },
            },
          },
        },
      ],
    },
  },
}

export const conditionalPostsCollection: CollectionConfig = {
  slug: 'conditional_posts',
  labels: { singular: 'Conditional Post', plural: 'Conditional Posts' },
  fields: {
    title: { type: 'text', required: true },
    format: {
      type: 'select',
      options: ['standard', 'video'],
      defaultValue: 'standard',
      required: true,
    },
    videoUrl: {
      type: 'text',
      required: true,
      admin: { condition: { format: { equals: 'video' } } },
    },
  },
}

export const sharedBlocksCollection: CollectionConfig = {
  slug: 'shared_blocks_pages',
  labels: { singular: 'Shared Blocks Page', plural: 'Shared Blocks Pages' },
  fields: {
    title: { type: 'text', required: true },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text', required: true },
          },
        },
        {
          slug: 'section',
          labels: { singular: 'Section', plural: 'Sections' },
          fields: {
            heading: { type: 'text', required: true },
          },
        },
      ],
    },
  },
}

export const headerGlobal: GlobalConfig = {
  slug: 'header',
  fields: {
    siteTitle: { type: 'text', required: true, maxLength: 120 },
    announcement: { type: 'text' },
  },
}

export const versionedSettingsGlobal: GlobalConfig = {
  slug: 'versioned_settings',
  access: {
    read: () => true,
    update: () => true,
  },
  versions: { drafts: true, maxPerDoc: 2 },
  fields: {
    siteName: { type: 'text', required: true },
    tagline: { type: 'text' },
  },
}

export const versionedPostsCollection: CollectionConfig = {
  slug: 'versioned_posts',
  labels: { singular: 'Versioned Post', plural: 'Versioned Posts' },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
  },
  versions: { drafts: true, maxPerDoc: 2 },
  fields: {
    title: { type: 'text', required: true },
    content: { type: 'textarea' },
  },
}

export const versionHistoryCollection: CollectionConfig = {
  slug: 'version_history_posts',
  labels: { singular: 'Version History Post', plural: 'Version History Posts' },
  versions: { drafts: true, maxPerDoc: 10 },
  fields: {
    title: { type: 'text', required: true },
    content: { type: 'textarea' },
  },
}

export const longSlugVersionedCollection: CollectionConfig = {
  slug: 'newsletter_campaign_delivery_schedules',
  labels: { singular: 'Schedule', plural: 'Schedules' },
  versions: { drafts: true },
  fields: {
    title: { type: 'text', required: true },
  },
}

export const snippetsCollection: CollectionConfig = {
  slug: 'snippets',
  labels: { singular: 'Snippet', plural: 'Snippets' },
  fields: {
    title: { type: 'text', required: true },
    code: { type: 'code', required: true, language: 'typescript' },
    notes: { type: 'code', defaultValue: '// note' },
    metadata: { type: 'json' },
    status: {
      type: 'radio',
      options: ['draft', 'published', 'archived'],
      defaultValue: 'draft',
      required: true,
    },
    location: { type: 'point' },
    tags: { type: 'text', hasMany: true },
    scores: { type: 'number', hasMany: true, integer: true },
  },
}

export const localizedPostsCollection: CollectionConfig = {
  slug: 'localized_posts',
  labels: { singular: 'Localized Post', plural: 'Localized Posts' },
  fields: {
    title: { type: 'text', required: true, localized: true },
    slug: { type: 'slug', unique: true, required: true, localized: true },
    content: { type: 'richText', localized: true },
    author: { type: 'relationship', relationTo: 'users' },
    categories: { type: 'relationship', relationTo: 'categories', hasMany: true, localized: true },
    seo: {
      type: 'group',
      localized: true,
      fields: {
        metaTitle: { type: 'text' },
        metaDescription: { type: 'textarea' },
      },
    },
    gallery: {
      type: 'array',
      fields: {
        caption: { type: 'text', localized: true },
        year: { type: 'number', integer: true },
      },
    },
    layout: {
      type: 'blocks',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: {
            heading: { type: 'text', required: true, localized: true },
            subheading: { type: 'text' },
          },
        },
      ],
    },
    // A whole localized container: each locale has its own list of blocks.
    sections: {
      type: 'blocks',
      localized: true,
      blocks: [
        { slug: 'hero', fields: { heading: { type: 'text' } } },
        { slug: 'quote', fields: { text: { type: 'text' } } },
      ],
    },
  },
}

export const localizedHeaderGlobal: GlobalConfig = {
  slug: 'localized_header',
  fields: {
    siteTitle: { type: 'text', required: true, localized: true },
    tagline: { type: 'text' },
  },
}

export function createTestConfig(adapter: DatabaseAdapter): Config {
  return {
    secret: 'test-secret',
    db: adapter,
    localization: {
      locales: [
        { code: 'en', label: 'English' },
        { code: 'id', label: 'Bahasa Indonesia' },
      ],
      defaultLocale: 'en',
      fallback: true,
    },
    collections: [
      postsCollection,
      categoriesCollection,
      tagsCollection,
      pagesCollection,
      nestedCollection,
      conditionalPostsCollection,
      sharedBlocksCollection,
      versionedPostsCollection,
      versionHistoryCollection,
      longSlugVersionedCollection,
      localizedPostsCollection,
      snippetsCollection,
    ],
    globals: [headerGlobal, versionedSettingsGlobal, localizedHeaderGlobal],
  }
}
