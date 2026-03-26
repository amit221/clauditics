const { postEvent, postVerify } = require('../http');

const SERVER_URL = 'http://localhost:3000';
const TOKEN = 'test-token';

describe('http', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  test('postEvent sends correct body and header', async () => {
    const event = { session_id: 'abc', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T00:00:00.000Z' };
    const result = await postEvent(SERVER_URL, TOKEN, event);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Team-Token': TOKEN, 'Content-Type': 'application/json' }),
        body: JSON.stringify(event),
      })
    );
  });

  test('postEvent returns { ok: false } on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await postEvent(SERVER_URL, TOKEN, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch('ECONNREFUSED');
  });

  test('postVerify sends user in body', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await postVerify(SERVER_URL, TOKEN, 'Dan');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ user: 'Dan' }),
      })
    );
  });

  test('postVerify returns { ok: false } on 401', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const result = await postVerify(SERVER_URL, TOKEN, 'Dan');
    expect(result.ok).toBe(false);
  });
});
