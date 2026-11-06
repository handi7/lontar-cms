import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PortalContainerProvider, usePortalContainer } from './PortalContainer'

function ContainerProbe() {
  const container = usePortalContainer()
  return <span data-testid="probe">{container ? container.className : 'null'}</span>
}

describe('PortalContainer', () => {
  afterEach(cleanup)

  it('throws when the hook is used outside the provider', () => {
    expect(() => render(<ContainerProbe />)).toThrow(
      'usePortalContainer must be used within a PortalContainerProvider',
    )
  })

  it('exposes the mounted node to consumers', () => {
    render(
      <PortalContainerProvider>
        <ContainerProbe />
      </PortalContainerProvider>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('lontar-portal-root')
  })

  it('mounts the target inside the provider rather than on document.body', () => {
    const { container } = render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <span />
        </PortalContainerProvider>
      </div>,
    )

    const target = container.querySelector('.lontar-portal-root')
    expect(target).not.toBeNull()
    expect(target?.closest('.lontar-admin')).not.toBeNull()
    expect(target?.parentElement).not.toBe(document.body)
  })
})
