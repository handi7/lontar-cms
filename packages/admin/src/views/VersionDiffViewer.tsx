import { useState } from 'react'
import type {
  ArrayFieldDiff,
  ArrayItemDiff,
  BlocksFieldDiff,
  ChangeType,
  ClientField,
  DocumentDiff,
  FieldDiff,
  GroupFieldDiff,
  PrimitiveFieldDiff,
} from '@lontar/core/client'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'

export interface VersionDiffViewerProps {
  diff: DocumentDiff
  fields: ClientField[]
  oldLabel?: string
  newLabel?: string
}

function getChangeBadgeVariant(change: ChangeType): {
  label: string
  className: string
} {
  switch (change) {
    case 'added':
      return {
        label: 'Added',
        className: 'lt:border-success-border lt:bg-success-bg lt:text-success-text',
      }
    case 'removed':
      return {
        label: 'Removed',
        className: 'lt:border-destructive/30 lt:bg-error-bg lt:text-destructive',
      }
    case 'modified':
      return {
        label: 'Modified',
        className: 'lt:border-primary/30 lt:bg-accent lt:text-accent-foreground',
      }
    case 'unchanged':
    default:
      return {
        label: 'Unchanged',
        className: 'lt:border-transparent lt:bg-muted/50 lt:text-muted-foreground',
      }
  }
}

interface ChangeBadgeProps {
  change: ChangeType
}

function ChangeBadge({ change }: ChangeBadgeProps) {
  const { label, className } = getChangeBadgeVariant(change)
  return (
    <span
      className={cn(
        'lt:inline-flex lt:items-center lt:rounded-full lt:border lt:px-2 lt:py-0.5 lt:text-[0.6875rem] lt:font-medium',
        className,
      )}
      data-change={change}
    >
      {label}
    </span>
  )
}

function formatPrimitiveValue(val: unknown): string {
  if (val === null || val === undefined) return '(empty)'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'string' || typeof val === 'number') return String(val)
  return JSON.stringify(val)
}

function extractRichTextSummary(val: unknown): string {
  if (typeof val === 'string') return val
  if (typeof val !== 'object' || val === null) return '(empty)'
  const texts: string[] = []
  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return
    const candidate = node as { text?: unknown; content?: unknown }
    if (typeof candidate.text === 'string') texts.push(candidate.text)
    if (Array.isArray(candidate.content)) {
      for (const child of candidate.content) walk(child)
    }
  }
  walk(val)
  return texts.join(' ') || '(empty rich text)'
}

function formatUploadSummary(val: unknown): string {
  if (val === null || val === undefined) return '(none)'
  if (typeof val === 'object') {
    const doc = val as Record<string, unknown>
    const name = typeof doc.filename === 'string' ? doc.filename : undefined
    const size = typeof doc.filesize === 'number' ? `${Math.round(doc.filesize / 1024)} KB` : ''
    return [name, size].filter(Boolean).join(' • ') || '(file)'
  }
  if (typeof val === 'string' || typeof val === 'number') {
    return `File #${String(val)}`
  }
  return '(file)'
}

function renderFormattedValue(fieldType: string, val: unknown): string {
  if (fieldType === 'richText') {
    return extractRichTextSummary(val)
  }
  if (fieldType === 'upload') {
    return formatUploadSummary(val)
  }
  return formatPrimitiveValue(val)
}

interface PrimitiveDiffRowProps {
  diff: PrimitiveFieldDiff
  fieldType: string
  oldLabel: string
  newLabel: string
}

function PrimitiveDiffRow({ diff, fieldType, oldLabel, newLabel }: PrimitiveDiffRowProps) {
  if (diff.change === 'unchanged') {
    return (
      <div className="lt:text-xs lt:text-muted-foreground lt:bg-muted/20 lt:p-2 lt:rounded">
        {renderFormattedValue(fieldType, diff.value)}
      </div>
    )
  }

  const oldFormatted = renderFormattedValue(fieldType, diff.oldValue)
  const newFormatted = renderFormattedValue(fieldType, diff.value)

  return (
    <div className="lt:grid lt:grid-cols-1 lt:md:grid-cols-2 lt:gap-2 lt:text-xs">
      <div className="lt:rounded lt:border lt:p-2 lt:bg-card">
        <span className="lt:block lt:text-[0.6875rem] lt:font-medium lt:text-muted-foreground lt:mb-1">
          {oldLabel}
        </span>
        <div
          className={cn(
            'lt:break-words',
            diff.change === 'removed' || diff.change === 'modified'
              ? 'lt:text-destructive lt:line-through lt:bg-error-bg/30 lt:p-1 lt:rounded'
              : 'lt:text-muted-foreground',
          )}
        >
          {oldFormatted}
        </div>
      </div>
      <div className="lt:rounded lt:border lt:p-2 lt:bg-card">
        <span className="lt:block lt:text-[0.6875rem] lt:font-medium lt:text-muted-foreground lt:mb-1">
          {newLabel}
        </span>
        <div
          className={cn(
            'lt:break-words',
            diff.change === 'added' || diff.change === 'modified'
              ? 'lt:text-success-text lt:font-medium lt:bg-success-bg/40 lt:p-1 lt:rounded'
              : 'lt:text-foreground',
          )}
        >
          {newFormatted}
        </div>
      </div>
    </div>
  )
}

