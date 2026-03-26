jest.mock('../config');
jest.mock('../log');
jest.mock('../http');
jest.mock('../queue');
jest.mock('../parse-transcript');
jest.mock('fs/promises');

const { readConfig, readSessionCurrent, deleteSessionCurrent } = require('../config');
const { logError } = require('../log');
const { postEvent } = require('../http');
const { enqueue } = require('../queue');
const { parseTranscript } = require('../parse-transcript');
const fs = require('fs/promises');
const { run } = require('../session-stop');

const STOP_PAYLOAD = {
  session_id: 'sess-1',
  transcript_path: '/tmp/session.jsonl',
  hook_event_name: 'Stop',
};

const SESSION_CURRENT = { session_id: 'sess-1', model: 'claude-sonnet-4-6' };

describe('session-stop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-03-25T18:00:00.000Z'));
    readSessionCurrent.mockResolvedValue(SESSION_CURRENT);
    parseTranscript.mockResolvedValue({ input_tokens: 1200, output_tokens: 340 });
    deleteSessionCurrent.mockResolvedValue();
  });

  afterEach(() => jest.useRealTimers());

  test('writes NDJSON file for personal mode', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    fs.mkdir.mockResolvedValue();
    fs.appendFile.mockResolvedValue();

    await run(STOP_PAYLOAD);

    const expectedEvent = { session_id: 'sess-1', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 1200, output_tokens: 340, timestamp: '2026-03-25T18:00:00.000Z' };
    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining('2026-03-25.ndjson'),
      JSON.stringify(expectedEvent) + '\n'
    );
  });

  test('POSTs event for member mode', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postEvent.mockResolvedValue({ ok: true });

    await run(STOP_PAYLOAD);

    expect(postEvent).toHaveBeenCalledWith('http://server:3000', 'tok',
      expect.objectContaining({ user: 'Alice', input_tokens: 1200, output_tokens: 340 })
    );
  });

  test('enqueues event when POST fails', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postEvent.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' });

    await run(STOP_PAYLOAD);

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ user: 'Alice' }));
  });

  test('logs error and exits gracefully when session-current missing', async () => {
    readSessionCurrent.mockResolvedValue(null);
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });

    await expect(run(STOP_PAYLOAD)).resolves.not.toThrow();
    expect(logError).toHaveBeenCalledWith('session-stop', expect.stringContaining('session-current'));
  });

  test('deletes session-current.json after processing', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    fs.mkdir.mockResolvedValue();
    fs.appendFile.mockResolvedValue();

    await run(STOP_PAYLOAD);

    expect(deleteSessionCurrent).toHaveBeenCalled();
  });
});
