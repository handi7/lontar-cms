import { useEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

interface ButtonItem {
  id: string
  label: string
  title: string
  isActive: (editor: Editor) => boolean
  isDisabled?: (editor: Editor) => boolean
  onClick: (editor: Editor) => void
}

const FORMAT_ACTIONS: ButtonItem[] = [
  {
    id: 'bold',
    label: 'B',
    title: 'Bold',
    isActive: (e) => e.isActive('bold'),
    onClick: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: 'I',
    title: 'Italic',
    isActive: (e) => e.isActive('italic'),
    onClick: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: 'strike',
    label: 'S',
    title: 'Strikethrough',
    isActive: (e) => e.isActive('strike'),
    onClick: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    label: '<>',
    title: 'Code',
    isActive: (e) => e.isActive('code'),
    onClick: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    id: 'h1',
    label: 'H1',
    title: 'Heading 1',
    isActive: (e) => e.isActive('heading', { level: 1 }),
    onClick: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'H2',
    title: 'Heading 2',
    isActive: (e) => e.isActive('heading', { level: 2 }),
    onClick: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'H3',
    title: 'Heading 3',
    isActive: (e) => e.isActive('heading', { level: 3 }),
    onClick: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    label: '• List',
    title: 'Bullet List',
    isActive: (e) => e.isActive('bulletList'),
    onClick: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: '1. List',
    title: 'Numbered List',
    isActive: (e) => e.isActive('orderedList'),
    onClick: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    label: '” Quote',
    title: 'Blockquote',
    isActive: (e) => e.isActive('blockquote'),
    onClick: (e) => e.chain().focus().toggleBlockquote().run(),
  },
]

const HISTORY_ACTIONS: ButtonItem[] = [
  {
    id: 'undo',
    label: '↺',
    title: 'Undo',
    isActive: () => false,
    isDisabled: (e) => !e.can().undo(),
    onClick: (e) => e.chain().focus().undo().run(),
  },
  {
    id: 'redo',
    label: '↻',
    title: 'Redo',
    isActive: () => false,
    isDisabled: (e) => !e.can().redo(),
    onClick: (e) => e.chain().focus().redo().run(),
  },
]

interface ToolbarButtonProps {
  id: string
  label: string
  title: string
  isActive?: boolean
  isDisabled?: boolean
  onClick: () => void
}

function ToolbarButton({ id, label, title, isActive, isDisabled, onClick }: ToolbarButtonProps) {
  const activeClass = isActive ? ' lontar-active' : ''
  return (
    <button
      type="button"
      data-testid={`richtext-${id}`}
      className={`lontar-richtext-btn${activeClass}`}
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
    >
      {label}
    </button>
  )
}

function handleLink(editor: Editor) {
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run()
    return
  }
  const previousUrl = (editor.getAttributes('link').href as string | undefined) ?? ''
  const url =
    typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt('URL', previousUrl || 'https://')
      : null
  if (url === null) return
  const trimmed = url.trim()
  if (trimmed === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="lontar-richtext-toolbar" role="toolbar" aria-label="Rich text formatting">
      <div className="lontar-richtext-toolbar-group">
        {FORMAT_ACTIONS.map((item) => (
          <ToolbarButton
            key={item.id}
            id={item.id}
            label={item.label}
            title={item.title}
            isActive={item.isActive(editor)}
            isDisabled={item.isDisabled ? item.isDisabled(editor) : false}
            onClick={() => item.onClick(editor)}
          />
        ))}
        <ToolbarButton
          id="link"
          label="🔗"
          title="Link"
          isActive={editor.isActive('link')}
          onClick={() => handleLink(editor)}
        />
      </div>
      <div className="lontar-richtext-toolbar-group">
        {HISTORY_ACTIONS.map((item) => (
          <ToolbarButton
            key={item.id}
            id={item.id}
            label={item.label}
            title={item.title}
            isActive={item.isActive(editor)}
            isDisabled={item.isDisabled ? item.isDisabled(editor) : false}
            onClick={() => item.onClick(editor)}
          />
        ))}
      </div>
    </div>
  )
}

export interface RichTextEditorProps {
  name: string
  value?: Record<string, unknown> | null
  onChange?: (value: Record<string, unknown>) => void
  disabled?: boolean
}

export function RichTextEditor({ name, value, onChange, disabled }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          HTMLAttributes: {
            rel: 'noopener noreferrer',
            target: '_blank',
          },
        },
      }),
    ],
    content: value ?? undefined,
    editable: !disabled,
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(currentEditor.getJSON())
    },
  })

  useEffect(() => {
    if (!editor || editor.isFocused) return
    if (!value) {
      if (!editor.isEmpty) {
        editor.commands.clearContent()
      }
      return
    }
    const current = editor.getJSON()
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      editor.commands.setContent(value)
    }
  }, [editor, value])

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled)
    }
  }, [editor, disabled])

  return (
    <div className="lontar-richtext-editor" data-testid={`richtext-${name}`}>
      {editor && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} className="lontar-richtext-content" />
    </div>
  )
}
