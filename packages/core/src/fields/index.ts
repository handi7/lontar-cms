import type { EmailField, NumberField, SlugField, TextareaField, TextField } from './types'

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

function textarea<const O extends Options<TextareaField>>(options?: O): O & { type: 'textarea' } {
  return { ...(options as O), type: 'textarea' }
}

function email<const O extends Options<EmailField>>(options?: O): O & { type: 'email' } {
  return { ...(options as O), type: 'email' }
}

function slug<const O extends Options<SlugField>>(options?: O): O & { type: 'slug' } {
  return { ...(options as O), type: 'slug' }
}

export const fields = { text, number, textarea, email, slug }
