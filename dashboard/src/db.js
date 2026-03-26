const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.CLAUDITICS_DB || path.join(os.homedir(), '.clauditics', 'clauditics.db');

function initDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user          TEXT NOT NULL,
      session_id    TEXT NOT NULL,
      model         TEXT NOT NULL,
      input_tokens  INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      timestamp     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      user        TEXT PRIMARY KEY,
      first_seen  TEXT NOT NULL
    );
  `);
  return db;
}

function insertEvent(db, event) {
  db.prepare(`
    INSERT INTO events (user, session_id, model, input_tokens, output_tokens, timestamp)
    VALUES (@user, @session_id, @model, @input_tokens, @output_tokens, @timestamp)
  `).run(event);
}

function insertMember(db, user) {
  db.prepare(`
    INSERT OR IGNORE INTO members (user, first_seen) VALUES (?, ?)
  `).run(user, new Date().toISOString());
}

function getStats(db) {
  const byUser = db.prepare(`
    SELECT user, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as sessions
    FROM events GROUP BY user ORDER BY input_tokens DESC
  `).all();

  const byModel = db.prepare(`
    SELECT model, COUNT(*) as sessions FROM events GROUP BY model ORDER BY sessions DESC
  `).all();

  const byDay = db.prepare(`
    SELECT substr(timestamp,1,10) as date, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as sessions
    FROM events GROUP BY date ORDER BY date DESC LIMIT 30
  `).all();

  return { byUser, byModel, byDay };
}

module.exports = { initDb, insertEvent, insertMember, getStats };
