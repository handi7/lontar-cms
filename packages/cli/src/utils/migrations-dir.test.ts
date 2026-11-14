import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveMigrationsDir } from './migrations-dir'

describe('resolveMigrationsDir', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-migrations-dir-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses explicitDir if provided', () => {
    const result = resolveMigrationsDir(tempDir, { name: 'mysql' }, 'custom/migrations')
    expect(result).toBe(path.resolve(tempDir, 'custom/migrations'))
  })

  it('defaults to migrations/ when no dialect subdirectories exist', () => {
    const result = resolveMigrationsDir(tempDir, { name: 'mysql' })
    expect(result).toBe(path.resolve(tempDir, 'migrations'))
  })

  it('selects migrations/<name> if it exists', () => {
    const mysqlDir = path.join(tempDir, 'migrations', 'mysql')
    fs.mkdirSync(mysqlDir, { recursive: true })

    const result = resolveMigrationsDir(tempDir, { name: 'mysql' })
    expect(result).toBe(mysqlDir)
  })

  it('selects migrations/<dialect> if it exists and name does not', () => {
    const pgDir = path.join(tempDir, 'migrations', 'postgresql')
    fs.mkdirSync(pgDir, { recursive: true })

    const result = resolveMigrationsDir(tempDir, { name: 'postgres', dialect: 'postgresql' })
    expect(result).toBe(pgDir)
  })

  it('prefers explicitDir over existing subdirectories', () => {
    const mysqlDir = path.join(tempDir, 'migrations', 'mysql')
    fs.mkdirSync(mysqlDir, { recursive: true })

    const result = resolveMigrationsDir(tempDir, { name: 'mysql' }, 'explicit/dir')
    expect(result).toBe(path.resolve(tempDir, 'explicit/dir'))
  })
})
