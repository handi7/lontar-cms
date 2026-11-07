import { Link } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import { EmptyCard } from './EmptyCard'

export function NotFoundView() {
  return (
    <EmptyCard>
      <h2 className="lt:mt-0">Page Not Found</h2>
      <p className="lt:mt-0 lt:mb-5 lt:text-muted-foreground">
        The requested page or collection does not exist.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Return to Dashboard</Link>
      </Button>
    </EmptyCard>
  )
}
