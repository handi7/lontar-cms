import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RichTextEditor } from './RichTextEditor'

describe('RichTextEditor', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders all toolbar buttons', () => {
    render(<RichTextEditor name="content" />)

    expect(screen.getByTestId('richtext-content')).toBeTruthy()
    expect(screen.getByTestId('richtext-bold')).toBeTruthy()
    expect(screen.getByTestId('richtext-italic')).toBeTruthy()
    expect(screen.getByTestId('richtext-strike')).toBeTruthy()
    expect(screen.getByTestId('richtext-code')).toBeTruthy()
    expect(screen.getByTestId('richtext-h1')).toBeTruthy()
    expect(screen.getByTestId('richtext-h2')).toBeTruthy()
    expect(screen.getByTestId('richtext-h3')).toBeTruthy()
    expect(screen.getByTestId('richtext-bulletList')).toBeTruthy()
    expect(screen.getByTestId('richtext-orderedList')).toBeTruthy()
    expect(screen.getByTestId('richtext-blockquote')).toBeTruthy()
    expect(screen.getByTestId('richtext-link')).toBeTruthy()
    expect(screen.getByTestId('richtext-undo')).toBeTruthy()
    expect(screen.getByTestId('richtext-redo')).toBeTruthy()
  })

  it('renders with initial content', () => {
    const initial = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Sample paragraph' }],
        },
      ],
    }

    render(<RichTextEditor name="content" value={initial} />)
    expect(screen.getByText('Sample paragraph')).toBeTruthy()
  })

  it('handles toolbar button clicks without crashing', () => {
    render(<RichTextEditor name="content" />)

    const boldBtn = screen.getByTestId('richtext-bold')
    fireEvent.click(boldBtn)

    const h1Btn = screen.getByTestId('richtext-h1')
    fireEvent.click(h1Btn)

    const bulletBtn = screen.getByTestId('richtext-bulletList')
    fireEvent.click(bulletBtn)
  })

  it('handles link prompt', () => {
    const mockPrompt = vi.fn().mockReturnValue('https://lontar.dev')
    window.prompt = mockPrompt
    render(<RichTextEditor name="content" />)

    const linkBtn = screen.getByTestId('richtext-link')
    fireEvent.click(linkBtn)

    expect(mockPrompt).toHaveBeenCalledWith('URL', 'https://')
  })

  it('handles link prompt cancellation', () => {
    const mockPrompt = vi.fn().mockReturnValue(null)
    window.prompt = mockPrompt
    render(<RichTextEditor name="content" />)

    const linkBtn = screen.getByTestId('richtext-link')
    fireEvent.click(linkBtn)

    expect(mockPrompt).toHaveBeenCalled()
  })

  it('handles disabled mode', () => {
    render(<RichTextEditor name="content" disabled={true} />)

    const editorEl = screen.getByTestId('richtext-content')
    const prosemirror = editorEl.querySelector('.ProseMirror')
    expect(prosemirror?.getAttribute('contenteditable')).toBe('false')
  })
})
