import type { ClientCollection } from '@lontar/core/client'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { getColumnLabel } from './columns'
import type { ColumnPreference } from './useColumnPreference'

export interface ColumnPickerProps {
  collection: ClientCollection
  preference: ColumnPreference
}

export function ColumnPicker({ collection, preference }: ColumnPickerProps) {
  const { keys, selectable, titleKey, isCustomized, toggle, reset } = preference
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="lt:w-60" aria-label="Choose columns">
        <ul className="lt:m-0 lt:flex lt:list-none lt:flex-col lt:gap-2 lt:p-0">
          {selectable.map((key) => {
            const label = getColumnLabel(key, collection)
            const isTitle = key === titleKey
            return (
              <li key={key} className="lt:flex lt:items-center lt:gap-2.5">
                <Checkbox
                  id={`column-${key}`}
                  checked={keys.includes(key)}
                  disabled={isTitle}
                  onCheckedChange={(checked) => toggle(key, checked === true)}
                />
                <label htmlFor={`column-${key}`} className="lt:text-sm">
                  {label}
                  {isTitle && <span className="lt:text-muted-foreground"> (always shown)</span>}
                </label>
              </li>
            )
          })}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="lt:mt-3 lt:w-full"
          disabled={!isCustomized}
          onClick={reset}
        >
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  )
}
