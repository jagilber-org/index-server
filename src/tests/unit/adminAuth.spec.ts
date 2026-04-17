/**
 * Unit tests for dashboardAdminAuth middleware and isLoopbackHost helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../config/runtimeConfig.js', () => ({
  getRuntimeConfig: vi.fn(),
}));

import { isLoopbackHost, dashboardAdminAuth } from '../../dashboard/server/routes/adminAuth.js';
import { getRuntimeConfig } from '../../config/runtimeConfig.js';

const mockedGetRuntimeConfig = vi.mocked(getRuntimeConfig);

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; return res; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('isLoopbackHost', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ])('returns true for %s', (value) => {
    expect(isLoopbackHost(value)).toBe(true);
  });

  it.each([
    'LOCALHOST',
    'Localhost',
    '::FFFF:127.0.0.1',
    '::Ffff:127.0.0.1',
  ])('is case-insensitive: returns true for %s', (value) => {
    expect(isLoopbackHost(value)).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isLoopbackHost(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isLoopbackHost('')).toBe(false);
  });

  it('returns false for a random IP', () => {
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
  });
});

describe('dashboardAdminAuth — with admin key configured', () => {
  const adminKey = 'test-secret-key-123';

  beforeEach(() => {
    mockedGetRuntimeConfig.mockReturnValue({
      dashboard: { http: { adminApiKey: adminKey } },
    } as ReturnType<typeof getRuntimeConfig>);
  });

  it('calls next() when valid key is provided', () => {
    const req = mockReq({ headers: { authorization: `Bearer ${adminKey}` } });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('returns 401 for wrong key of same length', () => {
    const wrongKey = 'x'.repeat(adminKey.length);
    const req = mockReq({ headers: { authorization: `Bearer ${wrongKey}` } });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(expect.objectContaining({ error: expect.stringContaining('Admin API key required') }));
  });

  it('returns 401 for wrong key of different length', () => {
    const req = mockReq({ headers: { authorization: 'Bearer short' } });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Authorization header is empty', () => {
    const req = mockReq({ headers: { authorization: '' } });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it.each([
    `bearer ${adminKey}`,
    `BEARER ${adminKey}`,
    `Bearer ${adminKey}`,
  ])('parses Bearer prefix case-insensitively: "%s"', (header) => {
    const req = mockReq({ headers: { authorization: header } });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});

describe('dashboardAdminAuth — no admin key configured', () => {
  beforeEach(() => {
    mockedGetRuntimeConfig.mockReturnValue({
      dashboard: { http: { adminApiKey: '' } },
    } as ReturnType<typeof getRuntimeConfig>);
  });

  it('calls next() for loopback req.ip', () => {
    const req = mockReq({ ip: '127.0.0.1' });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('calls next() when req.ip is undefined but socket.remoteAddress is loopback', () => {
    const req = mockReq({
      ip: undefined,
      socket: { remoteAddress: '::1' } as Request['socket'],
    });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('returns 403 for non-loopback IP', () => {
    const req = mockReq({ ip: '10.0.0.5' });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: expect.stringContaining('localhost') }));
  });

  it('returns 403 when both ip and remoteAddress are undefined', () => {
    const req = mockReq({
      ip: undefined,
      socket: { remoteAddress: undefined } as unknown as Request['socket'],
    });
    const res = mockRes();
    const next = vi.fn();

    dashboardAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
