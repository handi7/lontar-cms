import type { ReactNode } from 'react'
import { Card } from '../components/ui/card'

// Centred card for loading, empty and not-found states.
export interface EmptyCardProps {
  children: ReactNode
}

export function EmptyCard({ children }: EmptyCardProps) {
  return <Card className="lt:block lt:px-8 lt:py-12 lt:text-center lt:shadow-none">{children}</Card>
}
