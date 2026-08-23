import type {
  API,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';

import {
  createLaundryCustomCharacteristics,
  type LaundryCustomCharacteristics,
} from './custom-characteristics';
import { HOnApiClient } from './hon-api';
import { normalizeLaundryState } from './state';
import type { HOnAppliance, LaundryState } from './types';

const DEFAULT_STATE: LaundryState = {
  active: false,
  connected: false,
  machineMode: 'unknown',
  phase: 'unknown',
  remainingSeconds: 0,
  remoteControl: false,
};

const MAX_CYCLE_DURATION_SECONDS = 24 * 60 * 60;

function applianceType(device: HOnAppliance): string {
  return device.applianceTypeName ?? device.applianceTypeCode ?? '';
}

function applianceName(device: HOnAppliance): string {
  return device.nickName || device.modelName || `hOn ${applianceType(device)}`;
}

export class LaundryAccessory {
  private readonly contactService: Service;
  private readonly customCharacteristics: LaundryCustomCharacteristics;
  private cycleDurationSeconds = 0;
  private lastReportedRemainingSeconds: number | undefined;
  private lastSummary = '';
  private remainingSecondsAtSync = 0;
  private remainingSyncTimestampMs = 0;
  private state = DEFAULT_STATE;
  private readonly valveService: Service;

  public constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly client: HOnApiClient,
    private readonly accessory: PlatformAccessory,
    private device: HOnAppliance,
  ) {
    const { Characteristic, Service } = api.hap;
    const name = applianceName(device);

    this.valveService =
      accessory.getService(Service.Valve) ??
      accessory.addService(Service.Valve, name, 'laundry-cycle');
    this.valveService
      .setCharacteristic(Characteristic.Name, name)
      .setCharacteristic(
        Characteristic.ValveType,
        Characteristic.ValveType.GENERIC_VALVE,
      );

    this.valveService
      .getCharacteristic(Characteristic.Active)
      .onGet(
        () =>
          this.state.active
            ? Characteristic.Active.ACTIVE
            : Characteristic.Active.INACTIVE,
      )
      .onSet((value) => this.rejectRemoteControl(value));
    this.valveService
      .getCharacteristic(Characteristic.InUse)
      .onGet(
        () =>
          this.state.active
            ? Characteristic.InUse.IN_USE
            : Characteristic.InUse.NOT_IN_USE,
      );
    this.valveService
      .getCharacteristic(Characteristic.RemainingDuration)
      .setProps({ maxValue: MAX_CYCLE_DURATION_SECONDS })
      .onGet(() => this.currentRemainingSeconds());
    this.valveService
      .getCharacteristic(Characteristic.SetDuration)
      .setProps({ maxValue: MAX_CYCLE_DURATION_SECONDS })
      .onGet(() => this.cycleDurationSeconds)
      .onSet((value) => this.rejectSetDuration(value));
    this.valveService
      .getCharacteristic(Characteristic.StatusFault)
      .onGet(() => this.statusFaultValue());

    this.contactService =
      accessory.getServiceById(Service.ContactSensor, 'door') ??
      accessory.addService(Service.ContactSensor, `${name} Door`, 'door');
    this.contactService.setCharacteristic(
      Characteristic.Name,
      `${name} Door`,
    );
    this.contactService
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() => this.contactStateValue());
    this.contactService
      .getCharacteristic(Characteristic.StatusFault)
      .onGet(() => this.statusFaultValue());
    this.valveService.addLinkedService(this.contactService);

    this.customCharacteristics = createLaundryCustomCharacteristics(
      api,
      this.valveService,
    );
    this.configureAccessoryInformation();
  }

  public updateDevice(device: HOnAppliance): void {
    this.device = device;
    this.accessory.context.device = device;
    this.configureAccessoryInformation();
  }

  public async refresh(): Promise<void> {
    const payload = await this.client.getContext(this.device);
    const wasActive = this.state.active;
    this.state = normalizeLaundryState(payload, applianceType(this.device));
    this.updateCycleTiming(wasActive);
    this.updateCharacteristics();

    const summary = [
      this.state.machineMode,
      this.state.phase,
      this.state.program ?? '',
      this.state.remainingSeconds,
      this.state.connected,
      this.state.error ?? '',
    ].join('|');
    if (summary !== this.lastSummary) {
      this.lastSummary = summary;
      this.log.info(
        '%s: %s, phase %s, remaining %d min%s',
        applianceName(this.device),
        this.state.machineMode,
        this.state.phase,
        Math.ceil(this.state.remainingSeconds / 60),
        this.state.error ? `, error ${this.state.error}` : '',
      );
    }
  }

  private rejectRemoteControl(value: CharacteristicValue): void {
    const requestedActive = Number(value) === this.api.hap.Characteristic.Active.ACTIVE;
    if (requestedActive === this.state.active) {
      return;
    }

    throw new this.api.hap.HapStatusError(
      this.api.hap.HAPStatus.READ_ONLY_CHARACTERISTIC,
    );
  }

  private rejectSetDuration(value: CharacteristicValue): void {
    if (Number(value) === this.cycleDurationSeconds) {
      return;
    }

    throw new this.api.hap.HapStatusError(
      this.api.hap.HAPStatus.READ_ONLY_CHARACTERISTIC,
    );
  }

  private currentRemainingSeconds(): number {
    if (!this.state.active || this.remainingSecondsAtSync <= 0) {
      return 0;
    }

    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - this.remainingSyncTimestampMs) / 1_000),
    );
    return Math.max(0, this.remainingSecondsAtSync - elapsedSeconds);
  }

  private updateCycleTiming(wasActive: boolean): void {
    if (!this.state.active) {
      this.cycleDurationSeconds = 0;
      this.lastReportedRemainingSeconds = undefined;
      this.remainingSecondsAtSync = 0;
      this.remainingSyncTimestampMs = 0;
      return;
    }

    if (
      !wasActive ||
      this.lastReportedRemainingSeconds !== this.state.remainingSeconds
    ) {
      this.lastReportedRemainingSeconds = this.state.remainingSeconds;
      this.remainingSecondsAtSync = this.state.remainingSeconds;
      this.remainingSyncTimestampMs = Date.now();
    }

    this.cycleDurationSeconds = wasActive
      ? Math.max(this.cycleDurationSeconds, this.state.remainingSeconds)
      : this.state.remainingSeconds;
  }

  private statusFaultValue(): number {
    const { Characteristic } = this.api.hap;
    return !this.state.connected || Boolean(this.state.error)
      ? Characteristic.StatusFault.GENERAL_FAULT
      : Characteristic.StatusFault.NO_FAULT;
  }

  private contactStateValue(): number {
    const { Characteristic } = this.api.hap;
    return this.state.doorOpen
      ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  private updateCharacteristics(): void {
    const { Characteristic } = this.api.hap;
    this.valveService
      .updateCharacteristic(
        Characteristic.Active,
        this.state.active
          ? Characteristic.Active.ACTIVE
          : Characteristic.Active.INACTIVE,
      )
      .updateCharacteristic(
        Characteristic.InUse,
        this.state.active
          ? Characteristic.InUse.IN_USE
          : Characteristic.InUse.NOT_IN_USE,
      )
      .updateCharacteristic(
        Characteristic.SetDuration,
        this.cycleDurationSeconds,
      )
      .updateCharacteristic(
        Characteristic.RemainingDuration,
        this.currentRemainingSeconds(),
      )
      .updateCharacteristic(Characteristic.StatusFault, this.statusFaultValue());

    this.contactService
      .updateCharacteristic(
        Characteristic.ContactSensorState,
        this.contactStateValue(),
      )
      .updateCharacteristic(Characteristic.StatusFault, this.statusFaultValue());

    this.customCharacteristics.phase.updateValue(this.state.phase);
    this.customCharacteristics.program.updateValue(this.state.program ?? '');
  }

  private configureAccessoryInformation(): void {
    const { Characteristic, Service } = this.api.hap;
    const information =
      this.accessory.getService(Service.AccessoryInformation) ??
      this.accessory.addService(Service.AccessoryInformation);
    information
      .setCharacteristic(Characteristic.Manufacturer, this.device.brand ?? 'hOn')
      .setCharacteristic(
        Characteristic.Model,
        this.device.modelName ?? applianceType(this.device),
      )
      .setCharacteristic(
        Characteristic.SerialNumber,
        this.device.serialNumber ?? this.device.macAddress,
      )
      .setCharacteristic(
        Characteristic.FirmwareRevision,
        this.device.fwVersion ?? 'unknown',
      );
  }
}
