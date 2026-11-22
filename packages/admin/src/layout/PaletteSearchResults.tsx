import { useNavigate } from '@tanstack/react-router'
import type { ClientCollection, SearchResult } from '@lontar/core/client'
import { CommandGroup, CommandItem } from '../components/ui/command'

interface PaletteSearchResultsProps {
  query: string
  results: SearchResult[]
  collections: ClientCollection[]
  locale: string | undefined
  onSelect: (go: () => void) => () => void
}

function groupByCollection(results: SearchResult[], collections: ClientCollection[]) {
  return collections
    .map((collection) => ({
      collection,
      hits: results.filter((r) => r.collection === collection.slug),
    }))
    .filter((group) => group.hits.length > 0)
}

// The server already did the matching. cmdk filters rows again by their `value`, so each row's
// value carries the typed text and always passes that filter.
export function PaletteSearchResults({
  query,
  results,
  collections,
  locale,
  onSelect,
}: PaletteSearchResultsProps) {
  const navigate = useNavigate()
  return (
    <>
      {groupByCollection(results, collections).map(({ collection, hits }) => (
        <CommandGroup key={collection.slug} heading={collection.labels.plural}>
          {hits.map((hit) => (
            <CommandItem
              key={`${hit.collection}:${hit.id}`}
              value={`${query} ${hit.collection}:${hit.id} ${hit.title}`}
              onSelect={onSelect(
                () =>
                  void navigate({
                    to: '/$collection/$id',
                    params: { collection: hit.collection, id: String(hit.id) },
                    search: locale ? { locale } : {},
                  }),
              )}
            >
              <span className="lt:truncate">{hit.title}</span>
              {hit.status === 'draft' && (
                <span className="lt:ml-auto lt:text-xs lt:text-muted-foreground">Draft</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  )
}
