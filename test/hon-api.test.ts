import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import type { HOnAuthClient } from '../src/auth';
import { HOnApiClient } from '../src/hon-api';

describe('HOnApiClient', () => {
  it('uses the post-2026 unified appliance list and parses WM devices', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        modules: {
          applianceList: {
            payload: {
              appliances: [
                {
                  applianceTypeName: 'WM',
                  macAddress: 'aa-bb-cc-dd-ee-ff',
                  modelName: 'HW100-B14367U-FR',
                },
              ],
            },
          },
        },
      },
    });
    const auth = {
      getTokens: vi.fn().mockResolvedValue({
        idToken: 'id-token',
        accessToken: '',
        refreshToken: '',
        cognitoToken: 'cognito-token',
      }),
    } as unknown as HOnAuthClient;
    const client = new HOnApiClient('user', 'password', {
      auth,
      http: { request } as unknown as AxiosInstance,
    });

    const appliances = await client.getAppliances();

    expect(appliances).toHaveLength(1);
    expect(appliances[0]?.applianceTypeName).toBe('WM');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/unified-api/v1/view/appliance-list',
        data: { deviceId: 'homebridge-hon' },
        headers: expect.objectContaining({
          'cognito-token': 'cognito-token',
          'id-token': 'id-token',
        }),
      }),
    );
  });

  it('requests live cycle context with the appliance type', async () => {
    const request = vi.fn().mockResolvedValue({
      data: { payload: { shadow: { parameters: {} } } },
    });
    const auth = {
      getTokens: vi.fn().mockResolvedValue({
        idToken: 'id-token',
        accessToken: '',
        refreshToken: '',
        cognitoToken: 'cognito-token',
      }),
    } as unknown as HOnAuthClient;
    const client = new HOnApiClient('user', 'password', {
      auth,
      http: { request } as unknown as AxiosInstance,
    });

    await client.getContext({
      applianceTypeName: 'WM',
      macAddress: 'aa-bb-cc-dd-ee-ff',
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/commands/v1/context',
        params: {
          macAddress: 'aa-bb-cc-dd-ee-ff',
          applianceType: 'WM',
          category: 'CYCLE',
        },
      }),
    );
  });

  it('reauthenticates once and retries an API request rejected with HTTP 403', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 403 },
      })
      .mockResolvedValueOnce({ data: { payload: {} } });
    const getTokens = vi
      .fn()
      .mockResolvedValueOnce({
        idToken: 'expired-id-token',
        accessToken: '',
        refreshToken: '',
        cognitoToken: 'expired-cognito-token',
      })
      .mockResolvedValueOnce({
        idToken: 'fresh-id-token',
        accessToken: '',
        refreshToken: '',
        cognitoToken: 'fresh-cognito-token',
      });
    const client = new HOnApiClient('user', 'password', {
      auth: { getTokens } as unknown as HOnAuthClient,
      http: { request } as unknown as AxiosInstance,
    });

    await client.getContext({
      applianceTypeName: 'WM',
      macAddress: 'aa-bb-cc-dd-ee-ff',
    });

    expect(getTokens).toHaveBeenCalledTimes(2);
    expect(getTokens).toHaveBeenNthCalledWith(2, true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'cognito-token': 'fresh-cognito-token',
          'id-token': 'fresh-id-token',
        }),
      }),
    );
  });
});
