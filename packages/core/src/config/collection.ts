import type { Fields } from '../fields/types'
import type { UploadConfig } from '../storage/image'
import type { CollectionAdmin, CollectionConfig, FieldName } from './types'

/**
 * Returns the config unchanged. It exists to infer `F`, which types InferDoc and
 * makes a typo in `admin.useAsTitle` or `admin.defaultColumns` a compile error.
 */
export function collection<F extends Fields, U extends boolean | UploadConfig = false>(
  config: Omit<CollectionConfig<F>, 'upload' | 'admin'> & {
    upload?: U
    admin?: CollectionAdmin<FieldName<F, U>>
  },
): CollectionConfig<F> & { upload: U } {
  return config as CollectionConfig<F> & { upload: U }
}
