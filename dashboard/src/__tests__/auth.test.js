const express = require('express');
const request = require('supertest');

// Mock config before requiring auth
jest.mock('../config', () => ({ getTeamToken: () => 'valid-token' }));

const auth = require('../middleware/auth');

const app = express();
app.use(auth);
app.get('/test', (req, res) => res.json({ ok: true }));

describe('auth middleware', () => {
  test('allows request with correct X-Team-Token', async () => {
    const res = await request(app).get('/test').set('X-Team-Token', 'valid-token');
    expect(res.status).toBe(200);
  });

  test('rejects request with wrong token', async () => {
    const res = await request(app).get('/test').set('X-Team-Token', 'wrong');
    expect(res.status).toBe(401);
  });

  test('rejects request with no token', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
  });
});
