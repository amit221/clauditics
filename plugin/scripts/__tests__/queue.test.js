jest.mock('fs/promises');
jest.mock('../http');

const fs = require('fs/promises');
const { postEvent } = require('../http');
const { enqueue, flushQueue } = require('../queue');
const os = require('os');
const path = require('path');

const QUEUE_PATH = path.join(os.homedir(), '.clauditics', 'queue.ndjson');

const event1 = { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 10, output_tokens: 5, timestamp: 't1' };
const event2 = { session_id: 'b', user: 'Dan', model: 'sonnet', input_tokens: 20, output_tokens: 8, timestamp: 't2' };
const event3 = { session_id: 'c', user: 'Dan', model: 'sonnet', input_tokens: 30, output_tokens: 12, timestamp: 't3' };

describe('queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueue appends event as NDJSON line', async () => {
    fs.mkdir.mockResolvedValue();
    fs.appendFile.mockResolvedValue();
    await enqueue(event1);
    expect(fs.appendFile).toHaveBeenCalledWith(QUEUE_PATH, JSON.stringify(event1) + '\n');
  });

  test('flushQueue posts all events and clears file on full success', async () => {
    fs.readFile.mockResolvedValue([event1, event2].map(e => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFile.mockResolvedValue();
    postEvent.mockResolvedValue({ ok: true });

    await flushQueue('http://localhost:3000', 'token');

    expect(postEvent).toHaveBeenCalledTimes(2);
    expect(fs.writeFile).toHaveBeenCalledWith(QUEUE_PATH, '');
  });

  test('flushQueue stops on failure and keeps remaining events', async () => {
    fs.readFile.mockResolvedValue([event1, event2, event3].map(e => JSON.stringify(e)).join('\n'));
    fs.writeFile.mockResolvedValue();
    postEvent
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });

    await flushQueue('http://localhost:3000', 'token');

    expect(postEvent).toHaveBeenCalledTimes(2); // stops after failure
    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).toContain(JSON.stringify(event2));
    expect(writtenContent).toContain(JSON.stringify(event3));
    expect(writtenContent).not.toContain(JSON.stringify(event1));
  });

  test('flushQueue does nothing when queue file missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    await flushQueue('http://localhost:3000', 'token');
    expect(postEvent).not.toHaveBeenCalled();
  });
});
