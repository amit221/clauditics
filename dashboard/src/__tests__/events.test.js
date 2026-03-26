process.env.CLAUDITICS_DB = ':memory:';
jest.mock('../config', () => ({ getTeamToken: () => 'tok', getPort: () => 3000 }));

const express = require('express');
const request = require('supertest');
const { initDb } = require('../db');
const eventsRouter = require('../routes/events');

let app, db;

beforeEach(() => {
  db = initDb();
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); }); // inject db
  app.use(eventsRouter);
});

afterEach(() => db.close());

describe('POST /events', () => {
  const validEvent = { session_id: 'abc', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T00:00:00.000Z' };

  test('201 and saves to DB with valid token', async () => {
    const res = await request(app).post('/events').set('X-Team-Token', 'tok').send(validEvent);
    expect(res.status).toBe(201);
    const rows = db.prepare('SELECT * FROM events').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe('Dan');
  });

  test('401 with wrong token', async () => {
    const res = await request(app).post('/events').set('X-Team-Token', 'bad').send(validEvent);
    expect(res.status).toBe(401);
  });

  test('400 when required fields missing', async () => {
    const res = await request(app).post('/events').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    expect(res.status).toBe(400);
  });
});

describe('POST /verify', () => {
  test('200 and upserts member', async () => {
    const res = await request(app).post('/verify').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const members = db.prepare('SELECT * FROM members').all();
    expect(members).toHaveLength(1);
  });

  test('200 on second call for same user (idempotent)', async () => {
    await request(app).post('/verify').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    const res = await request(app).post('/verify').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    expect(res.status).toBe(200);
    const members = db.prepare('SELECT * FROM members').all();
    expect(members).toHaveLength(1);
  });
});
