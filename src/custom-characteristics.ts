import type { API, Characteristic, Service } from 'homebridge';

function getOrCreateStringCharacteristic(
  api: API,
  service: Service,
  displayName: string,
  identifier: string,
): Characteristic {
  const characteristicUuid = api.hap.uuid.generate(
    `homebridge-hon-ultimate-mk:${identifier}`,
  );
  const existing = service.characteristics.find(
    (characteristic) => characteristic.UUID === characteristicUuid,
  );
  if (existing) {
    return existing;
  }

  const characteristic = new api.hap.Characteristic(
    displayName,
    characteristicUuid,
    {
      format: api.hap.Formats.STRING,
      perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
    },
  );
  service.addCharacteristic(characteristic);
  return characteristic;
}

export interface LaundryCustomCharacteristics {
  phase: Characteristic;
  program: Characteristic;
}

export function createLaundryCustomCharacteristics(
  api: API,
  service: Service,
): LaundryCustomCharacteristics {
  return {
    phase: getOrCreateStringCharacteristic(
      api,
      service,
      'Program Phase',
      'program-phase',
    ),
    program: getOrCreateStringCharacteristic(
      api,
      service,
      'Current Program',
      'current-program',
    ),
  };
}
