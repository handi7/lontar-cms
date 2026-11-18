import { describe, expect, it } from 'vitest'
import { fields as f } from '../fields'
import { evalFieldsPermissions } from './permissions'

describe('evalFieldsPermissions siblingData', () => {
  const fields = {
    locked: f.checkbox(),
    meta: f.group({
      fields: {
        note: f.text({
          access: {
            update: ({ siblingData }) =>
              (siblingData as { locked?: boolean } | undefined)?.locked !== true,
          },
        }),
        locked: f.checkbox(),
      },
    }),
  }

  it('passes the group data, not the root document, to subfield access functions', async () => {
    // Root `locked` is true, group `locked` is false: the subfield must follow the group.
    const doc = { locked: true, meta: { locked: false, note: 'x' } }
    const perms = await evalFieldsPermissions(fields, { user: null, doc, data: doc })
    expect(perms['meta.note']?.update).toBe(true)
  })

  it('denies when the group data says locked, even if the root does not', async () => {
    const doc = { locked: false, meta: { locked: true, note: 'x' } }
    const perms = await evalFieldsPermissions(fields, { user: null, doc, data: doc })
    expect(perms['meta.note']?.update).toBe(false)
  })

  it('passes an empty object when the group has no data yet', async () => {
    const doc = { locked: true }
    const perms = await evalFieldsPermissions(fields, { user: null, doc, data: doc })
    expect(perms['meta.note']?.update).toBe(true)
  })
})
