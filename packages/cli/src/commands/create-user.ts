import { createLontar, createUserWithCredential } from '@lontar/core'
import { loadConfig } from '../config'
import { closeDb } from '../utils/db'

export interface CreateUserOptions {
  cwd?: string
  email?: string
  password?: string
  name?: string
  envFile?: string
}

export async function createUser(options: CreateUserOptions = {}): Promise<void> {
  const email = options.email?.trim().toLowerCase()
  const password = options.password
  const name = options.name?.trim()

  if (!email || !email.includes('@')) {
    throw new Error('A valid --email argument is required')
  }
  if (!password || password.length < 8) {
    throw new Error('A --password argument with at least 8 characters is required')
  }
  if (!name) {
    throw new Error('A --name argument is required')
  }

  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd, { envFile: options.envFile })

  try {
    const app = createLontar(config)
    const user = await createUserWithCredential(app.auth, { email, password, name })

    console.log(`Created user ${user.email} (${user.name}) [id: ${user.id}]`)
  } finally {
    await closeDb(config.db)
  }
}
