import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isMainModule, parseGlobalFlags, run, VERSION } from './cli'
import { createUser } from './commands/create-user'
import { generateTypesCommand } from './commands/generate-types'
import { migrate } from './commands/migrate'
import { migrateCreate } from './commands/migrate-create'
import { loadConfig } from './config'

describe('CLI run', () => {
  it('prints version with --version', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run(['--version'])
    expect(consoleSpy).toHaveBeenCalledWith(`v${VERSION}`)
    consoleSpy.mockRestore()
  })

  it('reports the version from package.json', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })

  it('prints help with --help', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run(['--help'])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Lontar CLI'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('generate:types'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--env-file'))
    consoleSpy.mockRestore()
  })

  it('reports error on unknown command', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run(['unknown-cmd'])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command: unknown-cmd'))
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
    errorSpy.mockRestore()
    logSpy.mockRestore()
  })
})

describe('isMainModule (Windows & Unix support)', () => {
  it('returns true when argv1 file URL matches metaUrl', () => {
    expect(isMainModule('/project/dist/cli.js', 'file:///project/dist/cli.js')).toBe(true)
  })

  it('returns true for Unix paths ending in /cli.js or /cli.ts', () => {
    expect(isMainModule('/Users/handiani/lontar/packages/cli/dist/cli.js', 'file:///other')).toBe(
      true,
    )
    expect(isMainModule('/Users/handiani/lontar/packages/cli/src/cli.ts', 'file:///other')).toBe(
      true,
    )
  })

  it('returns true for Windows paths with backslashes ending in \\cli.js or \\cli.ts', () => {
    expect(
      isMainModule('C:\\Users\\handiani\\lontar\\packages\\cli\\dist\\cli.js', 'file:///other'),
    ).toBe(true)
    expect(
      isMainModule('C:\\Users\\handiani\\lontar\\packages\\cli\\src\\cli.ts', 'file:///other'),
    ).toBe(true)
  })

  it('returns false when argv1 is undefined or does not match cli entry', () => {
    expect(isMainModule(undefined, 'file:///other')).toBe(false)
    expect(isMainModule('/path/to/worker.js', 'file:///other')).toBe(false)
    expect(isMainModule('C:\\path\\to\\other.js', 'file:///other')).toBe(false)
  })
})

describe('parseGlobalFlags', () => {
  it('extracts --env-file with separate argument', () => {
    const result = parseGlobalFlags(['migrate', '--env-file', 'custom.env', '--foo'])
    expect(result.envFile).toBe('custom.env')
    expect(result.cleanArgv).toEqual(['migrate', '--foo'])
  })

  it('extracts --env-file with = syntax', () => {
    const result = parseGlobalFlags(['--env-file=.env.staging', 'generate:types'])
    expect(result.envFile).toBe('.env.staging')
    expect(result.cleanArgv).toEqual(['generate:types'])
  })

  it('throws error when --env-file is missing a value', () => {
    expect(() => parseGlobalFlags(['migrate', '--env-file'])).toThrow(
      'A path argument is required for --env-file',
    )
    expect(() => parseGlobalFlags(['migrate', '--env-file='])).toThrow(
      'A path argument is required for --env-file',
    )
  })
})

