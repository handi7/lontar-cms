import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useTheme, type ThemePreference } from '../context/ThemeContext'

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

// Three toggle buttons rather than a radio group: aria-pressed needs no
// arrow-key handling, and each choice is one click (docs/adr/0020).
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Theme"
      className="lt:flex lt:gap-0.5 lt:rounded-md lt:border lt:p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className="lt:h-7 lt:flex-1 lt:gap-1 lt:px-1 lt:text-xs lt:text-muted-foreground lt:aria-pressed:bg-accent lt:aria-pressed:text-foreground lt:[&_svg]:size-3.5"
        >
          <Icon aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  )
}
