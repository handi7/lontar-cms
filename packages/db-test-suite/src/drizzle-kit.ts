import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export function findDrizzleKitBin(): string {
  try {
    const req = createRequire(import.meta.url)
    const main = req.resolve('drizzle-kit')
    const bin = path.join(path.dirname(main), 'bin.cjs')
    if (fs.existsSync(bin)) return bin
  } catch {
    // ignore
  }

  try {
    const cwdReq = createRequire(path.join(process.cwd(), 'noop.js'))
    const main = cwdReq.resolve('drizzle-kit')
    const bin = path.join(path.dirname(main), 'bin.cjs')
    if (fs.existsSync(bin)) return bin
  } catch {
    // ignore
  }

  return 'drizzle-kit'
}
