const os = require('os');
const path = require('path');
const fs = require('fs/promises');

jest.mock('fs/promises');

const { parseTranscript } = require('../parse-transcript');

describe('parseTranscript', () => {
  test('sums tokens across all assistant turns', async () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50 } } }),
      JSON.stringify({ type: 'user', message: { content: 'next' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 80 } } }),
    ];
    fs.readFile.mockResolvedValue(lines.join('\n'));
    const result = await parseTranscript('/fake/path.jsonl');
    expect(result).toEqual({ input_tokens: 300, output_tokens: 130 });
  });

  test('returns zeros when no usage lines', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ type: 'user', message: {} }));
    const result = await parseTranscript('/fake/path.jsonl');
    expect(result).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  test('skips malformed lines without throwing', async () => {
    const lines = ['not-json', JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5 } } })];
    fs.readFile.mockResolvedValue(lines.join('\n'));
    const result = await parseTranscript('/fake/path.jsonl');
    expect(result).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  test('returns zeros when file missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    const result = await parseTranscript('/missing.jsonl');
    expect(result).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});
