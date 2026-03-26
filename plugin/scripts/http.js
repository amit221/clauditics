const http = require('http');
const https = require('https');

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, res => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
    });
    req.on('error', err => reject(err));
    req.write(body);
    req.end();
  });
}

async function postEvent(serverUrl, teamToken, event) {
  try {
    return await post(`${serverUrl}/events`, { 'X-Team-Token': teamToken }, JSON.stringify(event));
  } catch (err) {
    return { ok: false, error: err.message || err.code };
  }
}

async function postVerify(serverUrl, teamToken, user) {
  try {
    return await post(`${serverUrl}/verify`, { 'X-Team-Token': teamToken }, JSON.stringify({ user }));
  } catch (err) {
    return { ok: false, error: err.message || err.code };
  }
}

module.exports = { postEvent, postVerify };
