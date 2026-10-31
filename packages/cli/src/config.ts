import fs from 'node:fs'
import path from 'node:path'
import { createJiti } from 'jiti'
import type { Config } from '@lontar/core'

function extractConfig(mod: unknown): Config | null {
  if (typeof mod !== 'object' || mod === null) return null
  if ('default' in mod && typeof mod.default === 'object' && mod.default !== null) {
    return mod.default as Config
  }
  return mod as Config
}

export async function loadConfig(cwd: string): Promise<Config> {
  const possiblePaths = [
    path.resolve(cwd, 'lontar.config.ts'),
    path.resolve(cwd, 'lontar.config.js'),
    path.resolve(cwd, 'lontar.config.mjs'),
  ]

  const configPath = possiblePaths.find((p) => fs.existsSync(p))
  if (!configPath) {
    throw new Error(
      `Could not find lontar.config.ts in ${cwd}. Make sure the config file exists in your project root.`,
    )
  }

  const jiti = createJiti(cwd)
  const mod: unknown = await jiti.import(configPath)
  const config = extractConfig(mod)

  if (!config) {
    throw new Error(`Config file at ${configPath} did not export a valid config object.`)
  }

  if (!config.db) {
    throw new Error(`Config file at ${configPath} does not have a database adapter configured.`)
  }

  return config
}
