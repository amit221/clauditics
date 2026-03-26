const path = require('path');
// Use in-memory DB for tests
process.env.CLAUDITICS_DB = ':memory:';

const { initDb, insertEvent, insertMember, getStats } = require('../db');

describe('db', () => {
  let db;

  beforeEach(() => {
    db = initDb();
  });

  afterEach(() => {
    db.close();
  });

  test('insertEvent adds a row to events table', () => {
    const event = { session_id: 'abc', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T00:00:00.000Z' };
    insertEvent(db, event);
    const rows = db.prepare('SELECT * FROM events').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe('Dan');
  });

  test('insertMember upserts — no error on duplicate', () => {
    insertMember(db, 'Dan');
    insertMember(db, 'Dan'); // should not throw
    const rows = db.prepare('SELECT * FROM members').all();
    expect(rows).toHaveLength(1);
  });

  test('getStats returns correct byUser aggregation', () => {
    insertEvent(db, { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
    insertEvent(db, { session_id: 'b', user: 'Dan', model: 'sonnet', input_tokens: 200, output_tokens: 80, timestamp: '2026-03-25T11:00:00.000Z' });
    insertEvent(db, { session_id: 'c', user: 'Alice', model: 'opus', input_tokens: 300, output_tokens: 100, timestamp: '2026-03-25T12:00:00.000Z' });

    const stats = getStats(db);
    const dan = stats.byUser.find(u => u.user === 'Dan');
    expect(dan.input_tokens).toBe(300);
    expect(dan.output_tokens).toBe(130);
    expect(dan.sessions).toBe(2);
    expect(stats.byUser).toHaveLength(2);
  });

  test('getStats returns correct byDay aggregation', () => {
    insertEvent(db, { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
    const stats = getStats(db);
    expect(stats.byDay[0].date).toBe('2026-03-25');
    expect(stats.byDay[0].input_tokens).toBe(100);
    expect(stats.byDay[0].sessions).toBe(1);
  });

  test('getStats returns correct byModel aggregation', () => {
    insertEvent(db, { session_id: 'a', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
    const stats = getStats(db);
    expect(stats.byModel[0].model).toBe('claude-sonnet-4-6');
    expect(stats.byModel[0].sessions).toBe(1);
  });
});
