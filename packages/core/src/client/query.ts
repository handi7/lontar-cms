export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'in'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_equal'
  | 'less_than_equal'

export type FilterPrimitive = string | number | boolean | Date | null

export type FilterValue = FilterPrimitive | FilterPrimitive[]

export type FieldFilter = {
  [K in FilterOperator]?: FilterValue
}

export type WhereField = FieldFilter | FilterValue

export interface Where {
  [field: string]: WhereField | Where[] | undefined
  and?: Where[]
  or?: Where[]
}

export type WhereClause = Where

export interface SortItem {
  field: string
  direction: 'asc' | 'desc'
}
