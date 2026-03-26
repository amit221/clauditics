const fs = require('fs/promises');

async function parseTranscript(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { input_tokens: 0, output_tokens: 0 };
    return { input_tokens: 0, output_tokens: 0 };
  }

  let input_tokens = 0;
  let output_tokens = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry?.message?.usage;
      if (usage) {
        input_tokens += usage.input_tokens || 0;
        output_tokens += usage.output_tokens || 0;
      }
    } catch (_) {
      // skip malformed lines
    }
  }

  return { input_tokens, output_tokens };
}

module.exports = { parseTranscript };
