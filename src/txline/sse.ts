export interface ParsedSseChunk {
  events: string[];
  rest: string;
}

export function parseSseChunk(buffer: string): ParsedSseChunk {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const records = normalized.split('\n\n');
  const rest = records.pop() ?? '';
  const events: string[] = [];
  for (const record of records) {
    const payload = extractDataPayload(record);
    if (payload !== null) events.push(payload);
  }
  return { events, rest };
}

function extractDataPayload(record: string): string | null {
  const dataLines = record
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return dataLines.join('\n');
}
