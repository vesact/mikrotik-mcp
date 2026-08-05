import { describe, it, expect } from 'vitest';
import {
  kebabToCamel,
  coerce,
  normalizeRecord,
  REDACTED_FIELDS,
  parseKeyValue,
  parseDetailRecords,
} from '../../src/parsers.js';

describe('kebabToCamel', () => {
  it('converts kebab-case to camelCase', () => {
    expect(kebabToCamel('dst-port')).toBe('dstPort');
    expect(kebabToCamel('src-address')).toBe('srcAddress');
    expect(kebabToCamel('time-zone-name')).toBe('timeZoneName');
  });

  it('leaves non-kebab strings unchanged', () => {
    expect(kebabToCamel('name')).toBe('name');
    expect(kebabToCamel('address')).toBe('address');
  });

  it('handles numbers after hyphens', () => {
    expect(kebabToCamel('board-temperature1')).toBe('boardTemperature1');
  });
});

describe('coerce', () => {
  it('converts empty string to null', () => {
    expect(coerce('')).toBeNull();
  });

  it('converts yes/true to boolean true', () => {
    expect(coerce('yes')).toBe(true);
    expect(coerce('true')).toBe(true);
  });

  it('converts no/false to boolean false', () => {
    expect(coerce('no')).toBe(false);
    expect(coerce('false')).toBe(false);
  });

  it('converts pure integer strings to numbers', () => {
    expect(coerce('22')).toBe(22);
    expect(coerce('0')).toBe(0);
    expect(coerce('1812')).toBe(1812);
  });

  it('does NOT coerce floats or non-pure-integer strings', () => {
    expect(coerce('24.4')).toBe('24.4');
    expect(coerce('11.7MiB')).toBe('11.7MiB');
    expect(coerce('192.168.1.0/24')).toBe('192.168.1.0/24');
  });

  it('preserves regular strings', () => {
    expect(coerce('bridge1')).toBe('bridge1');
    expect(coerce('UTC')).toBe('UTC');
  });
});

describe('normalizeRecord', () => {
  it('converts keys to camelCase and coerces values', () => {
    const input = { 'dst-port': '443', disabled: 'yes', name: 'rule1' };
    expect(normalizeRecord(input)).toEqual({
      dstPort: 443,
      disabled: true,
      name: 'rule1',
    });
  });

  it('redacts sensitive fields', () => {
    const input = { name: 'user1', password: 'secret123', secret: 'mysecret' };
    const result = normalizeRecord(input);
    expect(result.password).toBe('[REDACTED]');
    expect(result.secret).toBe('[REDACTED]');
    expect(result.name).toBe('user1');
  });

  it('converts empty values to null', () => {
    const input = { comment: '', name: 'test' };
    expect(normalizeRecord(input)).toEqual({ comment: null, name: 'test' });
  });
});

describe('REDACTED_FIELDS', () => {
  it('contains expected sensitive field names', () => {
    expect(REDACTED_FIELDS.has('secret')).toBe(true);
    expect(REDACTED_FIELDS.has('password')).toBe(true);
  });
});

describe('parseKeyValue', () => {
  it('parses key-value lines', () => {
    const raw = '                  name: MikroTik\n            gmt-offset: +02:00\n';
    const result = parseKeyValue(raw);
    expect(result).toEqual({ name: 'MikroTik', 'gmt-offset': '+02:00' });
  });

  it('skips lines without colon-space', () => {
    const raw = 'some header\n  name: test\n\n';
    expect(parseKeyValue(raw)).toEqual({ name: 'test' });
  });
});

describe('parseDetailRecords', () => {
  it('parses numbered detail records', () => {
    const raw = ' 0 name="bridge1" disabled=no\r\n 1 name="bridge2" disabled=yes\r\n';
    const result = parseDetailRecords(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'bridge1', disabled: 'no' });
    expect(result[1]).toEqual({ name: 'bridge2', disabled: 'yes' });
  });

  it('strips Flags and Columns header lines', () => {
    const raw = 'Flags: X - DISABLED\r\n 0 name="test" disabled=no\r\n';
    const result = parseDetailRecords(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'test', disabled: 'no' });
  });

  it('returns empty array for empty input', () => {
    expect(parseDetailRecords('')).toEqual([]);
  });
});
