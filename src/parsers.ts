/**
 * Universal record parser & type coercion.
 *
 * Centralizes ALL parsing logic for RouterOS output:
 * - `parseKeyValue()` — key-value format (e.g. /system/identity/print)
 * - `parseDetailRecords()` — detail format (e.g. /ip/firewall/filter/print detail)
 * - `normalizeRecord()` — kebab→camelCase keys, type coercion, redaction
 */

// ---------------------------------------------------------------------------
// Low-level parsers (moved from src/tools/system.ts)
// ---------------------------------------------------------------------------

/**
 * Parse RouterOS key-value output into a Record.
 *
 * RouterOS `print` commands return lines like:
 * ```
 *                   name: MikroTik
 *             gmt-offset: +02:00
 * ```
 * Leading whitespace is padding. The first `: ` separates key from value.
 * Lines without `: ` are skipped (headers, blank lines).
 */
export function parseKeyValue(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(': ');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 2);
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Parse RouterOS `print detail` output into an array of records.
 *
 * Detail format outputs records like:
 * ```
 *  0    name="routeros" version="7.22.1" build-time=2026-03-23 14:35:15
 *       scheduled="" size=11.7MiB
 * ```
 *
 * Each record starts with a number prefix (possibly preceded by flags).
 * Fields are `key=value` or `key="value"` pairs. Quoted values may contain
 * spaces; unquoted values end at the next key= or end of meaningful content.
 *
 * Lines starting with "Flags:" or "Columns:" are skipped.
 */
