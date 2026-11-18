import fs from 'node:fs'
import path from 'node:path'

export function loadEnv(dir: string = path.resolve(import.meta.dirname, '..')): void {
  if (typeof process.loadEnvFile !== 'function') {
    return
  }

  const candidateDirs = [dir]
  if (process.cwd() !== dir && !candidateDirs.includes(process.cwd())) {
    candidateDirs.push(process.cwd())
  }

  for (const candidate of candidateDirs) {
    const localEnv = path.resolve(candidate, '.env.local')
    if (fs.existsSync(localEnv)) {
      try {
        process.loadEnvFile(localEnv)
      } catch {
        // Ignore unreadable or invalid env file
      }
    }

    const defaultEnv = path.resolve(candidate, '.env')
    if (fs.existsSync(defaultEnv)) {
      try {
        process.loadEnvFile(defaultEnv)
      } catch {
        // Ignore unreadable or invalid env file
      }
    }
  }
}

loadEnv()
