import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PortalContainerProvider } from '../context/PortalContainer'
import { chooseSelectOption } from '../test/radix'
import { LocaleSwitcher, type LocaleSwitcherProps } from './LocaleSwitcher'

function renderLocaleSwitcher(props: Partial<LocaleSwitcherProps> = {}) {
  const defaultProps: LocaleSwitcherProps = {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'id', label: 'Bahasa Indonesia' },
    ],
    activeLocale: 'en',
    onLocaleChange: vi.fn(),
    ...props,
  }

  return {
    ...render(
      <div className="lontar-admin">
        <PortalContainerProvider>
          <LocaleSwitcher {...defaultProps} />
        </PortalContainerProvider>
      </div>,
    ),
    props: defaultProps,
  }
}

describe('LocaleSwitcher (#428)', () => {
  afterEach(cleanup)

  it('renders available locales and current active locale', () => {
    renderLocaleSwitcher({ activeLocale: 'en' })
    const trigger = screen.getByTestId('locale-switcher')
    expect(trigger).toBeTruthy()
    expect(trigger.textContent).toContain('English (en)')
  })

  it('calls onLocaleChange when selecting a different locale', () => {
    const onLocaleChange = vi.fn()
    renderLocaleSwitcher({ activeLocale: 'en', onLocaleChange })
    const trigger = screen.getByTestId('locale-switcher')

    chooseSelectOption(trigger, 'Bahasa Indonesia (id)')
    expect(onLocaleChange).toHaveBeenCalledWith('id')
  })

  it('does not render when there is only one locale or empty', () => {
    renderLocaleSwitcher({
      locales: [{ code: 'en', label: 'English' }],
    })
    expect(screen.queryByTestId('locale-switcher')).toBeNull()

    cleanup()
    renderLocaleSwitcher({ locales: [] })
    expect(screen.queryByTestId('locale-switcher')).toBeNull()
  })

  it('respects disabled prop', () => {
    renderLocaleSwitcher({ disabled: true })
    const trigger = screen.getByTestId('locale-switcher')
    expect(trigger.getAttribute('data-disabled')).toBeDefined()
  })
})
