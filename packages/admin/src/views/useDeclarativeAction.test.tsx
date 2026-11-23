import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ClientAction } from '@lontar/core/client'
import { ComponentRegistryProvider } from '../context/ComponentRegistry'
import { PortalContainerProvider } from '../context/PortalContainer'
import { useDeclarativeAction, type UseDeclarativeActionOptions } from './useDeclarativeAction'
import type { CustomActionProps } from './custom-action-props'

function TestActionHarness({
  options,
  actions,
  targetId,
  targetDoc,
}: {
  options: UseDeclarativeActionOptions
  actions: ClientAction[]
  targetId?: string | number
  targetDoc?: Record<string, unknown>
}) {
  const { isPending, actionSuccess, actionError, triggerAction, dialogs } =
    useDeclarativeAction(options)

  return (
    <div>
      {dialogs}
      {actionSuccess && <div data-testid="action-success">{actionSuccess}</div>}
      {actionError && <div data-testid="action-error">{actionError}</div>}
      {actions.map((action) => (
        <button
          key={action.key}
          disabled={isPending}
          onClick={() => triggerAction(action, { id: targetId, doc: targetDoc })}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

function renderHarness({
  options,
  actions,
  targetId,
  targetDoc,
  components = {},
  queryClient = new QueryClient(),
}: {
  options: UseDeclarativeActionOptions
  actions: ClientAction[]
  targetId?: string | number
  targetDoc?: Record<string, unknown>
  components?: Record<string, React.ComponentType<CustomActionProps>>
  queryClient?: QueryClient
}) {
  return render(
    <div className="lontar-admin">
      <PortalContainerProvider>
        <ComponentRegistryProvider components={components}>
          <QueryClientProvider client={queryClient}>
            <TestActionHarness
              options={options}
              actions={actions}
              targetId={targetId}
              targetDoc={targetDoc}
            />
          </QueryClientProvider>
        </ComponentRegistryProvider>
      </PortalContainerProvider>
    </div>,
  )
}

describe('useDeclarativeAction', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('executes endpoint action without confirm and displays success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: 'Post published successfully' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const action: ClientAction = {
      key: 'publish',
      label: 'Publish',
      scope: ['document'],
      path: '/:id/publish',
      method: 'post',
    }

    renderHarness({
      options: { apiBase: '/api', scopeType: 'collection', slug: 'posts' },
      actions: [action],
      targetId: 42,
      queryClient,
    })

    const button = screen.getByRole('button', { name: 'Publish' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/posts/42/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
    })

    const successEl = await screen.findByTestId('action-success')
    expect(successEl.textContent).toBe('Post published successfully')
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('prompts confirm dialog when action.confirm is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const action: ClientAction = {
      key: 'archive',
      label: 'Archive',
      scope: ['row'],
      confirm: 'Are you sure you want to archive this post?',
      variant: 'destructive',
      path: '/:id/archive',
      method: 'post',
    }

    renderHarness({
      options: { apiBase: '/api', scopeType: 'collection', slug: 'posts' },
      actions: [action],
      targetId: 10,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    // Dialog appears
    expect(screen.getByText('Are you sure you want to archive this post?')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    // Cancel closes dialog without fetch
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock).not.toHaveBeenCalled()

    // Trigger again and confirm
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/posts/10/archive', expect.any(Object))
    })
    expect(await screen.findByTestId('action-success')).toBeTruthy()
  })

  it('appends locale query parameter when provided in options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })
    vi.stubGlobal('fetch', fetchMock)

    const action: ClientAction = {
      key: 'translate',
      label: 'Translate',
      scope: ['document'],
      path: '/:id/translate',
      method: 'post',
    }

    renderHarness({
      options: { apiBase: '/api', scopeType: 'collection', slug: 'posts', locale: 'id' },
      actions: [action],
      targetId: 99,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/posts/99/translate?locale=id',
        expect.any(Object),
      )
    })
  })

  it('displays error alert with server error message on non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Post must have a title before approving' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const action: ClientAction = {
      key: 'approve',
      label: 'Approve',
      scope: ['row'],
      path: '/:id/approve',
      method: 'post',
    }

    renderHarness({
      options: { apiBase: '/api', scopeType: 'collection', slug: 'posts' },
      actions: [action],
      targetId: 5,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    const errorEl = await screen.findByTestId('action-error')
    expect(errorEl.textContent).toBe('Post must have a title before approving')
  })

  it('opens dialog for component action and passes CustomActionProps', async () => {
    function CustomDialog({ label, id, close }: CustomActionProps) {
      return (
        <div>
          <span data-testid="custom-label">{label}</span>
          <span data-testid="custom-target-id">{String(id)}</span>
          <button onClick={close}>Close Custom Dialog</button>
        </div>
      )
    }

    const action: ClientAction = {
      key: 'custom-export',
      label: 'Export Document',
      scope: ['document'],
      component: 'CustomExportDialog',
    }

    renderHarness({
      options: { apiBase: '/api', scopeType: 'collection', slug: 'posts' },
      actions: [action],
      targetId: 777,
      targetDoc: { id: 777, title: 'Hello World' },
      components: {
        CustomExportDialog: CustomDialog,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Export Document' }))

    expect(await screen.findByTestId('custom-label')).toBeTruthy()
    expect(screen.getByTestId('custom-label').textContent).toBe('Export Document')
    expect(screen.getByTestId('custom-target-id').textContent).toBe('777')

    fireEvent.click(screen.getByRole('button', { name: 'Close Custom Dialog' }))
    await waitFor(() => {
      expect(screen.queryByTestId('custom-label')).toBeNull()
    })
  })

  it('handles global action endpoint URLs correctly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: 'Reindexed' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const action: ClientAction = {
      key: 'reindex',
      label: 'Reindex Search',
      scope: ['document'],
      path: '/reindex',
      method: 'post',
    }

    renderHarness({
      options: { apiBase: '/api', scopeType: 'global', slug: 'site-settings' },
      actions: [action],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reindex Search' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/globals/site-settings/reindex',
        expect.any(Object),
      )
    })
  })
})
