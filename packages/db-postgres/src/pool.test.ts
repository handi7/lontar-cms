import { describe, expect, it } from 'vitest'
import { buildPoolConfig } from './adapter'

describe('buildPoolConfig', () => {
  const url = 'postgres://lontar:lontar@127.0.0.1:5432/lontar_test'

  it('sets connectionString and default timezone=UTC when userPool is omitted', () => {
    const config = buildPoolConfig(url)
    expect(config.connectionString).toBe(url)
    expect(config.options).toBe('-c timezone=UTC')
  })

  it('preserves other pool settings and applies default timezone=UTC', () => {
    const config = buildPoolConfig(url, { max: 10, idleTimeoutMillis: 30000 })
    expect(config.connectionString).toBe(url)
    expect(config.max).toBe(10)
    expect(config.idleTimeoutMillis).toBe(30000)
    expect(config.options).toBe('-c timezone=UTC')
  })

  it('merges timezone=UTC with user options when options does not specify timezone', () => {
    const config = buildPoolConfig(url, {
      max: 5,
      options: '-c statement_timeout=5000',
    })
    expect(config.connectionString).toBe(url)
    expect(config.max).toBe(5)
    expect(config.options).toBe('-c timezone=UTC -c statement_timeout=5000')
  })

  it('preserves user options without duplicating timezone=UTC when user specifies timezone', () => {
    const config = buildPoolConfig(url, {
      options: '-c timezone=UTC -c statement_timeout=5000',
    })
    expect(config.options).toBe('-c timezone=UTC -c statement_timeout=5000')
  })

  it('falls back to default timezone=UTC when options is empty or whitespace', () => {
    const config = buildPoolConfig(url, { options: '   ' })
    expect(config.options).toBe('-c timezone=UTC')
  })
})
