import { describe, it, expect } from 'vitest';
import { parseSseChunk } from '../src/txline/sse.js';

describe('parseSseChunk', () => {
  it('extracts complete data records and leaves no rest', () => {
    const buffer = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
    const { events, rest } = parseSseChunk(buffer);
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('');
  });

  it('returns a trailing partial record as rest', () => {
    const buffer = 'data: {"a":1}\n\ndata: {"b":2';
    const { events, rest } = parseSseChunk(buffer);
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b":2');
  });

  it('ignores records with no data field', () => {
    const buffer = ': keep-alive\n\ndata: {"a":1}\n\n';
    const { events, rest } = parseSseChunk(buffer);
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('');
  });

  it('handles CRLF record separators', () => {
    const buffer = 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n';
    const { events, rest } = parseSseChunk(buffer);
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('');
  });
});
