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
});
