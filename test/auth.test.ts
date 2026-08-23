import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { createPkcePair, HOnAuthClient } from '../src/auth';

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
});
