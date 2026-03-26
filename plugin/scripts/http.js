async function postEvent(serverUrl, teamToken, event) {
  try {
    const res = await fetch(`${serverUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Team-Token': teamToken },
      body: JSON.stringify(event),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function postVerify(serverUrl, teamToken, user) {
  try {
    const res = await fetch(`${serverUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Team-Token': teamToken },
      body: JSON.stringify({ user }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { postEvent, postVerify };
