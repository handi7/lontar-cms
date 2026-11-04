import fs from 'node:fs'
import path from 'node:path'

export interface LoadEnvOptions {
  cwd?: string
  envFile?: string
}

export function loadEnv(options: LoadEnvOptions = {}): void {
  if (typeof process.loadEnvFile !== 'function') {
    return
  }

  const cwd = options.cwd ?? process.cwd()

  if (options.envFile) {
    const customPath = path.isAbsolute(options.envFile)
      ? options.envFile
      : path.resolve(cwd, options.envFile)
    if (!fs.existsSync(customPath)) {
      throw new Error(`Env file not found at ${customPath}`)
    }
    process.loadEnvFile(customPath)
  }

  const localEnv = path.resolve(cwd, '.env.local')
  if (fs.existsSync(localEnv)) {
    process.loadEnvFile(localEnv)
  }

  const defaultEnv = path.resolve(cwd, '.env')
  if (fs.existsSync(defaultEnv)) {
    process.loadEnvFile(defaultEnv)
  }
}
