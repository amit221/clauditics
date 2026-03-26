jest.mock('../config');
jest.mock('../log');
jest.mock('../http');
jest.mock('../queue');

const { readConfig, writeSessionCurrent } = require('../config');
const { logError } = require('../log');
const { postVerify } = require('../http');
const { flushQueue } = require('../queue');
const { run } = require('../session-start');

const PAYLOAD = {
  session_id: 'sess-1',
  model: 'claude-sonnet-4-6',
  transcript_path: '/tmp/session.jsonl',
  hook_event_name: 'SessionStart',
};

describe('session-start', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writes session-current.json with session_id and model', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    await run(PAYLOAD);
    expect(writeSessionCurrent).toHaveBeenCalledWith({ session_id: 'sess-1', model: 'claude-sonnet-4-6' });
  });

  test('prints setup message and exits when config missing', async () => {
    readConfig.mockResolvedValue(null);
    const consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await run(PAYLOAD);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/clauditics:setup'));
    consoleSpy.mockRestore();
  });

  test('calls postVerify for owner mode', async () => {
    readConfig.mockResolvedValue({ mode: 'owner', user: 'Dan', serverUrl: 'http://localhost:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: true });
    flushQueue.mockResolvedValue();
    await run(PAYLOAD);
    expect(postVerify).toHaveBeenCalledWith('http://localhost:3000', 'tok', 'Dan');
  });

  test('calls postVerify for member mode', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: true });
    flushQueue.mockResolvedValue();
    await run(PAYLOAD);
    expect(postVerify).toHaveBeenCalledWith('http://server:3000', 'tok', 'Alice');
  });

  test('logs warning but does not throw when postVerify fails', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' });
    flushQueue.mockResolvedValue();
    await expect(run(PAYLOAD)).resolves.not.toThrow();
    expect(logError).toHaveBeenCalledWith('session-start', expect.stringContaining('verify'));
  });

  test('does not call postVerify for personal mode', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    await run(PAYLOAD);
    expect(postVerify).not.toHaveBeenCalled();
  });

  test('calls flushQueue for owner/member mode', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: true });
    flushQueue.mockResolvedValue();
    await run(PAYLOAD);
    expect(flushQueue).toHaveBeenCalledWith('http://server:3000', 'tok');
  });
});