export function parseDetailRecords(raw: string): Record<string, string>[] {
  const results: Record<string, string>[] = [];

  // Normalize line endings
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Match all key=value or key="value" pairs in a text block
  const extractFields = (text: string): Record<string, string> => {
    const record: Record<string, string> = {};
    const regex = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*?)"|(\S+))/g;
    for (const match of text.matchAll(regex)) {
      const key = match[1];
      const value = match[2] ?? match[3] ?? '';
      record[key] = value;
    }
    return record;
  };

  // Strip flag/column header lines
  const lines = normalized.split('\n');
  const contentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Flags:') || trimmed.startsWith('Columns:')) continue;
    contentLines.push(line);
  }

  const joined = contentLines.join('\n');

  // Parse flag definitions from "Flags:" header line
  const flagMap = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Flags:')) {
      const flagMatches = trimmed.matchAll(/([A-Z])\s*-\s*([\w-]+)/g);
      for (const fm of flagMatches) {
        flagMap.set(fm[1], fm[2].toLowerCase());
      }
      break;
    }
  }

  // Group lines into record blocks. A new record starts when a line begins
  // with optional whitespace, then a number index, optionally followed by
  // flag characters (e.g. " 0 ", " 4 X ", " 1 XD ").
  // RouterOS format: <whitespace><index><whitespace><flags?><whitespace><fields>
  // Continuation lines (indented, no leading number) are appended to the
  // current record block.
  const recordBlocks: string[] = [];
  const recordFlags: string[][] = []; // flags per record block
  const recordStartRe = /^\s*(\d+)\s+(?:([A-Z]+)\s+)?/;

  for (const line of contentLines) {
    if (line.trim() === '') continue;
    const startMatch = line.match(recordStartRe);
    if (startMatch) {
      // Start a new record block
      recordBlocks.push(line);
      recordFlags.push(startMatch[2] ? startMatch[2].split('') : []);
    } else if (recordBlocks.length > 0) {
      // Continuation line — append to current record
      recordBlocks[recordBlocks.length - 1] += ` ${line.trim()}`;
    }
  }

  if (recordBlocks.length > 0) {
    for (let i = 0; i < recordBlocks.length; i++) {
      const fields = extractFields(recordBlocks[i]);
      // Inject flag-derived fields
      for (const flagChar of recordFlags[i]) {
        const fieldName = flagMap.get(flagChar);
        if (fieldName && !(fieldName in fields)) {
          fields[fieldName] = 'yes';
        }
      }
      if (Object.keys(fields).length > 0) {
        results.push(fields);
      }
    }
  } else {
    // Fallback: split on blank lines (flag-prefixed records like history)
    const blocks = joined.split(/\n\s*\n/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const fields = extractFields(trimmed);
      if (Object.keys(fields).length > 0) {
        results.push(fields);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tabular output parser
// ---------------------------------------------------------------------------

/**
 * Parse RouterOS tabular output (column-aligned `print` without `detail`).
 *
 * Handles:
 * - `Flags:` and `Columns:` header lines (skipped)
 * - A header row starting with `#` that defines column positions
 * - Flag characters (e.g. `X` for disabled) in the gap between `#` col and first data col
 * - Missing values in columns (mapped to empty string)
 *
 * Returns records with original column names (kebab-case). Caller should
 * run `normalizeRecord()` on each entry.
 */
export function parseTabularRecords(raw: string): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Find the header row (starts with #)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('#')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return results;

  const headerLine = lines[headerIdx];

  // Determine column positions from header. The header looks like:
  // #   NAME     PORT  CERTIFICATE  VRF
  // We find the start index of each column name.
  const colHeaderRegex = /[A-Z][A-Z0-9_-]*/g;
  const columns: { name: string; start: number }[] = [];
  for (const m of headerLine.matchAll(colHeaderRegex)) {
    columns.push({ name: m[0].toLowerCase(), start: m.index });
  }
  if (columns.length === 0) return results;

  // Known flags from the Flags: line — map char → field name (lowercased)
  const flagMap = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Flags:')) {
      // Parse "X - DISABLED, I - INVALID, D - DYNAMIC" etc.
      const flagMatches = trimmed.matchAll(/([A-Z])\s*-\s*([\w-]+)/g);
      for (const fm of flagMatches) {
        flagMap.set(fm[1], fm[2].toLowerCase());
      }
      break;
    }
  }

  // Parse data rows (after header)
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;

    // Data rows start with the index number
    const rowMatch = line.match(/^\s*(\d+)\s*/);
    if (!rowMatch) continue;

    // Check for flag characters between index and first column
    const indexEnd = rowMatch[0].length;
    const firstColStart = columns[0].start;
    const flagArea = line.slice(indexEnd, firstColStart);

    // Extract column values based on positions
    const record: Record<string, string> = {};

    // Apply flag fields (X → disabled=yes, D → dynamic=yes, etc.)
    for (const [char, fieldName] of flagMap) {
      if (flagArea.includes(char)) {
        record[fieldName] = 'yes';
      }
    }

    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const nextStart = c + 1 < columns.length ? columns[c + 1].start : line.length;
      const value = line.slice(col.start, nextStart).trim();
      if (value) {
        record[col.name] = value;
      }
    }

    if (Object.keys(record).length > 0) {
      results.push(record);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Redacted fields — sensitive data never exposed
// ---------------------------------------------------------------------------
export const REDACTED_FIELDS = new Set(['secret', 'password']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert kebab-case to camelCase. */
export function kebabToCamel(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Coerce a RouterOS string value to a typed JS value.
 * - `''` → `null`
 * - `'yes'` / `'true'` → `true`
 * - `'no'` / `'false'` → `false`
 * - `/^\d+$/` → number (parseInt)
 * - everything else → string
 */
export function coerce(v: string): unknown {
  if (v === '') return null;
  if (v === 'yes' || v === 'true') return true;
  if (v === 'no' || v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

/**
 * Normalize a raw RouterOS record:
 * 1. Convert all keys from kebab-case to camelCase
 * 2. Redact sensitive fields
 * 3. Coerce values to appropriate JS types
 */
export function normalizeRecord(r: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(r)) {
    const camelKey = kebabToCamel(key);
    if (REDACTED_FIELDS.has(key)) {
      result[camelKey] = '[REDACTED]';
    } else {
      result[camelKey] = coerce(value);
    }
  }
  return result;
}
