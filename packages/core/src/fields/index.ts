import type { NumberField, TextField } from './types'

type Options<F> = Omit<F, 'type'>

/*
 * `const` keeps options like `required: true` as literal types, which is what
 * lets InferDoc tell a required field from a nullable one.
 */
function text<const O extends Options<TextField>>(options?: O): O & { type: 'text' } {
  return { ...(options as O), type: 'text' }
}

function number<const O extends Options<NumberField>>(options?: O): O & { type: 'number' } {
  return { ...(options as O), type: 'number' }
}

export const fields = { text, number }
