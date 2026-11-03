import type { ReactNode } from 'react'

interface NodeMark {
  type: string
  attrs?: Record<string, unknown>
}

interface NodeData {
  type?: string
  text?: string
  marks?: NodeMark[]
  attrs?: Record<string, unknown>
  content?: NodeData[]
}

export interface RichTextProps {
  content?: NodeData | Record<string, unknown> | null
  className?: string
}

function renderMarks(text: string, marks?: NodeMark[]): ReactNode {
  if (!marks || marks.length === 0) return text

  return marks.reduce<ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{acc}</strong>
      case 'italic':
        return <em>{acc}</em>
      case 'strike':
        return <s>{acc}</s>
      case 'code':
        return (
          <code
            style={{
              padding: '0.15rem 0.35rem',
              borderRadius: '4px',
              backgroundColor: '#f1f5f9',
              fontFamily: 'monospace',
              fontSize: '0.9em',
            }}
          >
            {acc}
          </code>
        )
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#'
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#2563eb', textDecoration: 'underline' }}
          >
            {acc}
          </a>
        )
      }
      default:
        return acc
    }
  }, text)
}

function renderHeading(node: NodeData, index: number, children: ReactNode): ReactNode {
  const level = Number(node.attrs?.level) || 1
  const style = { margin: '1.25rem 0 0.5rem', color: '#0f172a', fontWeight: 700 }
  if (level === 1)
    return (
      <h1 key={index} style={{ ...style, fontSize: '1.875rem' }}>
        {children}
      </h1>
    )
  if (level === 2)
    return (
      <h2 key={index} style={{ ...style, fontSize: '1.5rem' }}>
        {children}
      </h2>
    )
  if (level === 3)
    return (
      <h3 key={index} style={{ ...style, fontSize: '1.25rem' }}>
        {children}
      </h3>
    )
  return (
    <h4 key={index} style={{ ...style, fontSize: '1.125rem' }}>
      {children}
    </h4>
  )
}

function renderBlockquote(index: number, children: ReactNode): ReactNode {
  return (
    <blockquote
      key={index}
      style={{
        margin: '1rem 0',
        padding: '0.5rem 1rem',
        borderLeft: '4px solid #cbd5e1',
        color: '#64748b',
        fontStyle: 'italic',
        backgroundColor: '#f8fafc',
      }}
    >
      {children}
    </blockquote>
  )
}

function renderCodeBlock(index: number, children: ReactNode): ReactNode {
  return (
    <pre
      key={index}
      style={{
        margin: '1rem 0',
        padding: '1rem',
        borderRadius: '6px',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        overflowX: 'auto',
        fontSize: '0.875rem',
      }}
    >
      <code>{children}</code>
    </pre>
  )
}

function renderListNode(node: NodeData, index: number, children: ReactNode): ReactNode {
  if (node.type === 'bulletList') {
    return (
      <ul key={index} style={{ margin: '0.75rem 0', paddingLeft: '1.5rem', lineHeight: 1.7 }}>
        {children}
      </ul>
    )
  }
  if (node.type === 'orderedList') {
    return (
      <ol key={index} style={{ margin: '0.75rem 0', paddingLeft: '1.5rem', lineHeight: 1.7 }}>
        {children}
      </ol>
    )
  }
  return (
    <li key={index} style={{ margin: '0.25rem 0' }}>
      {children}
    </li>
  )
}

const BLOCK_RENDERERS: Record<
  string,
  (node: NodeData, index: number, children: ReactNode) => ReactNode
> = {
  doc: (_node, index, children) => <div key={index}>{children}</div>,
  paragraph: (_node, index, children) => (
    <p key={index} style={{ margin: '0.75rem 0', lineHeight: 1.7, color: '#334155' }}>
      {children && Array.isArray(children) && children.length > 0 ? children : <br />}
    </p>
  ),
  heading: renderHeading,
  bulletList: renderListNode,
  orderedList: renderListNode,
  listItem: renderListNode,
  blockquote: (_node, index, children) => renderBlockquote(index, children),
  codeBlock: (_node, index, children) => renderCodeBlock(index, children),
  horizontalRule: (_node, index) => (
    <hr key={index} style={{ margin: '2rem 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />
  ),
}

function renderNode(node: NodeData, index: number): ReactNode {
  if (!node || typeof node !== 'object') return null

  if (node.type === 'text' && typeof node.text === 'string') {
    return <span key={index}>{renderMarks(node.text, node.marks)}</span>
  }

  const children = node.content ? node.content.map(renderNode) : null
  const renderer = node.type ? BLOCK_RENDERERS[node.type] : undefined

  if (renderer) {
    return renderer(node, index, children)
  }

  return children ? <div key={index}>{children}</div> : null
}

export function RichText({ content, className }: RichTextProps) {
  if (!content || typeof content !== 'object') return null
  const node = content as NodeData
  return (
    <div className={className || 'lontar-rich-text'}>
      {node.type === 'doc' ? node.content?.map(renderNode) : renderNode(node, 0)}
    </div>
  )
}
