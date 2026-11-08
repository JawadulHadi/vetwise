import { now } from '../clock.js';
import { config } from '../config.js';
import { newId, type Store } from '../store/store.js';
import type { OutboxItem } from './types.js';

export interface AlertRequest {
  to: string;
  body: string;
  channel: 'sms' | 'email' | 'voice';
  actor: string;
}

/**
 * The body is written to an outbox and can be POSTed to a webhook that may feed
 * an SMS or email gateway. Strip control characters and angle brackets so a
 * model-composed message cannot carry line breaks or markup into that pipeline.
 */
export function sanitiseAlertBody(body: string): string {
  return body
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Caregiver alerts go through an outbox first and are delivered by webhook when
 * one is configured. The outbox is the demo's visible audit trail and the
 * replayable record a real deployment would use after a failed send.
 */
export async function sendCaregiverAlert(store: Store, request: AlertRequest): Promise<OutboxItem> {
  const body = sanitiseAlertBody(request.body);
  const item: OutboxItem = {
    id: newId('alert'),
    createdAt: now().toISOString(),
    channel: request.channel,
    to: request.to,
    body,
    status: 'queued',
    createdBy: request.actor,
  };

  if (config.caregiverWebhookUrl) {
    try {
      const response = await fetch(config.caregiverWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: item.channel, to: item.to, body: item.body, from: request.actor }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`webhook returned HTTP ${response.status}`);
      item.status = 'sent';
      item.sentAt = now().toISOString();
    } catch (error) {
      item.status = 'failed';
      item.error = (error as Error).message;
    }
  }

  await store.mutate((db) => {
    db.outbox.unshift(item);
    db.audit.unshift({
      id: newId('audit'),
      at: item.createdAt,
      actor: request.actor,
      action: 'alert.queued',
      detail: `${item.channel} to ${item.to}: ${item.body.slice(0, 120)}`,
    });
  });

  return item;
}
