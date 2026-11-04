/**
 * Minimal ZIP reader for downloads the tests inspect (the SPA exports its logs as a ZIP with one CSV).
 *
 * Reads the central directory and returns each entry as text. Supports stored and deflated entries, which is what the SPA's zip library
 * writes; anything else throws. No dependency: `node:zlib` only.
 */

import { inflateRawSync } from 'node:zlib';

/** Entries of a ZIP buffer, by file name, as UTF-8 text. */
export function readZipTextEntries(buffer: Buffer): Record<string, string> {
  const endSignature = 0x06054B50;
  let end = -1;
  for (let index = buffer.length - 22; index >= 0; index--) {
    if (buffer.readUInt32LE(index) === endSignature) {
      end = index;
      break;
    }
  }
  if (end < 0) {
    throw new Error('zip: end of central directory not found');
  }
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries: Record<string, string> = {};
  for (let entry = 0; entry < count; entry++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014B50) {
      throw new Error('zip: bad central directory entry');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) {
      throw new Error(`zip: unsupported compression method ${method}`);
    }
    entries[name] = (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Parse CSV text with quoted values into rows of fields (quotes and doubled quotes handled). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      }
      else if (char === '"') {
        quoted = false;
      }
      else {
        field += char;
      }
    }
    else if (char === '"') {
      quoted = true;
    }
    else if (char === ',') {
      row.push(field);
      field = '';
    }
    else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    }
    else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
