import { useNavigate } from '@tanstack/react-router'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog'
import { useCommandPalette } from './CommandPaletteContext'
import { useNavModel } from './useNavModel'

// Entries come from the same model as the sidebar, so a collection the user cannot read is neither
// in the sidebar nor here. Creating also needs create access.
export function CommandPalette() {
  const { open, setOpen } = useCommandPalette()
  const { collections, globals, isAdmin, canCreate } = useNavModel()
  const navigate = useNavigate()

  const run = (go: () => void) => () => {
    setOpen(false)
    go()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-describedby="lontar-palette-description"
        className="lt:top-[20%] lt:translate-y-0 lt:gap-0 lt:overflow-hidden lt:p-0"
      >
        <DialogTitle className="lt:sr-only">Command palette</DialogTitle>
        <DialogDescription id="lontar-palette-description" className="lt:sr-only">
          Type to find a collection or global to open, or a document to create.
        </DialogDescription>
        <Command label="Command palette">
          <CommandInput placeholder="Go to or create…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Go to">
              <CommandItem value="Go to Dashboard" onSelect={run(() => void navigate({ to: '/' }))}>
                Go to Dashboard
              </CommandItem>
              {collections.map((col) => (
                <CommandItem
                  key={col.slug}
                  value={`Go to ${col.labels.plural}`}
                  keywords={[col.slug]}
                  onSelect={run(
                    () => void navigate({ to: '/$collection', params: { collection: col.slug } }),
                  )}
                >
                  Go to {col.labels.plural}
                </CommandItem>
              ))}
              {(globals ?? []).map((g) => (
                <CommandItem
                  key={g.slug}
                  value={`Go to ${g.label}`}
                  keywords={[g.slug]}
                  onSelect={run(
                    () => void navigate({ to: '/globals/$slug', params: { slug: g.slug } }),
                  )}
                >
                  {g.label}
                </CommandItem>
              ))}
              {isAdmin && (
                <CommandItem
                  value="Go to Users"
                  onSelect={run(() => void navigate({ to: '/users' }))}
                >
                  Go to Users
                </CommandItem>
              )}
            </CommandGroup>

            <CommandGroup heading="Create">
              {collections
                .filter((col) => canCreate(col.slug))
                .map((col) => (
                  <CommandItem
                    key={col.slug}
                    value={`New ${col.labels.singular}`}
                    keywords={[col.slug, 'create', 'add']}
                    onSelect={run(
                      () =>
                        void navigate({
                          to: '/$collection/create',
                          params: { collection: col.slug },
                        }),
                    )}
                  >
                    New {col.labels.singular}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