interface GroupDiffViewProps {
  diff: GroupFieldDiff
  subfields: ClientField[]
  oldLabel: string
  newLabel: string
}

function GroupDiffView({ diff, subfields, oldLabel, newLabel }: GroupDiffViewProps) {
  const [expanded, setExpanded] = useState(diff.hasChanges)

  return (
    <div className="lt:rounded-md lt:border lt:border-border lt:bg-card lt:p-3 lt:flex lt:flex-col lt:gap-2">
      <button
        type="button"
        className="lt:flex lt:items-center lt:justify-between lt:w-full lt:text-xs lt:font-medium lt:text-foreground lt:cursor-pointer"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} nested group fields`}
      >
        <span className="lt:flex lt:items-center lt:gap-1.5">
          {expanded ? (
            <ChevronDown className="lt:size-3.5" />
          ) : (
            <ChevronRight className="lt:size-3.5" />
          )}
          <span>Nested group fields ({Object.keys(diff.fields).length})</span>
        </span>
        <ChangeBadge change={diff.hasChanges ? 'modified' : 'unchanged'} />
      </button>

      {expanded && (
        <div className="lt:pt-2 lt:border-t lt:border-border lt:flex lt:flex-col lt:gap-2.5">
          {subfields.map((subfield) => {
            const fieldDiff = diff.fields[subfield.name]
            if (!fieldDiff) return null
            return (
              <FieldDiffItem
                key={subfield.name}
                field={subfield}
                diff={fieldDiff}
                oldLabel={oldLabel}
                newLabel={newLabel}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function resolveRowLabel(item: ArrayItemDiff): string {
  if (item.blockType) return `block ${item.blockType}`
  if (typeof item.newIndex === 'number') return `row ${item.newIndex + 1}`
  if (typeof item.oldIndex === 'number') return `row ${item.oldIndex + 1}`
  return 'row 1'
}

interface ReorderBadgeProps {
  oldIndex?: number
  newIndex?: number
}

function ReorderBadge({ oldIndex = 0, newIndex = 0 }: ReorderBadgeProps) {
  return (
    <span className="lt:text-[0.625rem] lt:text-muted-foreground lt:bg-muted lt:px-1.5 lt:py-0.5 lt:rounded">
      reordered ({oldIndex} → {newIndex})
    </span>
  )
}

interface ArrayItemSubfieldsProps {
  diffs: Record<string, FieldDiff>
  subfields: ClientField[]
  oldLabel: string
  newLabel: string
}

function ArrayItemSubfields({ diffs, subfields, oldLabel, newLabel }: ArrayItemSubfieldsProps) {
  return (
    <div className="lt:pt-2 lt:border-t lt:border-border lt:flex lt:flex-col lt:gap-2">
      {subfields.map((subfield) => {
        const fieldDiff = diffs[subfield.name]
        if (!fieldDiff) return null
        return (
          <FieldDiffItem
            key={subfield.name}
            field={subfield}
            diff={fieldDiff}
            oldLabel={oldLabel}
            newLabel={newLabel}
          />
        )
      })}
    </div>
  )
}

interface ArrayItemDiffViewProps {
  item: ArrayItemDiff
  subfields?: ClientField[]
  oldLabel: string
  newLabel: string
}

function ArrayItemDiffView({ item, subfields, oldLabel, newLabel }: ArrayItemDiffViewProps) {
  const [expanded, setExpanded] = useState(item.change !== 'unchanged')
  const itemTag = item.blockType ? `[${item.blockType}] #${item.id}` : `Row #${item.id}`
  const labelTarget = resolveRowLabel(item)

  return (
    <div className="lt:rounded lt:border lt:border-border lt:p-2.5 lt:flex lt:flex-col lt:gap-2 lt:bg-card">
      <div className="lt:flex lt:items-center lt:justify-between lt:text-xs">
        <span className="lt:flex lt:items-center lt:gap-1.5 lt:font-medium lt:text-foreground">
          {item.diffs && (
            <button
              type="button"
              className="lt:cursor-pointer"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} changes in ${labelTarget}`}
            >
              {expanded ? (
                <ChevronDown className="lt:size-3.5" />
              ) : (
                <ChevronRight className="lt:size-3.5" />
              )}
            </button>
          )}
          <span>{itemTag}</span>
          {item.orderChanged && <ReorderBadge oldIndex={item.oldIndex} newIndex={item.newIndex} />}
        </span>
        <ChangeBadge change={item.change} />
      </div>

      {expanded && item.diffs && subfields && (
        <ArrayItemSubfields
          diffs={item.diffs}
          subfields={subfields}
          oldLabel={oldLabel}
          newLabel={newLabel}
        />
      )}
    </div>
  )
}

interface ArrayDiffViewProps {
  diff: ArrayFieldDiff
  subfields: ClientField[]
  oldLabel: string
  newLabel: string
}

function ArrayDiffView({ diff, subfields, oldLabel, newLabel }: ArrayDiffViewProps) {
  return (
    <div className="lt:flex lt:flex-col lt:gap-2">
      {diff.items.map((item) => (
        <ArrayItemDiffView
          key={item.id}
          item={item}
          subfields={subfields}
          oldLabel={oldLabel}
          newLabel={newLabel}
        />
      ))}
    </div>
  )
}

interface BlocksDiffViewProps {
  diff: BlocksFieldDiff
  field: ClientField
  oldLabel: string
  newLabel: string
}

function BlocksDiffView({ diff, field, oldLabel, newLabel }: BlocksDiffViewProps) {
  const blocks = field.type === 'blocks' ? field.blocks : []

  return (
    <div className="lt:flex lt:flex-col lt:gap-2">
      {diff.items.map((item) => {
        const blockDef = blocks.find((b) => b.slug === item.blockType)
        return (
          <ArrayItemDiffView
            key={item.id}
            item={item}
            subfields={blockDef?.fields}
            oldLabel={oldLabel}
            newLabel={newLabel}
          />
        )
      })}
    </div>
  )
}

interface FieldDiffItemProps {
  field: ClientField
  diff: FieldDiff
  oldLabel: string
  newLabel: string
}

function FieldDiffItem({ field, diff, oldLabel, newLabel }: FieldDiffItemProps) {
  const fieldTitle = field.label || field.name

  return (
    <div className="lt:flex lt:flex-col lt:gap-1.5 lt:border-b lt:border-border lt:pb-3 lt:last:border-b-0">
      <div className="lt:flex lt:items-center lt:justify-between">
        <span className="lt:text-xs lt:font-semibold lt:text-foreground">{fieldTitle}</span>
        {diff.type === 'primitive' && <ChangeBadge change={diff.change} />}
      </div>

      {diff.type === 'primitive' && (
        <PrimitiveDiffRow
          diff={diff}
          fieldType={field.type}
          oldLabel={oldLabel}
          newLabel={newLabel}
        />
      )}

      {diff.type === 'group' && field.type === 'group' && (
        <GroupDiffView
          diff={diff}
          subfields={field.fields}
          oldLabel={oldLabel}
          newLabel={newLabel}
        />
      )}

      {diff.type === 'array' && field.type === 'array' && (
        <ArrayDiffView
          diff={diff}
          subfields={field.fields}
          oldLabel={oldLabel}
          newLabel={newLabel}
        />
      )}

      {diff.type === 'blocks' && (
        <BlocksDiffView diff={diff} field={field} oldLabel={oldLabel} newLabel={newLabel} />
      )}
    </div>
  )
}

function formatStatusValue(val: unknown): string {
  return typeof val === 'string' ? val : ''
}

export function VersionDiffViewer({
  diff,
  fields,
  oldLabel = 'Previous',
  newLabel = 'Current',
}: VersionDiffViewerProps) {
  if (!diff.hasChanges) {
    return (
      <div className="lt:rounded-md lt:border lt:border-dashed lt:border-border lt:p-6 lt:text-center lt:text-xs lt:text-muted-foreground">
        No changes detected between these snapshots.
      </div>
    )
  }

  return (
    <div className="lt:flex lt:flex-col lt:gap-4 lt:overflow-y-auto">
      {diff.fields._status && diff.fields._status.type === 'primitive' && (
        <div className="lt:flex lt:items-center lt:justify-between lt:border-b lt:border-border lt:pb-2">
          <span className="lt:text-xs lt:font-semibold lt:text-foreground">Status (_status)</span>
          <div className="lt:flex lt:items-center lt:gap-2">
            <span className="lt:text-xs lt:text-muted-foreground">
              {formatStatusValue(diff.fields._status.oldValue)} →{' '}
              {formatStatusValue(diff.fields._status.value)}
            </span>
            <ChangeBadge change={diff.fields._status.change} />
          </div>
        </div>
      )}

      {fields.map((field) => {
        const fieldDiff = diff.fields[field.name]
        if (!fieldDiff) return null
        return (
          <FieldDiffItem
            key={field.name}
            field={field}
            diff={fieldDiff}
            oldLabel={oldLabel}
            newLabel={newLabel}
          />
        )
      })}
    </div>
  )
}
