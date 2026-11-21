import { sanitizeDocRead } from '../access'
import type { DocStatus } from '../client/system-fields'
import type {
  CollectionConfig,
  Config,
  GlobalConfig,
  WebhookConfig,
  WebhookEvent,
} from '../config/types'
import type { DocumentData } from '../database/adapter'
import { projectCanonicalDoc } from '../operations/locale'
import { deliverWebhook, type DeliverWebhookArgs } from './deliver'
import type { WebhookAction, WebhookDeliveryResult, WebhookPayload } from './types'

export interface TargetWebhook {
  url: string
  events: readonly WebhookEvent[]
  secret?: string
  includeDoc?: boolean
  overrideAccess?: boolean
}

export interface DispatchWebhooksArgs {
  config?: Config
  collection?: CollectionConfig
  global?: GlobalConfig
  event: WebhookAction
  doc: DocumentData
  previousDoc?: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  autosave?: boolean
  locale?: string
  options?: Partial<Omit<DeliverWebhookArgs, 'url' | 'payload' | 'secret'>>
}

const pendingWebhooks = new Set<Promise<unknown>>()

/**
 * Awaits all pending background webhook deliveries. Useful in tests and graceful shutdowns.
 */
export async function drainPendingWebhooks(): Promise<void> {
  while (pendingWebhooks.size > 0) {
    await Promise.all(Array.from(pendingWebhooks))
  }
}

/**
 * Clears pending webhook tracking.
 */
export function resetPendingWebhooks(): void {
  pendingWebhooks.clear()
}

function matchesDraftSave(events: readonly WebhookEvent[], action: WebhookAction): boolean {
  if (action === 'create') {
    return events.includes('create') || events.includes('change')
  }
  if (action === 'update') {
    return events.includes('update') || events.includes('change')
  }
  return false
}

function matchesChangeAction(action: WebhookAction): boolean {
  return (
    action === 'create' || action === 'update' || action === 'publish' || action === 'unpublish'
  )
}

export function matchesEvent(
  events: readonly WebhookEvent[],
  action: WebhookAction,
  status?: DocStatus,
): boolean {
  if (action === 'delete') {
    return events.includes('delete')
  }

  if (status === 'draft' && action !== 'publish' && action !== 'unpublish') {
    return matchesDraftSave(events, action)
  }

  if (events.includes(action)) {
    return true
  }

  if (events.includes('change') && matchesChangeAction(action)) {
    return true
  }

  return false
}

function matchesCollection(webhook: WebhookConfig, collectionSlug: string): boolean {
  if (webhook.collections === '*') return true
  if (Array.isArray(webhook.collections)) {
    return webhook.collections.includes(collectionSlug)
  }
  // If neither collections nor globals specified on root webhook, default to matching all collections
  return !webhook.collections && !webhook.globals
}

function matchesGlobal(webhook: WebhookConfig, globalSlug: string): boolean {
  if (webhook.globals === '*') return true
  if (Array.isArray(webhook.globals)) {
    return webhook.globals.includes(globalSlug)
  }
  return false
}

function resolveCollectionCandidates(
  collection: CollectionConfig,
  config?: Config,
): TargetWebhook[] {
  const candidates: TargetWebhook[] = []
  if (collection.webhooks) {
    candidates.push(...collection.webhooks)
  }
  if (config?.webhooks) {
    for (const w of config.webhooks) {
      if (matchesCollection(w, collection.slug)) {
        candidates.push(w)
      }
    }
  }
  return candidates
}

function resolveGlobalCandidates(global: GlobalConfig, config?: Config): TargetWebhook[] {
  const candidates: TargetWebhook[] = []
  if (global.webhooks) {
    candidates.push(...global.webhooks)
  }
  if (config?.webhooks) {
    for (const w of config.webhooks) {
      if (matchesGlobal(w, global.slug)) {
        candidates.push(w)
      }
    }
  }
  return candidates
}

export function resolveMatchingWebhooks(args: {
  config?: Config
  collection?: CollectionConfig
  global?: GlobalConfig
  action: WebhookAction
  status?: DocStatus
}): TargetWebhook[] {
  const candidates: TargetWebhook[] = []
  if (args.collection) {
    candidates.push(...resolveCollectionCandidates(args.collection, args.config))
  }
  if (args.global) {
    candidates.push(...resolveGlobalCandidates(args.global, args.config))
  }
  return candidates.filter((target) => matchesEvent(target.events, args.action, args.status))
}

