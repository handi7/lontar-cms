import type { CollapsibleField, Field, Fields, RowField, TabsField } from './types'

export function isLayoutField(field: Field): field is TabsField | RowField | CollapsibleField {
  return field.type === 'tabs' || field.type === 'row' || field.type === 'collapsible'
}

/**
 * Returns a new Fields record where all layout containers (`tabs`, `row`, `collapsible`)
 * have their child fields flattened into the current scope.
 * Nested group, array, and blocks containers also have their subfields flattened recursively.
 */
export function flattenFields(fields: Fields): Fields {
  const result: Fields = {}
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        Object.assign(result, flattenFields(tab.fields))
      }
    } else if (field.type === 'row' || field.type === 'collapsible') {
      Object.assign(result, flattenFields(field.fields))
    } else if (field.type === 'group') {
      result[name] = { ...field, fields: flattenFields(field.fields) }
    } else if (field.type === 'array') {
      result[name] = { ...field, fields: flattenFields(field.fields) }
    } else if (field.type === 'blocks') {
      result[name] = {
        ...field,
        blocks: field.blocks.map((b) => ({ ...b, fields: flattenFields(b.fields) })),
      }
    } else {
      result[name] = field
    }
  }
  return result
}
