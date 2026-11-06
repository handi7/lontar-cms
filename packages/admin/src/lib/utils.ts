import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// The admin's utilities are all prefixed (`lt:flex`, docs/adr/0019), and that
// prefix is a variant-like segment, so tailwind-merge reads it as an ordinary
// modifier and still resolves conflicts within a group. utils.test.ts pins that
// behaviour, because a tailwind-merge upgrade that broke it would otherwise
// show up as classes quietly failing to override each other.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
