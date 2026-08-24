import type { AxiosInstance } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPkcePair, HOnAuthClient } from '../src/auth';

afterEach(() => {
  vi.useRealTimers();
});

describe('createPkcePair', () => {
  it('creates an RFC 7636-compatible verifier and SHA-256 challenge', () => {
    const pair = createPkcePair();

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toHaveLength(43);
  });
});

describe('HOnAuthClient', () => {
  it('authorizes with CIAM, exchanges the PKCE verifier and caches tokens', async () => {
    const get = vi.fn().mockResolvedValue({ data: { session_id: 'session-1' } });
    const post = vi.fn().mockResolvedValue({
      data: {
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          cognito_token: 'cognito-token',
        },
      },
    });
    const http = { get, post } as unknown as AxiosInstance;
    const client = new HOnAuthClient('user@example.com', 'secret', http);

    const first = await client.getTokens();
    const second = await client.getTokens();

    expect(first).toEqual({
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      cognitoToken: 'cognito-token',
    });
    expect(second).toBe(first);
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/ciam/authorize', {
      params: expect.objectContaining({
        username: 'user@example.com',
        password: 'secret',
        code_challenge: expect.any(String),
      }),
    });
    expect(post).toHaveBeenCalledWith('/ciam/token', {
      session_id: 'session-1',
      code_verifier: expect.any(String),
    });
  });

  it('does not expose credentials in a failed HTTP error', async () => {
    const get = vi.fn().mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Unauthorized' } },
    });
    const http = { get, post: vi.fn() } as unknown as AxiosInstance;
    const client = new HOnAuthClient('private@example.com', 'top-secret', http);

    await expect(client.getTokens()).rejects.not.toThrow(/top-secret|private@example/u);
  });

  it('performs a fresh PKCE authorization before the eight-hour token expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'));
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { session_id: 'session-1' } })
      .mockResolvedValueOnce({ data: { session_id: 'session-2' } });
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          tokens: {
            id_token: 'id-token-1',
            cognito_token: 'cognito-token-1',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          tokens: {
            id_token: 'id-token-2',
            cognito_token: 'cognito-token-2',
          },
        },
      });
    const client = new HOnAuthClient(
      'user@example.com',
      'secret',
      { get, post } as unknown as AxiosInstance,
    );

    const first = await client.getTokens();
    vi.advanceTimersByTime(7 * 60 * 60 * 1_000);
    const renewed = await client.getTokens();

    expect(first.idToken).toBe('id-token-1');
    expect(renewed.idToken).toBe('id-token-2');
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(2, '/ciam/authorize', {
      params: expect.objectContaining({
        username: 'user@example.com',
        code_challenge: expect.any(String),
      }),
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.[1]).toEqual({
      session_id: 'session-2',
      code_verifier: expect.any(String),
    });
  });
});
