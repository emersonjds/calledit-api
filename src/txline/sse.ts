export interface ParsedSseChunk {
  events: string[];
  rest: string;
}

// SSE records are separated by a blank line; a `data:` field may repeat
// (joined by \n per spec). The trailing element after split is always the
// not-yet-terminated remainder, so it becomes `rest` rather than an event.
export function parseSseChunk(buffer: string): ParsedSseChunk {
  const records = buffer.split('\n\n');
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
