import './env'
import config from '../lontar.config'
import {
  createApiKey,
  createLontar,
  createUserWithCredential,
  getUserByEmail,
  listApiKeys,
  updateUser,
  type Auth,
} from '@lontar/core'

export const SEED_USERS = [
  {
    name: 'Admin User',
    email: 'admin@example.com',
    password: 'password123',
    role: 'admin',
  },
  {
    name: 'Editor User',
    email: 'editor@example.com',
    password: 'password123',
    role: 'editor',
  },
  {
    name: 'Author User',
    email: 'author@example.com',
    password: 'password123',
    role: 'author',
  },
] as const

async function ensureUser(auth: Auth, user: (typeof SEED_USERS)[number]): Promise<{ id: string }> {
  const existing = await getUserByEmail(auth, user.email)
  if (!existing) {
    const created = await createUserWithCredential(auth, {
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
    })
    console.log(`✓ Created user ${user.email} (${user.role})`)
    return { id: created.id }
  }
  if (existing.role !== user.role) {
    await updateUser(auth, existing.id, { role: user.role })
    console.log(`✓ Updated user ${user.email} role from ${existing.role} to ${user.role}`)
  } else {
    console.log(`• User ${user.email} already exists (${existing.role})`)
  }
  return { id: existing.id }
}

async function ensureSeedApiKey(auth: Auth, adminUserId: string): Promise<string | undefined> {
  try {
    const existingKeys = await listApiKeys(auth, adminUserId)
    const existingSeedKey = existingKeys.find((k) => k.name === 'Seed Demonstration API Key')
    if (existingSeedKey) {
      console.log(`• Demonstration API Key already exists (${existingSeedKey.start}...)`)
      return undefined
    }

    const keyResult = await createApiKey(auth, {
      name: 'Seed Demonstration API Key',
      userId: adminUserId,
    })
    console.log(`✓ Created demonstration API Key: ${keyResult.key}`)
    return keyResult.key
  } catch (err) {
    console.warn('Could not generate demonstration API key:', err)
    return undefined
  }
}

export async function seedUsers(): Promise<{ apiKey?: string }> {
  console.log(
    'Notice: Seed accounts (e.g. admin@example.com / password123) are intended for development and testing only.\n',
  )
  const app = createLontar(config)
  const auth = (app as unknown as { auth: Auth }).auth

  let adminUserId: string | null = null

  for (const user of SEED_USERS) {
    const { id } = await ensureUser(auth, user)
    if (user.role === 'admin') {
      adminUserId = id
    }
  }

  const apiKey = adminUserId ? await ensureSeedApiKey(auth, adminUserId) : undefined
  return { apiKey }
}

// When executed directly via `pnpm seed`
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedUsers()
    .then(({ apiKey }) => {
      console.log('\nSeed completed successfully.')
      if (apiKey) {
        console.log(`You can test the API key with:\n  API_KEY="${apiKey}" pnpm fetch:posts\n`)
      }
      process.exit(0)
    })
    .catch((err) => {
      console.error('Seed failed:', err)
      process.exit(1)
    })
}
