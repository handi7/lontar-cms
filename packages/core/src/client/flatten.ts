import type {
  ClientCollapsibleField,
  ClientField,
  ClientRowField,
  ClientTabsField,
} from './client-config'
import type { FieldCondition } from './condition'

export function isClientLayoutField(
  field: ClientField,
): field is ClientTabsField | ClientRowField | ClientCollapsibleField {
  return field.type === 'tabs' || field.type === 'row' || field.type === 'collapsible'
}

function combineCondition(
  parent?: FieldCondition,
  child?: FieldCondition,
): FieldCondition | undefined {
  if (!parent) return child
  if (!child) return parent
  return { and: [parent, child] }
}

function flattenClientFieldEntry(
  field: ClientField,
  parentCondition?: FieldCondition,
): ClientField[] {
  if (field.type === 'tabs') {
    const tabsCond = combineCondition(parentCondition, field.condition)
    return field.tabs.flatMap((tab) =>
      flattenClientFields(
        tab.fields,
        combineCondition(tabsCond, tab.condition ?? tab.admin?.condition),
      ),
    )
  }
  if (field.type === 'row' || field.type === 'collapsible') {
    return flattenClientFields(field.fields, combineCondition(parentCondition, field.condition))
  }
  const condition = combineCondition(parentCondition, field.condition)
  if (field.type === 'group' || field.type === 'array') {
    return [{ ...field, condition, fields: flattenClientFields(field.fields) }]
  }
  if (field.type === 'blocks') {
    return [
      {
        ...field,
        condition,
        blocks: field.blocks.map((b) => ({ ...b, fields: flattenClientFields(b.fields) })),
      },
    ]
  }
  return [{ ...field, condition }]
}

/**
 * Flattens layout containers (`tabs`, `row`, `collapsible`) into their enclosing
 * data scope while combining any container conditions onto child fields.
 */
export function flattenClientFields(
  fields: readonly ClientField[],
  parentCondition?: FieldCondition,
): ClientField[] {
  return fields.flatMap((field) => flattenClientFieldEntry(field, parentCondition))
}
