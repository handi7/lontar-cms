import { forwardRef, type ComponentProps } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Calendar } from '../components/ui/calendar'
import { Input } from '../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { cn } from '../lib/utils'

// The value is the same local wall-clock string the <input type="datetime-local">
// this replaced used to hold: 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DDTHH:mm:ss', or ''
// for no date. formatDateForInput produces it and formatDateForSubmit turns it
// into a UTC ISO string (ADR 0010); this component only ever edits the string,
// so neither the load nor the submit path changes.

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/

interface LocalDateTime {
  day: string
  time: string
  date: Date
}

function parseLocal(value: string): LocalDateTime | null {
  const match = LOCAL_DATETIME.exec(value)
  if (!match) return null
  const [, y, m, d, time] = match
  // A local date at midnight, which is what the calendar compares days with.
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return { day: `${y}-${m}-${d}`, time: time ?? '00:00', date }
}

function toDayString(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDisplay(parsed: LocalDateTime): string {
  const [h = 0, min = 0, s] = parsed.time.split(':').map(Number)
  const at = new Date(parsed.date)
  at.setHours(h, min, s ?? 0)
  return at.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: s === undefined ? 'short' : 'medium',
  })
}

export interface DateTimePickerProps extends Omit<
  ComponentProps<typeof Button>,
  'value' | 'onChange'
> {
  value: string
  onChange: (value: string) => void
  /** Offers a Clear action; a required field has nothing to clear to. */
  clearable?: boolean
}

export const DateTimePicker = forwardRef<HTMLButtonElement, DateTimePickerProps>(
  ({ value, onChange, clearable, disabled, className, ...triggerProps }, ref) => {
    const parsed = parseLocal(value)

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              'lt:w-full lt:justify-start lt:font-normal lt:shadow-xs',
              !parsed && 'lt:text-muted-foreground',
              className,
            )}
            {...triggerProps}
          >
            <CalendarIcon className="lt:opacity-60" />
            {parsed ? formatDisplay(parsed) : 'Pick a date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="lt:w-auto lt:p-0">
          <Calendar
            mode="single"
            selected={parsed?.date}
            defaultMonth={parsed?.date}
            onSelect={(day) => {
              // Clicking the selected day again deselects it in DayPicker;
              // clearing is the Clear button's job, so that is ignored.
              if (!day) return
              onChange(`${toDayString(day)}T${parsed?.time ?? '00:00'}`)
            }}
          />
          <div className="lt:flex lt:items-center lt:gap-2 lt:border-t lt:p-3">
            <Input
              type="time"
              step="1"
              aria-label="Time"
              className="lt:h-8"
              value={parsed?.time ?? ''}
              disabled={!parsed}
              onChange={(e) => {
                // An emptied time input keeps the stored time rather than
                // producing an unparseable 'YYYY-MM-DDT'.
                if (!parsed || !e.target.value) return
                onChange(`${parsed.day}T${e.target.value}`)
              }}
            />
            {clearable && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!parsed}
                onClick={() => onChange('')}
              >
                Clear
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    )
  },
)
DateTimePicker.displayName = 'DateTimePicker'
