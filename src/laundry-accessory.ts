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
const PHASE_SERVICE_SUBTYPE_PREFIX = 'laundry-phase-';

type PhaseSensorId =
  | 'weighing'
  | 'washing'
  | 'rinsing'
  | 'spinning'
  | 'drying'
  | 'steam'
  | 'finished';

interface PhaseSensorDefinition {
  id: PhaseSensorId;
  name: string;
}

const PHASE_SENSOR_DEFINITIONS: PhaseSensorDefinition[] = [
  { id: 'weighing', name: 'Pesage' },
  { id: 'washing', name: 'Lavage' },
  { id: 'rinsing', name: 'Rinçage' },
  { id: 'spinning', name: 'Essorage' },
  { id: 'drying', name: 'Séchage' },
  { id: 'steam', name: 'Vapeur / Refresh' },
  { id: 'finished', name: 'Terminé' },
];

function applianceType(device: HOnAppliance): string {
  return device.applianceTypeName ?? device.applianceTypeCode ?? '';
}

function applianceName(device: HOnAppliance): string {
  return device.nickName || device.modelName || `hOn ${applianceType(device)}`;
}

export class LaundryAccessory {
  private readonly customCharacteristics: LaundryCustomCharacteristics;
  private cycleDurationSeconds = 0;
  private lastReportedRemainingSeconds: number | undefined;
  private lastSummary = '';
  private readonly lockService?: Service;
  private readonly phaseServices = new Map<PhaseSensorId, Service>();
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
    exposePhaseSensors = true,
    exposeDoorLock = true,
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
    this.valveService.setPrimaryService();

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

    this.removeLegacyDoorContactService();
    this.lockService = this.configureDoorLockService(exposeDoorLock);
    this.configurePhaseServices(exposePhaseSensors);

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

