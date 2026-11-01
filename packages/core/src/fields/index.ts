import type {
  CheckboxField,
  DateField,
  EmailField,
  NumberField,
  RelationshipField,
  RichTextField,
  SelectField,
  SlugField,
  TextareaField,
  TextField,
  UploadField,
} from './types'

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

function checkbox<const O extends Options<CheckboxField>>(options?: O): O & { type: 'checkbox' } {
  return { ...(options as O), type: 'checkbox' }
}

function select<const O extends Options<SelectField>>(options: O): O & { type: 'select' } {
  return { ...options, type: 'select' }
}

function date<const O extends Options<DateField>>(options?: O): O & { type: 'date' } {
  return { ...(options as O), type: 'date' }
}

function richText<const O extends Options<RichTextField>>(options?: O): O & { type: 'richText' } {
  return { ...(options as O), type: 'richText' }
}

function relationship<const O extends Options<RelationshipField>>(
  options: O,
): O & { type: 'relationship' } {
  if (!options?.relationTo) {
    throw new Error('Relationship field requires a "relationTo" collection slug')
  }
  return { ...options, type: 'relationship' }
}

function upload<const O extends Options<UploadField>>(options: O): O & { type: 'upload' } {
  if (!options?.relationTo) {
    throw new Error('Upload field requires a "relationTo" collection slug')
  }
  return { ...options, type: 'upload' }
}

export const fields = {
  text,
  number,
  textarea,
  email,
  slug,
  checkbox,
  select,
  date,
  richText,
  relationship,
  upload,
}
