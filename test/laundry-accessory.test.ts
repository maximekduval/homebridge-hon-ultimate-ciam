import * as hap from '@homebridge/hap-nodejs';
import type { API, Logger, PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import type { HOnApiClient } from '../src/hon-api';
import { LaundryAccessory } from '../src/laundry-accessory';
import type { HOnContextPayload } from '../src/types';

function runningContext(remainingMinutes: number): HOnContextPayload {
  return {
    activity: {
      category: 'CYCLE',
      attributes: {
        remainingTimeMM: String(remainingMinutes),
      },
    },
    lastConnEvent: { category: 'CONNECTED' },
    shadow: {
      parameters: {
        doorStatus: { parNewVal: '0' },
        machMode: { parNewVal: '2' },
        prPhase: { parNewVal: '1' },
      },
    },
  };
}

describe('LaundryAccessory HomeKit cycle timer', () => {
  it('publishes a countdown longer than the default 60-minute valve limit', async () => {
    const getContext = vi
      .fn()
      .mockResolvedValueOnce(runningContext(78))
      .mockResolvedValueOnce(runningContext(77))
      .mockResolvedValueOnce({
        activity: {},
        lastConnEvent: { category: 'CONNECTED' },
        shadow: {
          parameters: {
            machMode: { parNewVal: '7' },
            prPhase: { parNewVal: '0' },
            remainingTimeMM: { parNewVal: '0' },
          },
        },
      });
    const client = { getContext } as unknown as HOnApiClient;
    const log = { info: vi.fn() } as unknown as Logger;
    const accessory = new hap.Accessory(
      'Lave-linge',
      hap.uuid.generate('test-washing-machine'),
    ) as unknown as PlatformAccessory;
    (accessory as PlatformAccessory & { context: Record<string, unknown> }).context = {};
    const laundryAccessory = new LaundryAccessory(
      { hap } as unknown as API,
      log,
      client,
      accessory,
      {
        applianceTypeName: 'WM',
        macAddress: 'aa-bb-cc-dd-ee-ff',
        modelName: 'HW100-B14367U-FR',
      },
    );
    const valve = accessory.getService(hap.Service.Valve);

    expect(valve).toBeDefined();
    const remainingDuration = valve!.getCharacteristic(
      hap.Characteristic.RemainingDuration,
    );
    const setDuration = valve!.getCharacteristic(hap.Characteristic.SetDuration);

    expect(remainingDuration.props.maxValue).toBe(86_400);
    expect(setDuration.props.maxValue).toBe(86_400);

    await laundryAccessory.refresh();
    expect(remainingDuration.value).toBe(4_680);
    expect(setDuration.value).toBe(4_680);

    await laundryAccessory.refresh();
    expect(remainingDuration.value).toBe(4_620);
    expect(setDuration.value).toBe(4_680);

    await laundryAccessory.refresh();
    expect(remainingDuration.value).toBe(0);
    expect(setDuration.value).toBe(0);
  });
});
