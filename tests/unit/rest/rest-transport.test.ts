import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RestTransportImpl } from '../../../src/rest/rest-transport.js';
import type { KeePassCredential } from '../../../src/types/index.js';
import { RestError } from '../../../src/types/index.js';

const credential: KeePassCredential = {
  deviceId: 'router-1',
  username: 'admin',
  password: 's3cret!',
  hostname: '10.0.0.1',
};

describe('RestTransportImpl', () => {
  let transport: RestTransportImpl;
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFn = vi.fn();
    transport = new RestTransportImpl({
      port: 8080,
      scheme: 'http',
      timeoutMs: 5000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
  });

  describe('query()', () => {
    it('sends GET and returns RosRecord[]', async () => {
      const records = [
        { '.id': '*1', address: '10.0.0.1/24', interface: 'ether1' },
        { '.id': '*2', address: '192.168.1.1/24', interface: 'bridge1' },
      ];
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(records),
      });

      const result = await transport.query(credential, '/ip/address');

      expect(fetchFn).toHaveBeenCalledWith(
        'http://10.0.0.1:8080/rest/ip/address',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(records);
    });

    it('returns empty array for empty response', async () => {
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      const result = await transport.query(credential, '/ip/address');
      expect(result).toEqual([]);
    });
  });

  describe('execute()', () => {
    it('sends PUT for add (no .id, has args)', async () => {
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"ret":"*3"}'),
      });

      await transport.execute(credential, '/ip/address', {
        address: '10.0.0.5/24',
        interface: 'ether2',
      });

      expect(fetchFn).toHaveBeenCalledWith(
        'http://10.0.0.1:8080/rest/ip/address',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('sends PATCH for set (.id in path, has args)', async () => {
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{}'),
      });

      await transport.execute(credential, '/ip/address/*1', { comment: 'test' });

      expect(fetchFn).toHaveBeenCalledWith(
        'http://10.0.0.1:8080/rest/ip/address/*1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('sends DELETE when .id in path and no args', async () => {
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
      });

      await transport.execute(credential, '/ip/address/*1', {});

      expect(fetchFn).toHaveBeenCalledWith(
        'http://10.0.0.1:8080/rest/ip/address/*1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('uses explicit method from options', async () => {
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{}'),
      });

      await transport.execute(
        credential,
        '/ip/address',
        { address: '10.0.0.1/24' },
        { method: 'POST' },
      );

      expect(fetchFn).toHaveBeenCalledWith(
        'http://10.0.0.1:8080/rest/ip/address',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('raw()', () => {
    it('sends POST and returns stringified JSON', async () => {
      const responseData = [{ host: '8.8.8.8', time: '1ms' }];
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseData),
      });

      const result = await transport.raw(credential, '/ping', { address: '8.8.8.8', count: '4' });

      expect(fetchFn).toHaveBeenCalledWith(
        'http://10.0.0.1:8080/rest/ping',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toBe(JSON.stringify(responseData));
    });
  });

  describe('error handling', () => {
    it('throws RestError on 4xx response', async () => {
      fetchFn.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 404, message: 'Not Found', detail: 'no such item' }),
      });

      await expect(transport.query(credential, '/ip/address/*99')).rejects.toThrow(RestError);
      await expect(transport.query(credential, '/ip/address/*99')).rejects.toMatchObject({
        deviceId: 'router-1',
        statusCode: 404,
        detail: 'no such item',
      });
    });

    it('throws RestError on timeout (abort)', async () => {
      fetchFn.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      await expect(transport.query(credential, '/ip/address')).rejects.toThrow(RestError);
      await expect(transport.query(credential, '/ip/address')).rejects.toMatchObject({
        deviceId: 'router-1',
        statusCode: 0,
      });
    });

    it('sanitizes credentials from error messages', async () => {
      fetchFn.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ detail: `auth failed for admin with s3cret!` }),
      });

      try {
        await transport.query(credential, '/ip/address');
      } catch (err) {
        expect(err).toBeInstanceOf(RestError);
        const restErr = err as RestError;
        expect(restErr.detail).not.toContain('s3cret!');
        expect(restErr.detail).not.toContain('admin');
        expect(restErr.detail).toContain('[REDACTED]');
      }
    });
  });

  describe('auth header', () => {
    it('sends correct Basic auth header', async () => {
      fetchFn.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await transport.query(credential, '/ip/address');

      const callArgs = fetchFn.mock.calls[0][1];
      const expected = `Basic ${btoa('admin:s3cret!')}`;
      expect(callArgs.headers.Authorization).toBe(expected);
    });
  });
});
