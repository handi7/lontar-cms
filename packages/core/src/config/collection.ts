import type { Fields } from '../fields/types'
import type { CollectionAdmin, CollectionConfig, FieldName } from './types'

/**
 * Returns the config unchanged. It exists to infer `F`, which types InferDoc and
 * makes a typo in `admin.useAsTitle` or `admin.defaultColumns` a compile error.
 */
export function collection<F extends Fields>(
  config: CollectionConfig<F> & { admin?: CollectionAdmin<FieldName<F>> },
): CollectionConfig<F> {
  return config
}
