import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  CLIENT_CONFIG_VERSION,
  clientFieldsToZod,
  diffSnapshots,
  type ClientArrayField,
  type ClientBlocksField,
  type ClientCollapsibleField,
  type ClientCollection,
  type ClientConfig,
  type ClientField,
  type ClientGroupField,
  type ClientRowField,
  type ClientTabsField,
  type CollectionPermission,
  type FieldPermission,
} from '@lontar/core/client'
import * as client from '../api/client'
import type * as ClientModule from '../api/client'
import { AdminContext } from '../context/AdminContext'
import { PermissionsProvider } from '../context/PermissionsContext'
import { PortalContainerProvider } from '../context/PortalContainer'
import { chooseSelectOption } from '../test/radix'
import { computeDefaultValues } from '../utils/form-utils'
import { CollectionFormView } from '../views/CollectionFormView'
import { VersionDiffViewer } from '../views/VersionDiffViewer'
import { FieldRenderer, ScopeFieldList } from './FieldRenderer'

let mockRouteParams: { collection?: string; id?: string } = {
  collection: 'articles',
  id: '1',
}
let mockRouteSearch: { locale?: string } = {}
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useParams: () => mockRouteParams,
  useSearch: () => mockRouteSearch,
  useNavigate: () => mockNavigate,
  useBlocker: vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof ClientModule>('../api/client')
  return {
    ...actual,
    fetchDoc: vi.fn(),
    fetchDocVersions: vi.fn(),
    fetchPermissions: vi.fn(),
    fetchDocumentPermissions: vi.fn(),
    createDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
  }
})

function FormWrapper({
  fields,
  defaultValues = {},
  onSubmit = () => {},
  children,
}: {
  fields: readonly ClientField[]
  defaultValues?: Record<string, unknown>
  onSubmit?: (data: Record<string, unknown>) => void
  children: (methods: ReturnType<typeof useForm<Record<string, unknown>>>) => React.ReactNode
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const schema = clientFieldsToZod(fields)
  const methods = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: { ...computeDefaultValues(fields), ...defaultValues },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <PortalContainerProvider>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void methods.handleSubmit(onSubmit)()
          }}
        >
          {children(methods)}
          <button type="submit">Submit</button>
        </form>
      </PortalContainerProvider>
    </QueryClientProvider>
  )
}

