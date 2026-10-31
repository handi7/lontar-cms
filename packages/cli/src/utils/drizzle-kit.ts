import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export function findDrizzleKitBin(cwd: string): string {
  try {
    const cwdReq = createRequire(path.join(cwd, 'noop.js'))
    const main = cwdReq.resolve('drizzle-kit')
    const bin = path.join(path.dirname(main), 'bin.cjs')
    if (fs.existsSync(bin)) return bin
  } catch {
    // ignore
  }

  try {
    const cliReq = createRequire(import.meta.url)
    const main = cliReq.resolve('drizzle-kit')
    const bin = path.join(path.dirname(main), 'bin.cjs')
    if (fs.existsSync(bin)) return bin
  } catch {
    // ignore
  }

  return 'drizzle-kit'
}
