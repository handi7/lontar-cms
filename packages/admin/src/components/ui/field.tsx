// Adapted from shadcn/ui (new-york), trimmed to the three components the admin
// actually renders. Upstream also exports FieldSet, FieldLegend, FieldGroup,
// FieldSeparator, FieldContent, FieldTitle and FieldDescription; those lean on
// container queries, `has-[>[data-slot=…]]` and a Separator dependency, and
// every one of their class strings would have to be hand-prefixed with no
// caller to prove it right.
//
// FieldDescription is left out for a different reason: ClientFieldBase carries
// only name, label and required, so there is no description to render until
// field definitions grow one.
import * as React from 'react'

import { cn } from '../../lib/utils'
import { Label } from './label'

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn(
        'lt:flex lt:w-full lt:flex-col lt:gap-2 lt:data-[invalid=true]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn('lt:flex lt:w-fit lt:gap-1 lt:leading-snug', className)}
      {...props}
    />
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = React.useMemo(() => {
    if (children) return children
    if (!errors) return null

    const messages = errors.filter((error) => error?.message).map((error) => error?.message)
    if (messages.length === 0) return null
    if (messages.length === 1) return messages[0]

    return (
      <ul className="lt:ml-4 lt:flex lt:list-disc lt:flex-col lt:gap-1">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    )
  }, [children, errors])

  if (!content) return null

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn('lt:text-destructive lt:text-sm lt:font-normal', className)}
      {...props}
    >
      {content}
    </div>
  )
}

export { Field, FieldLabel, FieldError }