  public get shouldPollRapidly(): boolean {
    // hOn can briefly keep machMode at "ready" after a program starts. The
    // door lock changes first, so keep polling at the active interval until
    // the cloud publishes the running state (and until it unlocks at the end).
    return this.state.active || this.effectiveDoorLocked();
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
      this.state.doorOpen,
      this.effectiveDoorLocked(),
      this.state.error ?? '',
    ].join('|');
    if (summary !== this.lastSummary) {
      this.lastSummary = summary;
      this.log.info(
        '%s: %s, phase %s, remaining %d min, door %s/%s%s',
        applianceName(this.device),
        this.state.machineMode,
        this.state.phase,
        Math.ceil(this.state.remainingSeconds / 60),
        this.state.doorOpen ? 'open' : 'closed',
        this.effectiveDoorLocked() ? 'locked' : 'unlocked',
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

  private removeLegacyDoorContactService(): void {
    const existing = this.accessory.getServiceById(
      this.api.hap.Service.ContactSensor,
      'door',
    );
    if (existing) {
      this.accessory.removeService(existing);
    }
  }

  private configureDoorLockService(exposeDoorLock: boolean): Service | undefined {
    const { Characteristic, Service } = this.api.hap;
    const existing = this.accessory.getServiceById(
      Service.LockMechanism,
      'door-lock',
    );

    if (!exposeDoorLock) {
      if (existing) {
        this.accessory.removeService(existing);
      }
      return undefined;
    }

    const service =
      existing ??
      this.accessory.addService(
        Service.LockMechanism,
        'Verrouillage porte',
        'door-lock',
      );
    service.setCharacteristic(Characteristic.Name, 'Verrouillage porte');
    service
      .getCharacteristic(Characteristic.LockCurrentState)
      .onGet(() => this.currentDoorLockStateValue())
      .updateValue(this.currentDoorLockStateValue());
    service
      .getCharacteristic(Characteristic.LockTargetState)
      .onGet(() => this.targetDoorLockStateValue())
      .onSet((value) => this.rejectDoorLockControl(value))
      .updateValue(this.targetDoorLockStateValue());
    this.valveService.addLinkedService(service);
    return service;
  }

  private effectiveDoorLocked(): boolean {
    if (this.state.doorOpen) {
      return false;
    }
    return this.state.doorLocked ?? this.state.active;
  }

  private currentDoorLockStateValue(): number {
    const { Characteristic } = this.api.hap;
    return this.effectiveDoorLocked()
      ? Characteristic.LockCurrentState.SECURED
      : Characteristic.LockCurrentState.UNSECURED;
  }

  private targetDoorLockStateValue(): number {
    const { Characteristic } = this.api.hap;
    return this.effectiveDoorLocked()
      ? Characteristic.LockTargetState.SECURED
      : Characteristic.LockTargetState.UNSECURED;
  }

  private rejectDoorLockControl(value: CharacteristicValue): void {
    const requestedLocked =
      Number(value) === this.api.hap.Characteristic.LockTargetState.SECURED;
    if (requestedLocked === this.effectiveDoorLocked()) {
      return;
    }

    throw new this.api.hap.HapStatusError(
      this.api.hap.HAPStatus.READ_ONLY_CHARACTERISTIC,
    );
  }

  private configurePhaseServices(exposePhaseSensors: boolean): void {
    const { Characteristic, Service } = this.api.hap;
    const existingPhaseServices = this.accessory.services.filter(
      (service) =>
        service.UUID === Service.OccupancySensor.UUID &&
        service.subtype?.startsWith(PHASE_SERVICE_SUBTYPE_PREFIX),
    );

    if (!exposePhaseSensors) {
      for (const service of existingPhaseServices) {
        this.accessory.removeService(service);
      }
      return;
    }

    for (const definition of PHASE_SENSOR_DEFINITIONS) {
      const subtype = `${PHASE_SERVICE_SUBTYPE_PREFIX}${definition.id}`;
      const service =
        this.accessory.getServiceById(Service.OccupancySensor, subtype) ??
        this.accessory.addService(
          Service.OccupancySensor,
          definition.name,
          subtype,
        );
      service.setCharacteristic(Characteristic.Name, definition.name);
      service
        .getCharacteristic(Characteristic.OccupancyDetected)
        .onGet(() => this.phaseSensorValue(definition.id));
      service
        .getCharacteristic(Characteristic.StatusActive)
        .onGet(() => this.state.connected);
      service
        .getCharacteristic(Characteristic.StatusFault)
        .onGet(() => this.statusFaultValue());
      this.phaseServices.set(definition.id, service);
      this.valveService.addLinkedService(service);
    }
  }

  private phaseSensorDetected(id: PhaseSensorId): boolean {
    const type = applianceType(this.device);

    if (id === 'finished') {
      return this.state.machineMode === 'finished';
    }
    if (!this.state.active) {
      return false;
    }

    switch (id) {
      case 'drying':
        return (
          ['drying', 'cooldown', 'tumbling'].includes(this.state.phase) ||
          (type === 'TD' && this.state.phase === 'heating')
        );
      case 'steam':
        return ['steam', 'refresh'].includes(this.state.phase);
      case 'washing':
        return (
          this.state.phase === 'washing' ||
          (type !== 'TD' && this.state.phase === 'heating')
        );
      default:
        return this.state.phase === id;
    }
  }

  private phaseSensorValue(id: PhaseSensorId): number {
    const { Characteristic } = this.api.hap;
    return this.phaseSensorDetected(id)
      ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
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

    this.lockService
      ?.updateCharacteristic(
        Characteristic.LockCurrentState,
        this.currentDoorLockStateValue(),
      )
      .updateCharacteristic(
        Characteristic.LockTargetState,
        this.targetDoorLockStateValue(),
      );

    for (const [id, service] of this.phaseServices) {
      service
        .updateCharacteristic(
          Characteristic.OccupancyDetected,
          this.phaseSensorValue(id),
        )
        .updateCharacteristic(Characteristic.StatusActive, this.state.connected)
        .updateCharacteristic(Characteristic.StatusFault, this.statusFaultValue());
    }

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
