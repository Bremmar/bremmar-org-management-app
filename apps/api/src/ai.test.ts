import assert from 'node:assert/strict';
import test from 'node:test';
import { signAiPayload, verifyAiSignature } from './ai.js';

test('AI payload signatures validate the exact body and expire outside the replay window', () => {
  const secret = 'meeting-summary-test-secret';
  const body = JSON.stringify({ jobId: 'summary-1', attempt: 2, status: 'ready' });
  const timestamp = '1756890000000';
  const signature = signAiPayload(timestamp, body, secret);

  assert.equal(verifyAiSignature(body, timestamp, signature, secret, Number(timestamp) + 60_000), true);
  assert.equal(verifyAiSignature(`${body} `, timestamp, signature, secret, Number(timestamp) + 60_000), false);
  assert.equal(verifyAiSignature(body, timestamp, signature, 'wrong-secret', Number(timestamp) + 60_000), false);
  assert.equal(verifyAiSignature(body, timestamp, signature, secret, Number(timestamp) + 5 * 60_000 + 1), false);
});
