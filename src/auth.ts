import axios, { type AxiosInstance } from 'axios';
import { createHash, randomBytes } from 'node:crypto';

import { HOnApiError, safeErrorMessage } from './errors';
import {
  HON_API_KEY,
  HON_API_URL,
  HON_USER_AGENT,
  REQUEST_TIMEOUT_MS,
} from './settings';
import type { CiamTokens } from './types';

interface CiamAuthorizeResponse {
  session_id?: string;
}

interface CiamTokenResponse {
  tokens?: {
    access_token?: string;
    cognito_token?: string;
    id_token?: string;
    refresh_token?: string;
  };
}

interface PkcePair {
  challenge: string;
  verifier: string;
}

const TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1_000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1_000;

function base64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { challenge, verifier };
}

export class HOnAuthClient {
  private readonly http: AxiosInstance;
  private expiresAt = 0;
  private inFlight?: Promise<CiamTokens>;
  private sessionId = '';
  private tokens?: CiamTokens;
  private verifier = '';

  public constructor(
    private readonly username: string,
    private readonly password: string,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: HON_API_URL,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': HON_USER_AGENT,
          'x-api-key': HON_API_KEY,
        },
      });
  }

  public async getTokens(forceRefresh = false): Promise<CiamTokens> {
    const refreshAt = this.expiresAt - TOKEN_REFRESH_MARGIN_MS;
    if (!forceRefresh && this.tokens && Date.now() < refreshAt) {
      return this.tokens;
    }

    if (!this.inFlight) {
      this.inFlight = this.refreshOrAuthenticate().finally(() => {
        this.inFlight = undefined;
      });
    }

    return this.inFlight;
  }

  public clear(): void {
    this.expiresAt = 0;
    this.sessionId = '';
    this.tokens = undefined;
    this.verifier = '';
  }

  private async refreshOrAuthenticate(): Promise<CiamTokens> {
    if (this.sessionId && this.verifier) {
      try {
        return await this.exchangeTokens(this.sessionId, this.verifier);
      } catch {
        this.clear();
      }
    }

    return this.authenticate();
  }

  private async authenticate(): Promise<CiamTokens> {
    const { challenge, verifier } = createPkcePair();

    try {
      const response = await this.http.get<CiamAuthorizeResponse>('/ciam/authorize', {
        params: {
          username: this.username,
          password: this.password,
          code_challenge: challenge,
        },
      });
      const sessionId = response.data.session_id;
      if (!sessionId) {
        throw new HOnApiError('hOn CIAM did not return a session identifier.');
      }

      this.sessionId = sessionId;
      this.verifier = verifier;
      return await this.exchangeTokens(sessionId, verifier);
    } catch (error) {
      this.clear();
      if (error instanceof HOnApiError) {
        throw error;
      }
      throw new HOnApiError(
        `hOn CIAM authentication failed: ${safeErrorMessage(error)}`,
        { cause: error },
      );
    }
  }

  private async exchangeTokens(
    sessionId: string,
    verifier: string,
  ): Promise<CiamTokens> {
    try {
      const response = await this.http.post<CiamTokenResponse>('/ciam/token', {
        session_id: sessionId,
        code_verifier: verifier,
      });
      const values = response.data.tokens;
      if (!values?.id_token || !values.cognito_token) {
        throw new HOnApiError('hOn CIAM returned an incomplete token set.');
      }

      this.tokens = {
        idToken: values.id_token,
        accessToken: values.access_token ?? '',
        refreshToken: values.refresh_token ?? '',
        cognitoToken: values.cognito_token,
      };
      this.expiresAt = Date.now() + TOKEN_LIFETIME_MS;
      return this.tokens;
    } catch (error) {
      if (error instanceof HOnApiError) {
        throw error;
      }
      throw new HOnApiError(
        `hOn CIAM token exchange failed: ${safeErrorMessage(error)}`,
        { cause: error },
      );
    }
  }
}