describe('Layout fields (tabs, row, collapsible) (#510)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('RowFieldRenderer', () => {
    const rowField: ClientRowField = {
      name: 'nameRow',
      type: 'row',
      label: 'Name Row',
      required: false,
      admin: { description: 'First and last name' },
      fields: [
        { name: 'firstName', type: 'text', label: 'First Name', required: true },
        { name: 'lastName', type: 'text', label: 'Last Name', required: false },
      ],
    }

    it('renders children in a responsive grid row that stacks on narrow screens', () => {
      const { container } = render(
        <FormWrapper fields={[rowField]}>
          {({ control, register, formState }) => (
            <ScopeFieldList
              fields={[rowField]}
              control={control}
              register={register}
              scopeErrors={formState.errors as Record<string, unknown>}
            />
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('First and last name')).toBeTruthy()
      expect(screen.getByLabelText(/First Name/i)).toBeTruthy()
      expect(screen.getByLabelText(/Last Name/i)).toBeTruthy()

      const rowWrapper = container.querySelector('[data-row="nameRow"]')
      const grid = rowWrapper?.querySelector('.lt\\:grid')
      expect(grid?.className).toContain('lt:grid-cols-1')
      expect(grid?.className).toContain('lt:md:grid-flow-col')
    })

    it('hides entire row when all child fields have read: false', () => {
      const perms: Record<string, FieldPermission> = {
        firstName: { read: false, create: false, update: false },
        lastName: { read: false, create: false, update: false },
      }

      const { container } = render(
        <FormWrapper fields={[rowField]}>
          {({ control, register }) => (
            <ScopeFieldList
              fields={[rowField]}
              control={control}
              register={register}
              scopePermissions={perms}
            />
          )}
        </FormWrapper>,
      )

      expect(container.querySelector('[data-row="nameRow"]')).toBeNull()
    })
  })

  describe('CollapsibleFieldRenderer', () => {
    const collapsibleField: ClientCollapsibleField = {
      name: 'advanced',
      type: 'collapsible',
      label: 'Advanced Options',
      required: false,
      initiallyCollapsed: true,
      admin: { description: 'Extra settings' },
      fields: [{ name: 'apiKey', type: 'text', label: 'API Key', required: true }],
    }

    it('starts collapsed when initiallyCollapsed is true and toggles on click with aria-expanded', () => {
      render(
        <FormWrapper fields={[collapsibleField]}>
          {({ control, register, formState }) => (
            <ScopeFieldList
              fields={[collapsibleField]}
              control={control}
              register={register}
              scopeErrors={formState.errors as Record<string, unknown>}
            />
          )}
        </FormWrapper>,
      )

      const toggle = screen.getByRole('button', { name: /Advanced Options/i })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      const controlsId = toggle.getAttribute('aria-controls')
      expect(controlsId).toBeTruthy()

      const content = document.getElementById(controlsId!)
      expect(content?.hasAttribute('hidden')).toBe(true)

      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(content?.hasAttribute('hidden')).toBe(false)
    })

    it('opens automatically on failed submit when a field inside fails validation', async () => {
      render(
        <FormWrapper fields={[collapsibleField]}>
          {({ control, register, formState }) => (
            <ScopeFieldList
              fields={[collapsibleField]}
              control={control}
              register={register}
              scopeErrors={formState.errors as Record<string, unknown>}
            />
          )}
        </FormWrapper>,
      )

      const toggle = screen.getByRole('button', { name: /Advanced Options/i })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')

      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
      })
      expect(screen.getByTestId('collapsible-error-badge-advanced').textContent).toBe('1')
    })

    it('hides collapsible section when all child fields are unreadable', () => {
      const { container } = render(
        <FormWrapper fields={[collapsibleField]}>
          {({ control, register }) => (
            <ScopeFieldList
              fields={[collapsibleField]}
              control={control}
              register={register}
              scopePermissions={{
                apiKey: { read: false, create: false, update: false },
              }}
            />
          )}
        </FormWrapper>,
      )

      expect(container.querySelector('[data-collapsible="advanced"]')).toBeNull()
    })
  })

  describe('TabsFieldRenderer', () => {
    const tabsField: ClientTabsField = {
      name: 'mainTabs',
      type: 'tabs',
      label: 'Main Tabs',
      required: false,
      tabs: [
        {
          label: 'Content',
          description: 'Primary content',
          fields: [{ name: 'title', type: 'text', label: 'Title', required: true }],
        },
        {
          label: 'SEO',
          fields: [
            { name: 'metaTitle', type: 'text', label: 'Meta Title', required: true },
            { name: 'metaDesc', type: 'text', label: 'Meta Desc', required: true },
          ],
        },
        {
          label: 'Hidden Tab',
          condition: { showHidden: { equals: true } },
          fields: [{ name: 'hiddenNote', type: 'text', label: 'Hidden Note', required: false }],
        },
      ],
    }

    const toggleField: ClientField = {
      name: 'showHidden',
      type: 'checkbox',
      label: 'Show Hidden',
      required: false,
    }

    it('renders tabs, switches with click and arrow keys, and hides conditional tab', async () => {
      render(
        <FormWrapper fields={[toggleField, tabsField]} defaultValues={{ showHidden: false }}>
          {({ control, register, watch, formState }) => (
            <ScopeFieldList
              fields={[toggleField, tabsField]}
              control={control}
              register={register}
              watch={watch}
              scopeErrors={formState.errors as Record<string, unknown>}
            />
          )}
        </FormWrapper>,
      )

      const contentTab = screen.getByRole('tab', { name: 'Content' })
      const seoTab = screen.getByRole('tab', { name: 'SEO' })
      expect(contentTab.getAttribute('aria-selected')).toBe('true')
      expect(seoTab.getAttribute('aria-selected')).toBe('false')
      expect(screen.queryByRole('tab', { name: 'Hidden Tab' })).toBeNull()

      // Keyboard navigation with ArrowRight (Radix RovingFocus moves focus and activates)
      contentTab.focus()
      fireEvent.keyDown(contentTab, { key: 'ArrowRight' })
      await waitFor(() => {
        expect(seoTab.getAttribute('aria-selected')).toBe('true')
      })

      // Toggling checkbox reveals conditional tab
      fireEvent.click(screen.getByRole('checkbox', { name: /Show Hidden/i }))
      expect(screen.getByRole('tab', { name: 'Hidden Tab' })).toBeTruthy()
    })

    it('displays error badges on tabs and auto-switches to first invalid hidden tab on submit', async () => {
      const scrollSpy = vi.fn()
      HTMLElement.prototype.scrollIntoView = scrollSpy

      render(
        <FormWrapper
          fields={[tabsField]}
          defaultValues={{ title: 'Filled Title', metaTitle: '', metaDesc: '' }}
        >
          {({ control, register, watch, formState }) => (
            <ScopeFieldList
              fields={[tabsField]}
              control={control}
              register={register}
              watch={watch}
              scopeErrors={formState.errors as Record<string, unknown>}
            />
          )}
        </FormWrapper>,
      )

      const contentTab = screen.getByRole('tab', { name: 'Content' })
      const seoTab = screen.getByRole('tab', { name: 'SEO' })
      expect(contentTab.getAttribute('aria-selected')).toBe('true')

      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(seoTab.getAttribute('aria-selected')).toBe('true')
      })

      const badge = screen.getByTestId('tab-error-badge-mainTabs-tab-1')
      expect(badge.textContent).toBe('2')
      expect(scrollSpy).toHaveBeenCalled()
    })

    it('hides tabs whose fields are all unreadable', () => {
      render(
        <FormWrapper fields={[tabsField]}>
          {({ control, register, watch }) => (
            <ScopeFieldList
              fields={[tabsField]}
              control={control}
              register={register}
              watch={watch}
              scopePermissions={{
                title: { read: true, create: true, update: true },
                metaTitle: { read: false, create: false, update: false },
                metaDesc: { read: false, create: false, update: false },
                hiddenNote: { read: false, create: false, update: false },
              }}
            />
          )}
        </FormWrapper>,
      )

      expect(screen.getByRole('tab', { name: 'Content' })).toBeTruthy()
      expect(screen.queryByRole('tab', { name: 'SEO' })).toBeNull()
    })
  })

  describe('Layout fields inside group, array, and blocks', () => {
    it('supports layout fields inside group with pathPrefix and localization badge', () => {
      const groupField: ClientGroupField = {
        name: 'seo',
        type: 'group',
        label: 'SEO',
        required: false,
        localized: true,
        fields: [
          {
            name: 'seoTabs',
            type: 'tabs',
            label: 'SEO Tabs',
            required: false,
            tabs: [
              {
                label: 'Meta',
                fields: [{ name: 'metaTitle', type: 'text', label: 'Meta Title', required: true }],
              },
              {
                label: 'Social',
                fields: [{ name: 'ogTitle', type: 'text', label: 'OG Title', required: false }],
              },
            ],
          },
        ],
      }

      render(
        <FormWrapper fields={[groupField]}>
          {({ control, register, formState }) => (
            <FieldRenderer
              field={groupField}
              control={control}
              register={register}
              error={formState.errors.seo as Record<string, unknown> | undefined}
              hasLocalization={true}
            />
          )}
        </FormWrapper>,
      )

      const metaInput = screen.getByLabelText(/Meta Title/i)
      expect(metaInput.getAttribute('name')).toBe('seo.metaTitle')
      expect(screen.getByTestId('field-localized-seo.metaTitle').textContent).toContain('Localized')

      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Social' }), {
        button: 0,
        ctrlKey: false,
      })
      const ogInput = screen.getByLabelText(/OG Title/i)
      expect(ogInput.getAttribute('name')).toBe('seo.ogTitle')
    })

    it('supports row inside array and resolves row label from nested subfield', () => {
      const arrayField: ClientArrayField = {
        name: 'links',
        type: 'array',
        label: 'Links',
        required: false,
        fields: [
          {
            name: 'linkRow',
            type: 'row',
            label: 'Link Row',
            required: false,
            fields: [
              { name: 'label', type: 'text', label: 'Link Label', required: true },
              { name: 'url', type: 'text', label: 'URL', required: true },
            ],
          },
        ],
      }

      render(
        <FormWrapper
          fields={[arrayField]}
          defaultValues={{
            links: [{ id: 'row-1', label: 'Docs', url: 'https://example.com' }],
          }}
        >
          {({ control, register, watch, formState }) => (
            <FieldRenderer
              field={arrayField}
              control={control}
              register={register}
              watch={watch}
              error={formState.errors.links as Record<string, unknown> | undefined}
            />
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('Docs')).toBeTruthy()
      expect(screen.getByLabelText(/Link Label/i).getAttribute('name')).toBe('links.0.label')
      expect(screen.getByLabelText(/URL/i).getAttribute('name')).toBe('links.0.url')
    })

    it('supports collapsible inside blocks and resolves block row label', () => {
      const blocksField: ClientBlocksField = {
        name: 'sections',
        type: 'blocks',
        label: 'Sections',
        required: false,
        blocks: [
          {
            slug: 'callout',
            labels: { singular: 'Callout', plural: 'Callouts' },
            fields: [
              {
                name: 'box',
                type: 'collapsible',
                label: 'Callout Details',
                required: false,
                fields: [{ name: 'heading', type: 'text', label: 'Heading', required: true }],
              },
            ],
          },
        ],
      }

      render(
        <FormWrapper
          fields={[blocksField]}
          defaultValues={{
            sections: [{ id: 'blk-1', blockType: 'callout', heading: 'Notice' }],
          }}
        >
          {({ control, register, watch, formState }) => (
            <FieldRenderer
              field={blocksField}
              control={control}
              register={register}
              watch={watch}
              error={formState.errors.sections as Record<string, unknown> | undefined}
            />
          )}
        </FormWrapper>,
      )

      expect(screen.getByText('Callout - Notice')).toBeTruthy()
      expect(screen.getByLabelText(/Heading/i).getAttribute('name')).toBe('sections.0.heading')
    })
  })

  describe('VersionDiffViewer with layout fields', () => {
    it('renders field diffs for fields inside tabs, row, and collapsible', () => {
      const fields: ClientField[] = [
        {
          name: 'layoutTabs',
          type: 'tabs',
          label: 'Tabs',
          required: false,
          tabs: [
            {
              label: 'General',
              fields: [
                {
                  name: 'titleRow',
                  type: 'row',
                  label: 'Row',
                  required: false,
                  fields: [{ name: 'title', type: 'text', label: 'Title', required: true }],
                },
              ],
            },
            {
              label: 'Meta',
              fields: [
                {
                  name: 'metaBox',
                  type: 'collapsible',
                  label: 'Meta Box',
                  required: false,
                  fields: [{ name: 'subtitle', type: 'text', label: 'Subtitle', required: false }],
                },
              ],
            },
          ],
        },
      ]

      const diff = diffSnapshots(
        { fields },
        { title: 'Old Title', subtitle: 'Old Sub' },
        { title: 'New Title', subtitle: 'Old Sub' },
      )

      render(<VersionDiffViewer diff={diff} fields={fields} />)

      expect(screen.getByText('Title')).toBeTruthy()
      expect(screen.getByText('Old Title')).toBeTruthy()
      expect(screen.getByText('New Title')).toBeTruthy()
      expect(screen.getByText('Subtitle')).toBeTruthy()
    })
  })

  describe('CollectionFormView active tab memory and field locks', () => {
    let queryClient: QueryClient

    const tabbedCollection: ClientCollection = {
      slug: 'articles',
      labels: { singular: 'Article', plural: 'Articles' },
      admin: { useAsTitle: 'title', defaultColumns: ['title'] },
      versions: { drafts: true },
      fields: [
        {
          name: 'editorTabs',
          type: 'tabs',
          label: 'Editor Tabs',
          required: false,
          tabs: [
            {
              label: 'Content',
              fields: [
                { name: 'title', label: 'Title', type: 'text', required: true, localized: true },
              ],
            },
            {
              label: 'Settings',
              fields: [{ name: 'lockedCode', label: 'Locked Code', type: 'text', required: false }],
            },
          ],
        },
      ],
    }

    const localizedConfig: ClientConfig = {
      version: CLIENT_CONFIG_VERSION,
      collections: [tabbedCollection],
      globals: [],
      localization: {
        locales: [
          { code: 'en', label: 'English' },
          { code: 'id', label: 'Indonesian' },
        ],
        defaultLocale: 'en',
        fallback: true,
      },
    }

    function perm(overrides: Partial<CollectionPermission> = {}): CollectionPermission {
      return {
        read: true,
        create: true,
        update: true,
        delete: true,
        readVersions: true,
        fields: {
          title: { read: true, create: true, update: true },
          lockedCode: { read: true, create: false, update: false },
        },
        ...overrides,
      }
    }

    beforeEach(() => {
      vi.clearAllMocks()
      mockRouteParams = { collection: 'articles', id: '1' }
      mockRouteSearch = { locale: 'en' }
      queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      vi.mocked(client.fetchPermissions).mockResolvedValue({
        collections: { articles: perm() },
        globals: {},
      })
      vi.mocked(client.fetchDocumentPermissions).mockResolvedValue(perm())
      vi.mocked(client.fetchDocVersions).mockResolvedValue({
        docs: [],
        totalDocs: 0,
        limit: 10,
        page: 1,
        totalPages: 1,
      })
      vi.mocked(client.fetchDoc).mockImplementation((_api, _slug, id) =>
        Promise.resolve({
          id: Number(id),
          title: `Doc ${id}`,
          lockedCode: 'LOCKED',
          _status: 'draft',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
    })

    function renderEditor() {
      return render(
        <div className="lontar-admin">
          <PortalContainerProvider>
            <QueryClientProvider client={queryClient}>
              <AdminContext.Provider
                value={{ config: localizedConfig, apiBase: '/api', basePath: '/admin' }}
              >
                <PermissionsProvider apiBase="/api" user={{ id: 'u1' }}>
                  <CollectionFormView mode="edit" />
                </PermissionsProvider>
              </AdminContext.Provider>
            </QueryClientProvider>
          </PortalContainerProvider>
        </div>,
      )
    }

    it('remembers active tab across locale switches but resets across documents, and enforces field locks', async () => {
      const { rerender } = renderEditor()

      const settingsTab = await screen.findByRole('tab', { name: 'Settings' })
      fireEvent.mouseDown(settingsTab, { button: 0, ctrlKey: false })
      expect(settingsTab.getAttribute('aria-selected')).toBe('true')

      // Locked field inside tab
      const lockedInput = screen.getByLabelText<HTMLInputElement>(/Locked Code/i)
      expect(lockedInput.disabled).toBe(true)
      expect(screen.getByTestId('locked-icon-lockedCode')).toBeTruthy()

      // Switch locale on same document -> active tab stays Settings
      mockRouteSearch = { locale: 'id' }
      chooseSelectOption(screen.getByTestId('locale-switcher'), 'Indonesian (id)')
      rerender(
        <div className="lontar-admin">
          <PortalContainerProvider>
            <QueryClientProvider client={queryClient}>
              <AdminContext.Provider
                value={{ config: localizedConfig, apiBase: '/api', basePath: '/admin' }}
              >
                <PermissionsProvider apiBase="/api" user={{ id: 'u1' }}>
                  <CollectionFormView mode="edit" />
                </PermissionsProvider>
              </AdminContext.Provider>
            </QueryClientProvider>
          </PortalContainerProvider>
        </div>,
      )

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe(
          'true',
        )
      })

      // Navigate to a different document (id: '2') -> active tab resets to first tab
      mockRouteParams = { collection: 'articles', id: '2' }
      rerender(
        <div className="lontar-admin">
          <PortalContainerProvider>
            <QueryClientProvider client={queryClient}>
              <AdminContext.Provider
                value={{ config: localizedConfig, apiBase: '/api', basePath: '/admin' }}
              >
                <PermissionsProvider apiBase="/api" user={{ id: 'u1' }}>
                  <CollectionFormView mode="edit" />
                </PermissionsProvider>
              </AdminContext.Provider>
            </QueryClientProvider>
          </PortalContainerProvider>
        </div>,
      )

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Content' }).getAttribute('aria-selected')).toBe(
          'true',
        )
      })
    })
  })
})
