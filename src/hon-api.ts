import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

import { HOnAuthClient } from './auth';
import { HOnApiError, safeErrorMessage } from './errors';
import {
  HON_API_URL,
  HON_MOBILE_ID,
  HON_USER_AGENT,
  REQUEST_TIMEOUT_MS,
} from './settings';
import type { CiamTokens, HOnAppliance, HOnContextPayload } from './types';

interface ApplianceListResponse {
  modules?: {
    applianceList?: {
      payload?: {
        appliances?: HOnAppliance[];
      };
    };
  };
}

interface ContextResponse {
  payload?: HOnContextPayload;
}

export class HOnApiClient {
  private readonly auth: HOnAuthClient;
  private readonly http: AxiosInstance;

  public constructor(
    username: string,
    password: string,
    options?: {
      auth?: HOnAuthClient;
      http?: AxiosInstance;
    },
  ) {
    this.http =
      options?.http ??
      axios.create({
        baseURL: HON_API_URL,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': HON_USER_AGENT,
        },
      });
    this.auth = options?.auth ?? new HOnAuthClient(username, password);
  }

  public async getAppliances(): Promise<HOnAppliance[]> {
    const response = await this.request<ApplianceListResponse>({
      method: 'POST',
      url: '/unified-api/v1/view/appliance-list',
      data: { deviceId: HON_MOBILE_ID },
    });

    return (
      response.data.modules?.applianceList?.payload?.appliances?.filter(
        (device): device is HOnAppliance => Boolean(device.macAddress),
      ) ?? []
    );
  }

  public async getContext(device: HOnAppliance): Promise<HOnContextPayload> {
    const applianceType =
      device.applianceTypeName ?? device.applianceTypeCode ?? '';
    const response = await this.request<ContextResponse>({
      method: 'GET',
      url: '/commands/v1/context',
      params: {
        macAddress: device.macAddress,
        applianceType,
        category: 'CYCLE',
      },
    });

    return response.data.payload ?? {};
  }

  private async request<T>(
    config: AxiosRequestConfig,
    retry = true,
    suppliedTokens?: CiamTokens,
  ): Promise<AxiosResponse<T>> {
    const tokens = suppliedTokens ?? (await this.auth.getTokens());
    try {
      return await this.http.request<T>({
        ...config,
        headers: {
          ...config.headers,
          'cognito-token': tokens.cognitoToken,
          'id-token': tokens.idToken,
        },
      });
    } catch (error) {
      if (
        retry &&
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        const freshTokens = await this.auth.getTokens(true);
        return this.request<T>(config, false, freshTokens);
      }

      throw new HOnApiError(`hOn API request failed: ${safeErrorMessage(error)}`, {
        cause: error,
      });
    }
  }
}
