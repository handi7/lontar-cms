import type { Fields } from '../fields/types'
import type { GlobalConfig } from './types'

export function global<F extends Fields>(config: GlobalConfig<F>): GlobalConfig<F> {
  return config
}
