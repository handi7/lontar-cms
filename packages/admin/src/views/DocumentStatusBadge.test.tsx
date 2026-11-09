import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DocumentStatusBadge, getDocumentStatus } from './DocumentStatusBadge'

afterEach(cleanup)

describe('getDocumentStatus', () => {
  it('returns draft for null or undefined doc', () => {
    expect(getDocumentStatus(null)).toBe('draft')
    expect(getDocumentStatus(undefined)).toBe('draft')
  })

  it('returns published when _status is published', () => {
    expect(getDocumentStatus({ _status: 'published' })).toBe('published')
    expect(getDocumentStatus({ _status: 'published', _isPublished: true })).toBe('published')
  })

  it('returns changed when _status is draft but _isPublished is true', () => {
    expect(getDocumentStatus({ _status: 'draft', _isPublished: true })).toBe('changed')
  })

  it('returns draft when _status is draft and _isPublished is false or omitted', () => {
    expect(getDocumentStatus({ _status: 'draft', _isPublished: false })).toBe('draft')
    expect(getDocumentStatus({ _status: 'draft' })).toBe('draft')
  })
})

describe('DocumentStatusBadge', () => {
  it('renders Published badge correctly', () => {
    render(<DocumentStatusBadge status="published" />)
    const badge = screen.getByText('Published')
    expect(badge).toBeTruthy()
    expect(badge.getAttribute('data-status')).toBe('published')
  })

  it('renders Changed badge correctly', () => {
    render(<DocumentStatusBadge status="changed" />)
    const badge = screen.getByText('Changed')
    expect(badge).toBeTruthy()
    expect(badge.getAttribute('data-status')).toBe('changed')
  })

  it('renders Draft badge correctly', () => {
    render(<DocumentStatusBadge status="draft" />)
    const badge = screen.getByText('Draft')
    expect(badge).toBeTruthy()
    expect(badge.getAttribute('data-status')).toBe('draft')
  })

  it('derives status from doc prop', () => {
    render(<DocumentStatusBadge doc={{ _status: 'draft', _isPublished: true }} />)
    expect(screen.getByText('Changed')).toBeTruthy()
  })
})
