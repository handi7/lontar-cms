import * as React from 'react'
import { cn } from '../lib/utils'

export interface CodeEditorProps {
  id?: string
  value?: string | number
  onChange?: (value: string) => void
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>
  language?: string
  disabled?: boolean
  readOnly?: boolean
  placeholder?: string
  rows?: number
  minLength?: number
  maxLength?: number
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'grammar' | 'spelling'
  'aria-required'?: boolean
}

function handleTabKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  onChange?: (value: string) => void,
): void {
  e.preventDefault()
  const textarea = e.currentTarget
  const { selectionStart, selectionEnd, value } = textarea
  const newValue = value.substring(0, selectionStart) + '  ' + value.substring(selectionEnd)
  onChange?.(newValue)

  // Move cursor after the inserted spaces
  requestAnimationFrame(() => {
    textarea.selectionStart = selectionStart + 2
    textarea.selectionEnd = selectionStart + 2
  })
}

function handleEnterKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  onChange?: (value: string) => void,
): void {
  const textarea = e.currentTarget
  const { selectionStart, value } = textarea
  const currentLine = value.substring(0, selectionStart).split('\n').pop() ?? ''
  const indentMatch = currentLine.match(/^(\s+)/)
  const indent = indentMatch?.[1]
  if (!indent) return

  e.preventDefault()
  const newValue =
    value.substring(0, selectionStart) + '\n' + indent + value.substring(selectionStart)
  onChange?.(newValue)

  requestAnimationFrame(() => {
    textarea.selectionStart = selectionStart + 1 + indent.length
    textarea.selectionEnd = selectionStart + 1 + indent.length
  })
}

export const CodeEditor = React.forwardRef<HTMLTextAreaElement, CodeEditorProps>(
  (props, forwardedRef) => {
    const {
      id,
      value = '',
      onChange,
      onBlur,
      language,
      disabled = false,
      readOnly = false,
      placeholder,
      rows = 6,
      minLength,
      maxLength,
      className,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledby,
      'aria-describedby': ariaDescribedby,
      'aria-invalid': ariaInvalid,
      'aria-required': ariaRequired,
    } = props

    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)
    const gutterRef = React.useRef<HTMLDivElement | null>(null)

    React.useImperativeHandle(forwardedRef, () => innerRef.current!)

    const stringValue = String(value ?? '')

    const lines = React.useMemo(() => {
      const count = stringValue.split('\n').length
      return Math.max(count, rows)
    }, [stringValue, rows])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (disabled || readOnly) return
      if (e.key === 'Tab') {
        handleTabKey(e, onChange)
      } else if (e.key === 'Enter') {
        handleEnterKey(e, onChange)
      }
    }

    const handleScroll = (): void => {
      if (innerRef.current && gutterRef.current) {
        gutterRef.current.scrollTop = innerRef.current.scrollTop
      }
    }

    return (
      <div
        className={cn(
          'lt:flex lt:flex-col lt:overflow-hidden lt:rounded-md lt:border lt:border-input lt:bg-card lt:text-foreground lt:shadow-xs focus-within:lt:ring-1 focus-within:lt:ring-ring focus-within:lt:border-ring',
          disabled && 'lt:cursor-not-allowed lt:opacity-50',
          className,
        )}
      >
        {language ? (
          <div className="lt:flex lt:items-center lt:justify-between lt:border-b lt:border-border lt:bg-muted/40 lt:px-3 lt:py-1.5 lt:text-xs lt:text-muted-foreground">
            <span className="lt:font-mono lt:font-medium">{language.toLowerCase()}</span>
            <span>{stringValue.length} chars</span>
          </div>
        ) : null}

        <div className="lt:relative lt:flex lt:min-h-24 lt:flex-1">
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="lt:select-none lt:overflow-hidden lt:border-r lt:border-border lt:bg-muted/20 lt:px-2.5 lt:py-2 lt:text-right lt:font-mono lt:text-xs lt:text-muted-foreground/60"
          >
            {Array.from({ length: lines }, (_, i) => (
              <div key={i + 1} className="lt:leading-relaxed">
                {i + 1}
              </div>
            ))}
          </div>

          <textarea
            ref={innerRef}
            id={id}
            value={stringValue}
            onChange={(e) => onChange?.(e.target.value)}
            onBlur={onBlur}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            rows={rows}
            minLength={minLength}
            maxLength={maxLength}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-describedby={ariaDescribedby}
            aria-invalid={ariaInvalid}
            aria-required={ariaRequired}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="lt:flex-1 lt:resize-y lt:border-0 lt:bg-transparent lt:p-2 lt:font-mono lt:text-sm lt:leading-relaxed lt:focus:outline-none lt:disabled:cursor-not-allowed"
          />
        </div>
      </div>
    )
  },
)

CodeEditor.displayName = 'CodeEditor'
