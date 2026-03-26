jest.mock('../config', () => ({ getTeamToken: () => 'abc123', getPort: () => 3000 }));

const express = require('express');
const request = require('supertest');
const installRouter = require('../routes/install');

const app = express();
app.use(installRouter);

describe('GET /install', () => {
  test('returns serverUrl and teamToken with valid query token', async () => {
    // For test, mock the server address by setting env
    process.env.CLAUDITICS_SERVER_URL = 'http://192.168.1.10:3000';
    const res = await request(app).get('/install?token=abc123');
    expect(res.status).toBe(200);
    expect(res.body.teamToken).toBe('abc123');
    expect(res.body.serverUrl).toBeDefined();
  });

  test('401 with wrong token', async () => {
    const res = await request(app).get('/install?token=wrong');
    expect(res.status).toBe(401);
  });
});
