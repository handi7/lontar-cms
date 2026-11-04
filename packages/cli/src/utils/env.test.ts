import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from './env'

describe('loadEnv', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lontar-cli-env-test-'))
  })

  afterEach(() => {
    delete process.env.TEST_LONTAR_KEY_A
    delete process.env.TEST_LONTAR_KEY_B
    delete process.env.TEST_LONTAR_KEY_C
    delete process.env.TEST_LONTAR_KEY_CUSTOM
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('loads .env file in cwd', () => {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'TEST_LONTAR_KEY_A=alpha\nTEST_LONTAR_KEY_B=beta\n',
    )

    loadEnv({ cwd: tempDir })

    expect(process.env.TEST_LONTAR_KEY_A).toBe('alpha')
    expect(process.env.TEST_LONTAR_KEY_B).toBe('beta')
  })

  it('prioritizes .env.local over .env', () => {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'TEST_LONTAR_KEY_A=from_env\nTEST_LONTAR_KEY_B=from_env\n',
    )
    fs.writeFileSync(
      path.join(tempDir, '.env.local'),
      'TEST_LONTAR_KEY_B=from_local\nTEST_LONTAR_KEY_C=from_local\n',
    )

    loadEnv({ cwd: tempDir })

    expect(process.env.TEST_LONTAR_KEY_A).toBe('from_env')
    expect(process.env.TEST_LONTAR_KEY_B).toBe('from_local')
    expect(process.env.TEST_LONTAR_KEY_C).toBe('from_local')
  })

  it('loads custom env file when specified in envFile option', () => {
    fs.writeFileSync(
      path.join(tempDir, 'custom.env'),
      'TEST_LONTAR_KEY_CUSTOM=custom_val\nTEST_LONTAR_KEY_A=custom_a\n',
    )
    fs.writeFileSync(path.join(tempDir, '.env'), 'TEST_LONTAR_KEY_A=from_env\n')

    loadEnv({ cwd: tempDir, envFile: 'custom.env' })

    expect(process.env.TEST_LONTAR_KEY_CUSTOM).toBe('custom_val')
    expect(process.env.TEST_LONTAR_KEY_A).toBe('custom_a')
  })

  it('throws when specified envFile is not found', () => {
    expect(() => loadEnv({ cwd: tempDir, envFile: 'missing.env' })).toThrow('Env file not found at')
  })

  it('does nothing without throwing if no env files exist', () => {
    expect(() => loadEnv({ cwd: tempDir })).not.toThrow()
  })
})
