import {
  countTotalUsers,
  createLontar,
  createUserWithCredential,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@lontar/core'
import { loadConfig } from '../config'
import { closeDb } from '../utils/db'

export interface CreateUserOptions {
  cwd?: string
  email?: string
  password?: string
  name?: string
  role?: string
  envFile?: string
}

function resolveUserRole(
  requestedRole: string | undefined,
  allowedRoles: readonly string[],
  totalUsers: number,
  adminRole: string,
  defaultRole: string,
): string {
  if (requestedRole) {
    const role = requestedRole.trim()
    if (!allowedRoles.includes(role)) {
      throw new Error(`Unknown role "${role}". Permitted roles: ${allowedRoles.join(', ')}`)
    }
    return role
  }
  return totalUsers === 0 ? adminRole : defaultRole
}

function validateUserInput(options: CreateUserOptions): {
  email: string
  password: string
  name: string
} {
  const email = options.email?.trim().toLowerCase()
  const password = options.password
  const name = options.name?.trim()

  if (!email || !email.includes('@')) {
    throw new Error('A valid --email argument is required')
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('A --password argument with at least 8 characters is required')
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`A --password argument cannot exceed ${MAX_PASSWORD_LENGTH} characters`)
  }
  if (!name) {
    throw new Error('A --name argument is required')
  }

  return { email, password, name }
}

async function determineRole(
  app: ReturnType<typeof createLontar>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  requestedRole?: string,
): Promise<string> {
  const allowedRoles = config.auth?.roles ?? ['admin', 'editor']
  const adminRole = config.auth?.adminRole ?? 'admin'
  const defaultRole = config.auth?.defaultRole ?? 'editor'
  const totalUsers = await countTotalUsers(app.auth)
  return resolveUserRole(requestedRole, allowedRoles, totalUsers, adminRole, defaultRole)
}

export async function createUser(options: CreateUserOptions = {}): Promise<void> {
  const { email, password, name } = validateUserInput(options)
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd, { envFile: options.envFile })

  try {
    const app = createLontar(config)
    const role = await determineRole(app, config, options.role)
    const user = await createUserWithCredential(app.auth, {
      email,
      password,
      name,
      role,
      emailVerified: true,
    })

    console.log(`Created user ${user.email} (${user.name}) [role: ${user.role}, id: ${user.id}]`)
  } finally {
    await closeDb(config.db)
  }
}
