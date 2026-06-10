'use strict';

/**
 * Claude (Anthropic) chat utility.
 *
 * Source of truth: design.md "AI_Advisor_Service (`controllers/aiController.js`)"
 * and Requirement 18 (AI Financial Advisor).
 *
 * Contract (mirrors the design and Requirement 18):
 *   - `chat({ apiKey, systemContext, userMessage, timeoutMs })` is the
 *     single entry point used by the AI advisor controller to obtain a
 *     reply from Claude given a user-scoped financial snapshot
 *     (`systemContext`) and the user's message.
 *   - The call MUST complete within 30 seconds; anything longer is
 *     treated as unavailability so the controller can route a generic
 *     503 through the uniform error handler instead of stalling the
 *     request (R18.3, R18.6).
 *   - Network errors, non-2xx responses, missing/malformed payloads,
 *     missing `apiKey`, and Claude returning no `text` content ALL
 *     collapse to `{ ok: false }` so the caller has a single, uniform
 *     unavailability signal to react to. The helper NEVER throws for an
 *     "unavailable" condition.
 *   - On success the function resolves to `{ ok: true, reply: <string> }`
 *     where `reply` is the trimmed text content from Claude's first
 *     content block — `response.data.content[0].text`.
 *   - The helper NEVER echoes the `apiKey` in any return value, error,
 *     log line, or thrown exception (R18.6). The key is only ever sent
 *     as the `x-api-key` request header to the Anthropic endpoint.
 *
 * Why the messages endpoint:
 *   - `https://api.anthropic.com/v1/messages` is Anthropic's standard
 *     chat endpoint. The request body shape is
 *     `{ model, max_tokens, system, messages }` and the response shape
 *     is `{ id, type, role, content: [{ type: 'text', text: '...' }, ...] }`.
 *   - The `system` field is the canonical place to put read-only
 *     context (the user's financial snapshot) — it is not part of the
 *     conversational turn-taking and is exactly what Requirement 18.3
 *     calls for ("send snapshot as system context + message").
 *
 * Validates: Requirements 18.3, 18.6.
 */

const axios = require('axios');

/**
 * Maximum time, in milliseconds, allowed for a single Claude request
 * before the helper gives up and signals unavailability (R18.3).
 *
 * @type {number}
 */
const API_TIMEOUT_MS = 30_000;

/**
 * Anthropic messages endpoint. Exported so tests can assert the helper
 * hits the right URL without relying on string matching against the
 * full URL.
 *
 * @type {string}
 */
const API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Anthropic API version pinned by Nuvault. Anthropic versions every
 * breaking change to the messages API so callers get stable behavior;
 * upgrading is a deliberate change to this constant.
 *
 * @type {string}
 */
const API_VERSION = '2023-06-01';

/**
 * Claude model used for AI advice. Pinned to a specific dated revision
 * so a silent provider rotation can't change Nuvault's behavior.
 *
 * @type {string}
 */
const MODEL = 'claude-3-5-sonnet-20241022';

/**
 * Maximum tokens Claude is allowed to emit in its reply. 1024 is a
 * generous budget for short-to-medium financial advice while keeping
 * the worst-case latency and cost bounded.
 *
 * @type {number}
 */
const MAX_TOKENS = 1024;

/**
 * Pull the first text block out of a Claude messages-API response
 * payload.
 *
 * Returns the trimmed text when the response body has the expected
 * shape AND that text is a non-empty string. Returns `null` for
 * anything else (missing fields, non-array content, no text-typed
 * blocks, empty/whitespace-only text, etc.) so the caller can collapse
 * those to a single unavailability signal.
 *
 * @param {unknown} body
 * @returns {string | null}
 */
function extractReply(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const content = /** @type {any} */ (body).content;
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }
  // Anthropic responses are an array of content blocks. We use the
  // first text-typed block (in practice there is exactly one for a
  // standard messages call). Skipping non-text blocks is defensive
  // against future tool-use blocks ever being interleaved in front of
  // the text block.
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type !== 'text') continue;
    if (typeof block.text !== 'string') continue;
    const trimmed = block.text.trim();
    if (trimmed.length === 0) continue;
    return trimmed;
  }
  return null;
}

/**
 * Build the request body sent to Anthropic. Extracted into a named
 * function so tests can assert the exact shape Nuvault sends.
 *
 * @param {string} systemContext
 * @param {string} userMessage
 * @returns {object}
 */
function buildRequestBody(systemContext, userMessage) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemContext,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  };
}

/**
 * Send `userMessage` to Claude with `systemContext` as read-only system
 * context, and resolve the reply.
 *
 * Behavior:
 *   1. Inputs are validated before any network call. A missing /
 *      empty / non-string `apiKey`, `systemContext`, or `userMessage`
 *      short-circuits to `{ ok: false }` — there is nothing meaningful
 *      to send, and treating it as unavailability lets the controller
 *      surface a uniform 503 (R18.6) without exposing why.
 *   2. The Anthropic messages endpoint is called with a 30-second
 *      timeout (R18.3). Headers `x-api-key`, `anthropic-version`, and
 *      `content-type: application/json` are set per the Anthropic API
 *      contract.
 *   3. The reply is read from `response.data.content[0].text`
 *      (Claude's standard messages-API shape).
 *   4. Timeouts (axios `ECONNABORTED` / `ETIMEDOUT`), other network
 *      errors, non-2xx responses, and any payload missing a usable
 *      reply all resolve to `{ ok: false }` (R18.6). The helper never
 *      throws for a "reply could not be obtained" condition, and never
 *      echoes the API key in any return value or thrown exception.
 *
 * @param {object} args
 * @param {string} args.apiKey         - Anthropic API key (sent as `x-api-key`).
 * @param {string} args.systemContext  - Read-only context (e.g. JSON snapshot).
 * @param {string} args.userMessage    - The user's chat message.
 * @param {number} [args.timeoutMs]    - Override the 30-second timeout (tests).
 * @param {typeof axios} [args.client] - Override axios client (tests).
 * @returns {Promise<{ ok: true, reply: string } | { ok: false }>}
 */
async function chat({ apiKey, systemContext, userMessage, timeoutMs, client } = {}) {
  if (
    typeof apiKey !== 'string' ||
    apiKey.trim() === '' ||
    typeof systemContext !== 'string' ||
    systemContext.trim() === '' ||
    typeof userMessage !== 'string' ||
    userMessage.trim() === ''
  ) {
    return { ok: false };
  }

  const http = client || axios;
  const timeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
      ? timeoutMs
      : API_TIMEOUT_MS;

  let response;
  try {
    response = await http.post(API_URL, buildRequestBody(systemContext, userMessage), {
      timeout,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
    });
  } catch (_err) {
    // Timeouts, DNS failures, connection resets, non-2xx (axios rejects
    // by default) — every transport-level error is unavailability per
    // R18.6. The error object itself is intentionally ignored: the
    // controller does not surface a reason to the client, and we MUST
    // NOT echo the API key (which axios may include in serialized
    // request configs on its error objects).
    return { ok: false };
  }

  const reply = extractReply(response && response.data);
  if (reply === null) {
    return { ok: false };
  }
  return { ok: true, reply };
}

module.exports = {
  chat,
  API_TIMEOUT_MS,
  API_URL,
  API_VERSION,
  MODEL,
  MAX_TOKENS,
  // Exposed for unit tests / advanced callers.
  extractReply,
  buildRequestBody,
};
