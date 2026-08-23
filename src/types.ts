import type { PlatformConfig } from 'homebridge';

export interface HOnUltimateConfig extends PlatformConfig {
  username?: string;
  email?: string;
  password?: string;
  pollInterval?: number;
}

export interface CiamTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  cognitoToken: string;
}

export interface HOnAppliance {
  applianceModelId?: number | string;
  applianceTypeCode?: string;
  applianceTypeName?: string;
  brand?: string;
  code?: string;
  eepromId?: number | string;
  fwVersion?: string;
  macAddress: string;
  modelName?: string;
  nickName?: string;
  serialNumber?: string;
  series?: string;
}

export interface HOnParameterValue {
  lastUpdate?: string;
  parNewVal?: unknown;
  parValue?: unknown;
  value?: unknown;
}

export interface HOnContextPayload {
  activity?: Record<string, unknown>;
  lastConnEvent?: {
    category?: string;
  };
  shadow?: {
    parameters?: Record<string, HOnParameterValue | unknown>;
  };
  [key: string]: unknown;
}

export interface LaundryState {
  active: boolean;
  connected: boolean;
  doorOpen?: boolean;
  error?: string;
  machineMode: string;
  phase: string;
  program?: string;
  remainingSeconds: number;
  remoteControl: boolean;
  spinSpeed?: number;
  temperature?: number;
}
