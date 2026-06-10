'use strict';

/**
 * Unit tests for the Claude chat utility (Task 17.1).
 *
 * The tests mock `axios` so no real network call is made and so the
 * "axios was/wasn't called" assertions are meaningful. They cover the
 * pieces of the contract that the AI advisor controller relies on:
 *
 *   - Successful response → `{ ok: true, reply }` with the trimmed
 *     `content[0].text` from Claude's messages-API payload (R18.3).
 *   - Network errors, timeouts, non-2xx, missing fields, malformed
 *     payloads, and Claude returning no text content all collapse to
 *     `{ ok: false }` so the controller has a single unavailability
 *     signal to react to (R18.6).
 *   - Empty / whitespace-only / non-string apiKey, systemContext, or
 *     userMessage short-circuits to `{ ok: false }` without a network
 *     call.
 *   - The API key is sent as the `x-api-key` header and never echoed
 *     into a return value, even on failure (R18.6).
 */

jest.mock('axios');

const axios = require('axios');

const {
  chat,
  API_TIMEOUT_MS,
  API_URL,
  API_VERSION,
  MODEL,
  MAX_TOKENS,
  extractReply,
  buildRequestBody,
} = require('./claude');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('utils/claude', () => {
  describe('constants', () => {
    test('exposes a 30-second timeout (R18.3)', () => {
      expect(API_TIMEOUT_MS).toBe(30_000);
    });

    test('targets the Anthropic messages endpoint', () => {
      expect(API_URL).toBe('https://api.anthropic.com/v1/messages');
    });

    test('pins the Anthropic API version', () => {
      expect(API_VERSION).toBe('2023-06-01');
    });

    test('pins a specific Claude model revision', () => {
      expect(MODEL).toBe('claude-3-5-sonnet-20241022');
    });

    test('caps reply tokens', () => {
      expect(MAX_TOKENS).toBe(1024);
    });
  });

  describe('buildRequestBody', () => {
    test('produces the messages-API shape with system context and a single user turn', () => {
      const body = buildRequestBody('snap', 'hello');
      expect(body).toEqual({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: 'snap',
        messages: [{ role: 'user', content: 'hello' }],
      });
    });
  });

  describe('extractReply', () => {
    test('returns trimmed text from the first text-typed content block', () => {
      expect(
        extractReply({
          content: [{ type: 'text', text: '  Hi there!  ' }],
        })
      ).toBe('Hi there!');
    });

    test('skips non-text blocks and returns the first text-typed block', () => {
      expect(
        extractReply({
          content: [
            { type: 'tool_use', name: 'foo' },
            { type: 'text', text: 'real reply' },
          ],
        })
      ).toBe('real reply');
    });

    test.each([
      ['null body', null],
      ['undefined body', undefined],
      ['non-object body', 'oops'],
      ['missing content', { id: 'x' }],
      ['empty content array', { content: [] }],
      ['no text block', { content: [{ type: 'tool_use' }] }],
      ['non-string text', { content: [{ type: 'text', text: 42 }] }],
      ['empty text', { content: [{ type: 'text', text: '' }] }],
      ['whitespace-only text', { content: [{ type: 'text', text: '   ' }] }],
    ])('returns null for %s', (_label, body) => {
      expect(extractReply(body)).toBeNull();
    });
  });

  describe('chat: input validation short-circuits', () => {
    test.each([
      ['missing apiKey', { systemContext: 's', userMessage: 'm' }],
      ['empty apiKey', { apiKey: '', systemContext: 's', userMessage: 'm' }],
      ['whitespace apiKey', { apiKey: '   ', systemContext: 's', userMessage: 'm' }],
      ['non-string apiKey', { apiKey: 123, systemContext: 's', userMessage: 'm' }],
      ['missing systemContext', { apiKey: 'k', userMessage: 'm' }],
      ['empty systemContext', { apiKey: 'k', systemContext: '', userMessage: 'm' }],
      ['missing userMessage', { apiKey: 'k', systemContext: 's' }],
      ['empty userMessage', { apiKey: 'k', systemContext: 's', userMessage: '' }],
      ['whitespace userMessage', { apiKey: 'k', systemContext: 's', userMessage: '  ' }],
    ])('returns { ok: false } and makes no network call for %s', async (_label, args) => {
      const result = await chat(args);
      expect(result).toEqual({ ok: false });
      expect(axios.post).not.toHaveBeenCalled();
    });

    test('returns { ok: false } when called with no arguments at all', async () => {
      expect(await chat()).toEqual({ ok: false });
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('chat: successful response (R18.3)', () => {
    test('returns the trimmed reply on a well-formed payload', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Diversify your portfolio.' }],
        },
      });

      const result = await chat({
        apiKey: 'sk-test',
        systemContext: 'snapshot',
        userMessage: 'how am I doing?',
      });

      expect(result).toEqual({ ok: true, reply: 'Diversify your portfolio.' });
      expect(axios.post).toHaveBeenCalledTimes(1);

      const [url, body, opts] = axios.post.mock.calls[0];
      expect(url).toBe(API_URL);
      expect(body).toEqual({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: 'snapshot',
        messages: [{ role: 'user', content: 'how am I doing?' }],
      });
      expect(opts.timeout).toBe(API_TIMEOUT_MS);
      expect(opts.headers).toEqual({
        'x-api-key': 'sk-test',
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      });
    });

    test('honors a custom timeoutMs override', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { content: [{ type: 'text', text: 'ok' }] },
      });

      await chat({
        apiKey: 'sk-test',
        systemContext: 'snapshot',
        userMessage: 'hi',
        timeoutMs: 1234,
      });

      expect(axios.post.mock.calls[0][2].timeout).toBe(1234);
    });

    test('uses an injected client when provided (no real axios call)', async () => {
      const fakeClient = {
        post: jest.fn().mockResolvedValue({
          status: 200,
          data: { content: [{ type: 'text', text: 'injected' }] },
        }),
      };

      const result = await chat({
        apiKey: 'sk-test',
        systemContext: 's',
        userMessage: 'm',
        client: fakeClient,
      });

      expect(result).toEqual({ ok: true, reply: 'injected' });
      expect(fakeClient.post).toHaveBeenCalledTimes(1);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('chat: failures collapse to { ok: false } (R18.6)', () => {
    test('returns { ok: false } on axios timeout (ECONNABORTED)', async () => {
      const err = new Error('timeout of 30000ms exceeded');
      err.code = 'ECONNABORTED';
      axios.post.mockRejectedValueOnce(err);

      expect(
        await chat({ apiKey: 'sk-test', systemContext: 's', userMessage: 'm' })
      ).toEqual({ ok: false });
    });

    test('returns { ok: false } on a generic network error', async () => {
      axios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      expect(
        await chat({ apiKey: 'sk-test', systemContext: 's', userMessage: 'm' })
      ).toEqual({ ok: false });
    });

    test('returns { ok: false } on a non-2xx (axios rejects by default)', async () => {
      const err = new Error('Request failed with status code 401');
      err.response = { status: 401, data: { type: 'error' } };
      axios.post.mockRejectedValueOnce(err);

      expect(
        await chat({ apiKey: 'sk-test', systemContext: 's', userMessage: 'm' })
      ).toEqual({ ok: false });
    });

    test('returns { ok: false } when the response body has no usable text', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { content: [{ type: 'text', text: '   ' }] },
      });

      expect(
        await chat({ apiKey: 'sk-test', systemContext: 's', userMessage: 'm' })
      ).toEqual({ ok: false });
    });

    test('does not throw for any failure mode', async () => {
      axios.post.mockRejectedValueOnce(
        Object.assign(new Error('boom'), { code: 'ETIMEDOUT' })
      );
      await expect(
        chat({ apiKey: 'sk-test', systemContext: 's', userMessage: 'm' })
      ).resolves.toEqual({ ok: false });
    });
  });

  describe('chat: API key never appears in the return value (R18.6)', () => {
    test('successful response shape contains only { ok, reply }', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { content: [{ type: 'text', text: 'reply' }] },
      });

      const apiKey = 'sk-secret-123-do-not-leak';
      const result = await chat({ apiKey, systemContext: 's', userMessage: 'm' });

      expect(result).toEqual({ ok: true, reply: 'reply' });
      expect(JSON.stringify(result)).not.toContain(apiKey);
    });

    test('failure response shape never carries the API key', async () => {
      const apiKey = 'sk-secret-456-do-not-leak';
      const err = new Error(`Request to https://example/?key=${apiKey} failed`);
      err.code = 'ECONNABORTED';
      // axios sometimes attaches the request config (which contains
      // headers) to its errors. Verify our helper never propagates it.
      err.config = { headers: { 'x-api-key': apiKey } };
      axios.post.mockRejectedValueOnce(err);

      const result = await chat({ apiKey, systemContext: 's', userMessage: 'm' });

      expect(result).toEqual({ ok: false });
      expect(JSON.stringify(result)).not.toContain(apiKey);
    });
  });
});
