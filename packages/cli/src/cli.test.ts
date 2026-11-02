import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { run, VERSION } from './cli'
import { createUser } from './commands/create-user'
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

  it('prints help with --help', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run(['--help'])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Lontar CLI'))
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

describe('loadConfig', () => {
  it('throws when lontar.config.ts is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-empty-'))
    try {
      await expect(loadConfig(emptyDir)).rejects.toThrow('Could not find lontar.config.ts')
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true })
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
})