export function buildWebhookPayload(args: {
  event: WebhookAction
  collection?: CollectionConfig
  global?: GlobalConfig
  doc: DocumentData
  status?: DocStatus
  previousStatus?: DocStatus
  includeDoc?: boolean
  locale?: string
}): WebhookPayload {
  const payload: WebhookPayload = {
    event: args.event,
    timestamp: new Date().toISOString(),
  }

  if (args.collection) {
    payload.collection = args.collection.slug
    if (typeof args.doc.id === 'number') {
      payload.id = args.doc.id
    }
  }

  if (args.global) {
    payload.global = args.global.slug
  }

  if (args.status !== undefined) {
    payload.status = args.status
  }

  if (args.previousStatus !== undefined) {
    payload.previousStatus = args.previousStatus
  }

  if (args.locale !== undefined) {
    payload.locale = args.locale
  }

  if (args.includeDoc) {
    payload.doc = args.doc
  }

  return payload
}

function resolveFields(args: DispatchWebhooksArgs) {
  if (args.collection) return args.collection.fields
  if (args.global) return args.global.fields
  return {}
}

function projectDocForLocale(
  doc: DocumentData,
  fields: CollectionConfig['fields'],
  locale?: string,
  config?: Config,
): DocumentData {
  if (!locale || locale === 'all' || !config?.localization) {
    return doc
  }
  return projectCanonicalDoc(doc, fields ?? {}, {
    locale,
    fallbackLocale: config.localization.fallback === false ? false : undefined,
    defaultLocale: config.localization.defaultLocale,
  })
}

async function resolveTargetDoc(
  target: TargetWebhook,
  args: DispatchWebhooksArgs,
): Promise<DocumentData> {
  if (!target.includeDoc) {
    return args.doc
  }
  const fields = resolveFields(args)
  let docToSend = projectDocForLocale(args.doc, fields, args.locale, args.config)
  if (target.overrideAccess === false) {
    docToSend = await sanitizeDocRead(fields, docToSend, null, {
      id: docToSend.id as string | number | undefined,
      doc: docToSend,
      locale: args.locale,
    })
  }
  return docToSend
}

async function prepareTargetDelivery(
  target: TargetWebhook,
  args: DispatchWebhooksArgs,
): Promise<WebhookDeliveryResult> {
  const docToSend = await resolveTargetDoc(target, args)

  const payload = buildWebhookPayload({
    event: args.event,
    collection: args.collection,
    global: args.global,
    doc: docToSend,
    status: args.status,
    previousStatus: args.previousStatus,
    includeDoc: target.includeDoc,
    locale: args.locale,
  })

  return deliverWebhook({
    url: target.url,
    payload,
    secret: target.secret,
    ...args.options,
  })
}

/**
 * Dispatches outgoing webhooks for a document event.
 * Runs asynchronously post-commit. Autosave requests are ignored.
 */
export function dispatchWebhooks(args: DispatchWebhooksArgs): Promise<WebhookDeliveryResult[]> {
  if (args.autosave) {
    return Promise.resolve([])
  }

  const matching = resolveMatchingWebhooks({
    config: args.config,
    collection: args.collection,
    global: args.global,
    action: args.event,
    status: args.status,
  })

  if (matching.length === 0) {
    return Promise.resolve([])
  }

  let deliveries: Promise<WebhookDeliveryResult>[]
  try {
    deliveries = matching.map((target) => prepareTargetDelivery(target, args))
  } catch (err: unknown) {
    const logger = args.options?.logger ?? console.error
    logger('[Webhooks] Delivery batch failed:', err)
    return Promise.resolve([])
  }

  const batchPromise = Promise.all(deliveries).catch((err: unknown) => {
    const logger = args.options?.logger ?? console.error
    logger('[Webhooks] Delivery batch failed:', err)
    return []
  })
  pendingWebhooks.add(batchPromise)
  void batchPromise.finally(() => {
    pendingWebhooks.delete(batchPromise)
  })

  return batchPromise
}
