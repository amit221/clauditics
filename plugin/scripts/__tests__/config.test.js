const os = require('os');
const path = require('path');
const fs = require('fs/promises');

// Mock fs/promises before requiring the module
jest.mock('fs/promises');

const { readConfig, writeConfig, readSessionCurrent, writeSessionCurrent, deleteSessionCurrent, CLAUDITICS_DIR } = require('../config');

describe('config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('CLAUDITICS_DIR is under home dir', () => {
    expect(CLAUDITICS_DIR).toBe(path.join(os.homedir(), '.clauditics'));
  });

  test('readConfig returns null when file missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    const result = await readConfig();
    expect(result).toBeNull();
  });

  test('readConfig returns parsed JSON', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ mode: 'personal', user: 'Dan' }));
    const result = await readConfig();
    expect(result).toEqual({ mode: 'personal', user: 'Dan' });
  });

  test('writeConfig creates dir and writes JSON', async () => {
    fs.mkdir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    await writeConfig({ mode: 'personal', user: 'Dan' });
    expect(fs.mkdir).toHaveBeenCalledWith(CLAUDITICS_DIR, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(CLAUDITICS_DIR, 'config.json'),
      JSON.stringify({ mode: 'personal', user: 'Dan' }, null, 2)
    );
  });

  test('writeSessionCurrent writes session_id and model', async () => {
    fs.mkdir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    await writeSessionCurrent({ session_id: 'abc', model: 'claude-sonnet-4-6' });
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(CLAUDITICS_DIR, 'session-current.json'),
      JSON.stringify({ session_id: 'abc', model: 'claude-sonnet-4-6' }, null, 2)
    );
  });

  test('readSessionCurrent returns null when missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    expect(await readSessionCurrent()).toBeNull();
  });

  test('deleteSessionCurrent calls unlink', async () => {
    fs.unlink.mockResolvedValue();
    await deleteSessionCurrent();
    expect(fs.unlink).toHaveBeenCalledWith(path.join(CLAUDITICS_DIR, 'session-current.json'));
  });
});
