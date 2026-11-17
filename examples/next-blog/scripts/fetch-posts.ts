import config from '../lontar.config'
import { createApiKey, createLontar, getUserByEmail, type Auth } from '@lontar/core'

async function resolveApiKey(): Promise<string> {
  const envOrArg = process.env.API_KEY || process.argv[2]
  if (envOrArg) {
    return envOrArg
  }

  // If no API key was provided via env or cli args, generate a temporary one for admin
  console.log(
    'No API_KEY provided in environment or argument. Generating a temporary key for admin@example.com...',
  )
  const app = createLontar(config)
  const auth = (app as unknown as { auth: Auth }).auth
  const admin = await getUserByEmail(auth, 'admin@example.com')
  if (!admin) {
    throw new Error(
      'Admin user admin@example.com not found. Please run "pnpm seed" first or specify API_KEY=<key>.',
    )
  }

  const keyResult = await createApiKey(auth, {
    name: 'Temporary CLI Fetch Key',
    userId: admin.id,
    expiresIn: 3600, // 1 hour
  })
  return keyResult.key
}

interface PostDoc {
  id: number | string
  title?: string
  _status?: string
}

interface PostsResponse {
  docs?: PostDoc[]
  totalDocs?: number
}

function printPosts(json: PostsResponse): void {
  const posts = json.docs ?? []
  console.log(
    `✓ Successfully retrieved ${posts.length} posts (total: ${json.totalDocs ?? posts.length}):`,
  )
  for (const p of posts) {
    console.log(`  - [ID: ${p.id}] ${p.title ?? '(Untitled)'} (${p._status ?? 'unknown'})`)
  }
}

function isConnectionRefused(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  if ('code' in err && (err as { code: string }).code === 'ECONNREFUSED') {
    return true
  }
  if ('cause' in err && typeof (err as { cause?: { code?: string } }).cause === 'object') {
    return (err as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED'
  }
  if (err instanceof Error) {
    return err.message.includes('ECONNREFUSED')
  }
  return false
}

function handleFetchError(err: unknown, baseUrl: string): void {
  if (isConnectionRefused(err)) {
    console.error(
      `\n✗ Could not connect to ${baseUrl}. Make sure the Next.js server is running ('pnpm dev' or 'pnpm start').`,
    )
  } else {
    console.error('\n✗ Error fetching posts:', err)
  }
}

export async function fetchPostsWithApiKey(
  baseUrl = process.env.LONTAR_URL || 'http://localhost:3000',
) {
  const apiKey = await resolveApiKey()
  console.log(`Using API Key: ${apiKey.slice(0, 10)}... (length: ${apiKey.length})`)

  const url = `${baseUrl.replace(/\/$/, '')}/api/posts`
  console.log(`Fetching posts from ${url}...`)

  try {
    const res = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      const errorBody = await res.text()
      console.error(`Request failed with status ${res.status} (${res.statusText}):\n${errorBody}`)
      process.exit(1)
    }

    const json = (await res.json()) as PostsResponse
    printPosts(json)
  } catch (err: unknown) {
    handleFetchError(err, baseUrl)
    process.exit(1)
  }
}

if (process.argv[1]?.endsWith('fetch-posts.ts') || process.argv[1]?.endsWith('fetch-posts.js')) {
  fetchPostsWithApiKey().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
