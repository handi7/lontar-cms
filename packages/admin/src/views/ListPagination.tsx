import { Button } from '../components/ui/button'
import type { PaginatedDocs } from '../api/client'

interface ListPaginationProps {
  data?: PaginatedDocs
  onPageChange: (newPage: number) => void
}

export function ListPagination({ data, onPageChange }: ListPaginationProps) {
  return (
    <div className="lt:flex lt:items-center lt:justify-between lt:border-t lt:bg-background lt:px-5 lt:py-3.5">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          onPageChange(Math.max(1, (data?.page ?? 1) - 1))
        }}
        disabled={!data?.hasPrevPage}
      >
        Previous
      </Button>
      <span className="lt:text-[0.8125rem] lt:text-muted-foreground">
        Page {data?.page ?? 1} of {data?.totalPages ?? 1}
      </span>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          onPageChange((data?.page ?? 1) + 1)
        }}
        disabled={!data?.hasNextPage}
      >
        Next
      </Button>
    </div>
  )
}
