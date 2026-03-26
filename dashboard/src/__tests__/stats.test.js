process.env.CLAUDITICS_DB = ':memory:';
jest.mock('../config', () => ({ getTeamToken: () => 'tok', getPort: () => 3000 }));

const express = require('express');
const request = require('supertest');
const { initDb, insertEvent } = require('../db');
const statsRouter = require('../routes/stats');

let app, db;

beforeEach(() => {
  db = initDb();
  app = express();
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use(statsRouter);
  insertEvent(db, { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
  insertEvent(db, { session_id: 'b', user: 'Alice', model: 'opus', input_tokens: 200, output_tokens: 80, timestamp: '2026-03-25T11:00:00.000Z' });
});

afterEach(() => db.close());

describe('GET /api/stats', () => {
  test('returns byUser, byModel, byDay with valid token', async () => {
    const res = await request(app).get('/api/stats').set('X-Team-Token', 'tok');
    expect(res.status).toBe(200);
    expect(res.body.byUser).toHaveLength(2);
    expect(res.body.byModel).toHaveLength(2);
    expect(res.body.byDay).toHaveLength(1);
  });

  test('401 without token', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(401);
  });
});
