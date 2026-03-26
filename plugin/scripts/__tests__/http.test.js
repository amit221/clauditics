const http = require('http');
const { postEvent, postVerify } = require('../http');

const TOKEN = 'test-token';

function startTestServer(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

describe('http', () => {
  test('postEvent sends correct body and header', async () => {
    let received;
    const { server, port } = await startTestServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        received = { url: req.url, headers: req.headers, body };
        res.writeHead(201);
        res.end();
      });
    });

    const event = { session_id: 'abc', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T00:00:00.000Z' };
    const result = await postEvent(`http://localhost:${port}`, TOKEN, event);

    expect(result.ok).toBe(true);
    expect(received.url).toBe('/events');
    expect(received.headers['x-team-token']).toBe(TOKEN);
    expect(received.headers['content-type']).toBe('application/json');
    expect(JSON.parse(received.body)).toEqual(event);

    server.close();
  });

  test('postEvent returns { ok: false } on network error', async () => {
    const result = await postEvent('http://localhost:19999', TOKEN, {});
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('postVerify sends user in body', async () => {
    let received;
    const { server, port } = await startTestServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        received = { url: req.url, body };
        res.writeHead(200);
        res.end();
      });
    });

    await postVerify(`http://localhost:${port}`, TOKEN, 'Dan');

    expect(received.url).toBe('/verify');
    expect(JSON.parse(received.body)).toEqual({ user: 'Dan' });

    server.close();
  });

  test('postVerify returns { ok: false } on 401', async () => {
    const { server, port } = await startTestServer((_req, res) => {
      _req.resume();
      res.writeHead(401);
      res.end();
    });

    const result = await postVerify(`http://localhost:${port}`, TOKEN, 'Dan');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);

    server.close();
  });
});