describe('loadConfig', () => {
  it('throws when lontar.config.ts is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-empty-'))
    try {
      await expect(loadConfig(emptyDir)).rejects.toThrow('Could not find lontar.config.ts')
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('loads .env so config can read process.env', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-env-config-'))
    try {
      fs.writeFileSync(path.join(tempDir, '.env'), 'CLI_TEST_SECRET=super-secret-loaded-from-env\n')
      fs.writeFileSync(
        path.join(tempDir, 'lontar.config.js'),
        `
        export default {
          secret: process.env.CLI_TEST_SECRET,
          db: { name: 'mysql' },
          collections: [],
        }
      `,
      )

      const config = await loadConfig(tempDir)
      expect(config.secret).toBe('super-secret-loaded-from-env')
    } finally {
      delete process.env.CLI_TEST_SECRET
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('supports custom env file via options', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-env-custom-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'staging.env'),
        'CLI_TEST_STAGING_KEY=staging-secret-key\n',
      )
      fs.writeFileSync(
        path.join(tempDir, 'lontar.config.js'),
        `
        export default {
          secret: process.env.CLI_TEST_STAGING_KEY,
          db: { name: 'mysql' },
          collections: [],
        }
      `,
      )

      const config = await loadConfig(tempDir, { envFile: 'staging.env' })
      expect(config.secret).toBe('staging-secret-key')
    } finally {
      delete process.env.CLI_TEST_STAGING_KEY
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('migrateCreate & migrate', () => {
  it('writes schema.ts and calls toSchemaFile and migrate', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-test-'))
    try {
      const configFile = path.join(tempDir, 'lontar.config.js')
      fs.writeFileSync(
        configFile,
        `
        export default {
          secret: 'test',
          db: {
            name: 'mysql',
            toSchemaFile: () => 'export const mock = {}',
            migrate: async () => {},
          },
          collections: [],
        }
      `,
      )

      await migrateCreate({ cwd: tempDir })

      const writtenSchema = path.join(tempDir, '.lontar', 'schema.ts')
      expect(fs.existsSync(writtenSchema)).toBe(true)
      expect(fs.readFileSync(writtenSchema, 'utf-8')).toBe('export const mock = {}')

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      await migrate({ cwd: tempDir })
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migrations applied successfully.'),
      )
      logSpy.mockRestore()
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('generates migration when schema imports drizzle-orm via absolute path (pnpm non-hoisted support)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-pnpm-test-'))
    try {
      const configFile = path.join(tempDir, 'lontar.config.js')
      const { createRequire } = await import('node:module')
      const req = createRequire(import.meta.url)
      const ormPath = req.resolve('drizzle-orm/mysql-core').replace(/\\/g, '/')

      fs.writeFileSync(
        configFile,
        `
        export default {
          secret: 'test',
          db: {
            name: 'mysql',
            toSchemaFile: () => \`import { mysqlTable, serial, varchar } from '${ormPath}'
export const items = mysqlTable('items', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
})
\`,
            migrate: async () => {},
          },
          collections: [],
        }
      `,
      )

      await migrateCreate({ cwd: tempDir })

      const migrationsDir = path.join(tempDir, 'migrations')
      expect(fs.existsSync(migrationsDir)).toBe(true)
      const migrationFiles = fs.readdirSync(migrationsDir)
      expect(migrationFiles.some((f) => f.endsWith('.sql'))).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('reports when migrations directory is missing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-no-mig-'))
    try {
      const configFile = path.join(tempDir, 'lontar.config.js')
      fs.writeFileSync(
        configFile,
        `
        export default {
          secret: 'test',
          db: {
            name: 'mysql',
            toSchemaFile: () => '',
            migrate: async () => {},
          },
          collections: [],
        }
      `,
      )

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      await migrate({ cwd: tempDir })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No migrations directory found'))
      logSpy.mockRestore()
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('calls close on db adapter when migrate succeeds and when it fails', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-mig-close-'))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const migrationsDir = path.join(tempDir, 'migrations')
      fs.mkdirSync(migrationsDir, { recursive: true })

      const closeSpy = vi.fn().mockResolvedValue(undefined)
      const migrateSpy = vi.fn().mockResolvedValue(undefined)

      const configFile = path.join(tempDir, 'lontar.config.js')
      fs.writeFileSync(
        configFile,
        `
        export default {
          secret: 'test',
          db: {
            name: 'mysql',
            migrate: globalThis.__testMigrate,
            close: globalThis.__testClose,
          },
          collections: [],
        }
      `,
      )

      ;(globalThis as Record<string, unknown>).__testMigrate = migrateSpy
      ;(globalThis as Record<string, unknown>).__testClose = closeSpy

      await migrate({ cwd: tempDir })
      expect(migrateSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy).toHaveBeenCalledTimes(1)

      // When migrate throws, close() is still called
      migrateSpy.mockRejectedValueOnce(new Error('Migration failed'))
      await expect(migrate({ cwd: tempDir })).rejects.toThrow('Migration failed')
      expect(closeSpy).toHaveBeenCalledTimes(2)
    } finally {
      logSpy?.mockRestore()
      delete (globalThis as Record<string, unknown>).__testMigrate
      delete (globalThis as Record<string, unknown>).__testClose
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('createUser', () => {
    it('validates email, password, and name options', async () => {
      await expect(createUser({ email: 'invalid', password: '123' })).rejects.toThrow(
        'A valid --email argument is required',
      )
      await expect(createUser({ email: 'admin@example.com', password: 'short' })).rejects.toThrow(
        'A --password argument with at least 8 characters is required',
      )
      await expect(
        createUser({ email: 'admin@example.com', password: 'password123', name: '' }),
      ).rejects.toThrow('A --name argument is required')
    })
  })

  describe('generateTypesCommand', () => {
    it('generates types to default lontar-types.ts', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-gen-types-'))
      try {
        const configFile = path.join(tempDir, 'lontar.config.js')
        fs.writeFileSync(
          configFile,
          `
          export default {
            secret: 'test',
            db: { name: 'mysql' },
            collections: [
              {
                slug: 'posts',
                fields: {
                  title: { type: 'text', required: true },
                },
              },
            ],
          }
        `,
        )

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        await generateTypesCommand({ cwd: tempDir })
        const defaultOutput = path.join(tempDir, 'lontar-types.ts')
        expect(fs.existsSync(defaultOutput)).toBe(true)
        const content = fs.readFileSync(defaultOutput, 'utf-8')
        expect(content).toContain('export interface Post {')
        expect(content).toContain('  title: string')
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('Generated types at lontar-types.ts'),
        )
        logSpy.mockRestore()
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('generates types to custom output path when specified', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-gen-types-custom-'))
      try {
        const configFile = path.join(tempDir, 'lontar.config.js')
        fs.writeFileSync(
          configFile,
          `
          export default {
            secret: 'test',
            db: { name: 'mysql' },
            collections: [],
          }
        `,
        )

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        await generateTypesCommand({ cwd: tempDir, output: 'src/types/schema.ts' })
        const customOutput = path.join(tempDir, 'src', 'types', 'schema.ts')
        expect(fs.existsSync(customOutput)).toBe(true)
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('Generated types at src/types/schema.ts'),
        )
        logSpy.mockRestore()
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
