import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MeetingSummaryJobRecord } from './domain.js';

const MAX_CALLBACK_SKEW_MS = 5 * 60 * 1000;

function digest(timestamp: string, body: string, secret: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function signAiPayload(timestamp: string, body: string, secret: string) {
  return `sha256=${digest(timestamp, body, secret)}`;
}

export function verifyAiSignature(rawBody: string, timestampHeader: string | null, signatureHeader: string | null, secret: string, now = Date.now()) {
  if (!timestampHeader || !signatureHeader || !secret) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_CALLBACK_SKEW_MS) return false;
  const expected = Buffer.from(signAiPayload(timestampHeader, rawBody, secret));
  const supplied = Buffer.from(signatureHeader);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function dispatchMeetingSummaryJob(job: MeetingSummaryJobRecord): Promise<'dispatched' | 'disabled'> {
  const workerUrl = process.env.AI_WORKER_URL?.trim();
  const secret = process.env.AI_WORKER_SHARED_SECRET?.trim();
  if (!workerUrl || !secret) return 'disabled';

  const body = JSON.stringify({
    type: 'meeting-summary',
    jobId: job.id,
    meetingId: job.meetingId,
    teamId: job.teamId,
    environmentId: job.environmentId,
    attempt: job.attempt,
    source: job.source,
    context: job.contextSnapshot,
    callbackUrl: process.env.AI_CALLBACK_URL?.trim() || undefined,
  });
  const timestamp = String(Date.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AI-Timestamp': timestamp,
        'X-AI-Signature': signAiPayload(timestamp, body, secret),
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AI worker returned HTTP ${response.status}.`);
    return 'dispatched';
  } finally {
    clearTimeout(timeout);
  }
}
