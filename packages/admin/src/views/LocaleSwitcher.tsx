import { Languages } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'

export interface LocaleSwitcherProps {
  locales: Array<{ code: string; label: string }>
  activeLocale: string
  onLocaleChange: (locale: string) => void
  disabled?: boolean
}

export function LocaleSwitcher({
  locales,
  activeLocale,
  onLocaleChange,
  disabled,
}: LocaleSwitcherProps) {
  if (!locales || locales.length <= 1) return null

  return (
    <div className="lt:flex lt:items-center lt:gap-2">
      <Select value={activeLocale} onValueChange={onLocaleChange} disabled={disabled}>
        <SelectTrigger
          aria-label="Select locale"
          data-testid="locale-switcher"
          className="lt:h-9 lt:min-w-[130px] lt:gap-2 lt:bg-card lt:border-border lt:text-foreground"
        >
          <Languages className="lt:size-4 lt:text-muted-foreground" aria-hidden="true" />
          <SelectValue placeholder="Select locale" />
        </SelectTrigger>
        <SelectContent>
          {locales.map((loc) => (
            <SelectItem key={loc.code} value={loc.code} data-testid={`locale-option-${loc.code}`}>
              {loc.label} ({loc.code})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
