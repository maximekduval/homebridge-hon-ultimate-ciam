import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
} from 'homebridge';

import { HOnApiError, safeErrorMessage } from './errors';
import { HOnApiClient } from './hon-api';
import { LaundryAccessory } from './laundry-accessory';
import {
  DEFAULT_IDLE_POLL_INTERVAL_SECONDS,
  DEFAULT_POLL_INTERVAL_SECONDS,
  MAX_ERROR_BACKOFF_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  PLATFORM_NAME,
  PLUGIN_NAME,
  SUPPORTED_APPLIANCE_TYPES,
} from './settings';
import type { HOnAppliance, HOnUltimateConfig } from './types';

function getApplianceType(device: HOnAppliance): string {
  return device.applianceTypeName ?? device.applianceTypeCode ?? '';
}

function getApplianceName(device: HOnAppliance): string {
  return device.nickName || device.modelName || `hOn ${getApplianceType(device)}`;
}

export function calculatePollDelaySeconds(
  activeIntervalSeconds: number,
  idleIntervalSeconds: number,
  active: boolean,
  consecutiveFailures: number,
): number {
  const normalDelay = active ? activeIntervalSeconds : idleIntervalSeconds;
  if (!consecutiveFailures) {
    return normalDelay;
  }
  return Math.min(
    MAX_ERROR_BACKOFF_SECONDS,
    normalDelay * 2 ** Math.min(consecutiveFailures, 10),
  );
}

export class HOnUltimatePlatform implements DynamicPlatformPlugin {
  private readonly accessories: PlatformAccessory[] = [];
  private readonly client?: HOnApiClient;
  private consecutivePollFailures = 0;
  private discovering = false;
  private readonly handlers = new Map<string, LaundryAccessory>();
  private readonly idlePollIntervalSeconds: number;
  private pollTimer?: NodeJS.Timeout;
  private polling = false;
  private readonly pollIntervalSeconds: number;

  public constructor(
    private readonly log: Logger,
    private readonly config: HOnUltimateConfig,
    private readonly api: API,
  ) {
    const username = config.username ?? config.email ?? '';
    const password = config.password ?? '';
    const configuredInterval = Number(config.pollInterval);
    this.pollIntervalSeconds = Math.max(
      MIN_POLL_INTERVAL_SECONDS,
      Number.isFinite(configuredInterval)
        ? configuredInterval
        : DEFAULT_POLL_INTERVAL_SECONDS,
    );
    const configuredIdleInterval = Number(config.idlePollInterval);
    this.idlePollIntervalSeconds = Math.max(
      this.pollIntervalSeconds,
      Number.isFinite(configuredIdleInterval)
        ? configuredIdleInterval
        : DEFAULT_IDLE_POLL_INTERVAL_SECONDS,
    );

    if (!username || !password) {
      this.log.error('Missing hOn account email or password in the plugin settings.');
    } else {
      this.client = new HOnApiClient(username, password);
    }

    this.api.on('didFinishLaunching', () => {
      void this.start();
    });
    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
      }
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private async start(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.discoverDevices();
    await this.pollAndSchedule();
  }

  private async discoverDevices(): Promise<void> {
    if (!this.client || this.discovering) {
      return;
    }
    this.discovering = true;

    try {
      this.log.info('Authenticating with hOn through CIAM/PKCE...');
      const appliances = await this.client.getAppliances();
      const supported = appliances.filter((device) =>
        SUPPORTED_APPLIANCE_TYPES.has(getApplianceType(device)),
      );
      const discoveredUuids = new Set<string>();

      for (const device of supported) {
        const uuid = this.api.hap.uuid.generate(device.macAddress);
        discoveredUuids.add(uuid);
        let accessory = this.accessories.find((candidate) => candidate.UUID === uuid);

        if (!accessory) {
          accessory = new this.api.platformAccessory(getApplianceName(device), uuid);
          accessory.context.device = device;
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.accessories.push(accessory);
          this.log.info(
            'Added %s (%s, %s).',
            getApplianceName(device),
            getApplianceType(device),
            device.modelName ?? 'unknown model',
          );
        }

        accessory.context.device = device;

        const existingHandler = this.handlers.get(uuid);
        if (existingHandler) {
          existingHandler.updateDevice(device);
        } else {
          this.handlers.set(
            uuid,
            new LaundryAccessory(
              this.api,
              this.log,
              this.client,
              accessory,
              device,
              this.config.exposePhaseSensors !== false,
              this.config.exposeDoorLock !== false,
            ),
          );
        }
      }

      const stale = this.accessories.filter(
        (accessory) =>
          accessory.context.device && !discoveredUuids.has(accessory.UUID),
      );
      if (stale.length) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
        for (const accessory of stale) {
          this.handlers.delete(accessory.UUID);
          const index = this.accessories.indexOf(accessory);
          if (index >= 0) {
            this.accessories.splice(index, 1);
          }
        }
      }

      const skipped = appliances.length - supported.length;
      this.log.info(
        'hOn discovery complete: %d supported laundry appliance(s)%s.',
        supported.length,
        skipped ? `, ${skipped} unsupported appliance(s) skipped` : '',
      );
    } catch (error) {
      const message =
        error instanceof HOnApiError ? error.message : safeErrorMessage(error);
      this.log.error('hOn connection error: %s', message);
    } finally {
      this.discovering = false;
    }
  }

  private async pollAndSchedule(): Promise<void> {
    const succeeded = await this.pollAll();
    this.consecutivePollFailures = succeeded
      ? 0
      : this.consecutivePollFailures + 1;

    const active = [...this.handlers.values()].some((handler) => handler.isActive);
    const delay = calculatePollDelaySeconds(
      this.pollIntervalSeconds,
      this.idlePollIntervalSeconds,
      active,
      this.consecutivePollFailures,
    );

    if (!succeeded) {
      this.log.warn('Next hOn refresh attempt in %d seconds.', delay);
    }
    this.pollTimer = setTimeout(() => {
      void this.pollAndSchedule();
    }, delay * 1_000);
  }

  private async pollAll(): Promise<boolean> {
    if (this.polling || !this.handlers.size) {
      return true;
    }
    this.polling = true;

    try {
      const results = await Promise.allSettled(
        [...this.handlers.values()].map((handler) => handler.refresh()),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          this.log.warn('Unable to refresh an hOn appliance: %s', safeErrorMessage(result.reason));
        }
      }
      return results.every((result) => result.status === 'fulfilled');
    } finally {
      this.polling = false;
    }
  }
}
