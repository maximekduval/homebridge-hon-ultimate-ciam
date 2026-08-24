import * as hap from '@homebridge/hap-nodejs';
import type { API, Logger, PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import type { HOnApiClient } from '../src/hon-api';
import { LaundryAccessory } from '../src/laundry-accessory';
import type { HOnContextPayload } from '../src/types';

function runningContext(
  remainingMinutes: number,
  phase = 1,
): HOnContextPayload {
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
        doorLockStatus: { parNewVal: '1' },
        doorStatus: { parNewVal: '0' },
        machMode: { parNewVal: '2' },
        prPhase: { parNewVal: String(phase) },
      },
    },
  };
}

describe('LaundryAccessory HomeKit cycle timer', () => {
  it('publishes a countdown longer than the default 60-minute valve limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T16:00:00.000Z'));
    const getContext = vi
      .fn()
      .mockResolvedValueOnce(runningContext(78))
      .mockResolvedValueOnce(runningContext(78, 4))
      .mockResolvedValueOnce(runningContext(77, 3))
      .mockResolvedValueOnce({
        activity: {},
        lastConnEvent: { category: 'CONNECTED' },
        shadow: {
          parameters: {
            doorLockStatus: { parNewVal: '0' },
            doorStatus: { parNewVal: '1' },
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
    accessory.addService(hap.Service.ContactSensor, 'Lave-linge Door', 'door');
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
    const doorLock = accessory.getServiceById(
      hap.Service.LockMechanism,
      'door-lock',
    );

    expect(valve).toBeDefined();
    expect(doorLock).toBeDefined();
    expect(
      accessory.getServiceById(hap.Service.ContactSensor, 'door'),
    ).toBeUndefined();
    expect(valve!.isPrimaryService).toBe(true);
    const remainingDuration = valve!.getCharacteristic(
      hap.Characteristic.RemainingDuration,
    );
    const setDuration = valve!.getCharacteristic(hap.Characteristic.SetDuration);
    const currentDoorLockState = doorLock!.getCharacteristic(
      hap.Characteristic.LockCurrentState,
    );
    const washing = accessory.getServiceById(
      hap.Service.OccupancySensor,
      'laundry-phase-washing',
    );
    const rinsing = accessory.getServiceById(
      hap.Service.OccupancySensor,
      'laundry-phase-rinsing',
    );
    const spinning = accessory.getServiceById(
      hap.Service.OccupancySensor,
      'laundry-phase-spinning',
    );
    const finished = accessory.getServiceById(
      hap.Service.OccupancySensor,
      'laundry-phase-finished',
    );

    expect(remainingDuration.props.maxValue).toBe(86_400);
    expect(setDuration.props.maxValue).toBe(86_400);
    expect(washing).toBeDefined();
    expect(rinsing).toBeDefined();
    expect(spinning).toBeDefined();
    expect(finished).toBeDefined();
    expect(currentDoorLockState.value).toBe(
      hap.Characteristic.LockCurrentState.UNSECURED,
    );
    expect(await currentDoorLockState.handleGetRequest()).toBe(
      hap.Characteristic.LockCurrentState.UNSECURED,
    );

    await laundryAccessory.refresh();
    expect(remainingDuration.value).toBe(4_680);
    expect(setDuration.value).toBe(4_680);
    expect(
      washing!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    expect(
      rinsing!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    expect(
      currentDoorLockState.value,
    ).toBe(hap.Characteristic.LockCurrentState.SECURED);
    expect(
      doorLock!.getCharacteristic(hap.Characteristic.LockTargetState).value,
    ).toBe(hap.Characteristic.LockTargetState.SECURED);

    vi.advanceTimersByTime(4_000);
    expect(await remainingDuration.handleGetRequest()).toBe(4_676);

    vi.advanceTimersByTime(26_000);
    await laundryAccessory.refresh();
    expect(remainingDuration.value).toBe(4_650);
    expect(await remainingDuration.handleGetRequest()).toBe(4_650);
    expect(setDuration.value).toBe(4_680);
    expect(
      washing!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    expect(
      rinsing!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);

    vi.advanceTimersByTime(30_000);
    await laundryAccessory.refresh();
    expect(remainingDuration.value).toBe(4_620);
    expect(setDuration.value).toBe(4_680);
    expect(
      rinsing!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    expect(
      spinning!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);

    await laundryAccessory.refresh();
    expect(remainingDuration.value).toBe(0);
    expect(setDuration.value).toBe(0);
    expect(
      spinning!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    expect(
      finished!.getCharacteristic(hap.Characteristic.OccupancyDetected).value,
    ).toBe(hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    expect(
      currentDoorLockState.value,
    ).toBe(hap.Characteristic.LockCurrentState.UNSECURED);
    expect(
      doorLock!.getCharacteristic(hap.Characteristic.LockTargetState).value,
    ).toBe(hap.Characteristic.LockTargetState.UNSECURED);

    vi.useRealTimers();
  });
});
