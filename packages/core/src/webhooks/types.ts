import type { DocStatus } from '../client/system-fields'
import type {
  CollectionWebhookConfig,
  GlobalWebhookConfig,
  WebhookConfig,
  WebhookEvent,
} from '../config/types'
import type { DocumentData } from '../database/adapter'

export type { CollectionWebhookConfig, GlobalWebhookConfig, WebhookConfig, WebhookEvent }

export type WebhookAction = 'publish' | 'unpublish' | 'create' | 'update' | 'delete'

export interface WebhookPayload {
  event: WebhookAction
  collection?: string
  global?: string
  id?: number
  status?: DocStatus
  previousStatus?: DocStatus
  timestamp: string
  doc?: DocumentData
}

export interface WebhookDeliveryResult {
  url: string
  success: boolean
  attempts: number
  statusCode?: number
  error?: string
}
