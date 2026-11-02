import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config'
import { generateTypes } from '../typegen/generator'

export interface GenerateTypesOptions {
  cwd?: string
  output?: string
}

export async function generateTypesCommand(options: GenerateTypesOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd)
  const typesContent = generateTypes(config)

  const outputPath = options.output ?? 'lontar-types.ts'
  const absolutePath = path.isAbsolute(outputPath) ? outputPath : path.resolve(cwd, outputPath)

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, typesContent, 'utf-8')

  const relative = path.relative(cwd, absolutePath) || path.basename(absolutePath)
  console.log(`Generated types at ${relative}`)
  return absolutePath
}
