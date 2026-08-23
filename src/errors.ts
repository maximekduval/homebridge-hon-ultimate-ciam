import axios from 'axios';

export class HOnApiError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HOnApiError';
  }
}

export function safeErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const payload = error.response?.data as
      | { __type?: string; error?: string; message?: string }
      | undefined;
    const detail = payload?.message ?? payload?.error ?? payload?.__type;

    if (status && detail) {
      return `HTTP ${status}: ${detail}`;
    }
    if (status) {
      return `HTTP ${status}`;
    }
    return error.code ?? 'Network request failed';
  }

  return error instanceof Error ? error.message : String(error);
}
