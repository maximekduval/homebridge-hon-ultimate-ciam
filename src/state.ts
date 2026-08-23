import type {
  HOnContextPayload,
  HOnParameterValue,
  LaundryState,
} from './types';

const MACHINE_MODES: Record<number, string> = {
  0: 'ready',
  1: 'ready',
  2: 'running',
  3: 'paused',
  4: 'scheduled',
  5: 'scheduled',
  6: 'error',
  7: 'finished',
  8: 'test',
  9: 'stopping',
};

const WASHING_PHASES: Record<number, string> = {
  0: 'ready',
  1: 'washing',
  2: 'washing',
  3: 'spinning',
  4: 'rinsing',
  5: 'rinsing',
  6: 'rinsing',
  7: 'drying',
  8: 'drying',
  9: 'steam',
  10: 'ready',
  11: 'spinning',
  12: 'weighing',
  13: 'weighing',
  14: 'washing',
  15: 'washing',
  16: 'washing',
  17: 'rinsing',
  18: 'rinsing',
  19: 'scheduled',
  20: 'tumbling',
  24: 'refresh',
  25: 'washing',
  26: 'heating',
  27: 'washing',
};

const DRYING_PHASES: Record<number, string> = {
  0: 'ready',
  1: 'heating',
  2: 'drying',
  3: 'cooldown',
  11: 'ready',
  13: 'cooldown',
  14: 'heating',
  15: 'heating',
  16: 'cooldown',
  18: 'tumbling',
  19: 'drying',
  20: 'drying',
};

function parameterValue(value: HOnParameterValue | unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const wrapped = value as HOnParameterValue;
  return wrapped.parNewVal ?? wrapped.parValue ?? wrapped.value;
}

function toNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value) === '1' || String(value).toLowerCase() === 'true';
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === 'object' && Object.keys(value as object).length,
  );
}

export function normalizeLaundryState(
  payload: HOnContextPayload,
  applianceType: string,
): LaundryState {
  const rawParameters = payload.shadow?.parameters ?? {};
  const parameters = Object.fromEntries(
    Object.entries(rawParameters).map(([key, value]) => [key, parameterValue(value)]),
  );
  const activity = isNonEmptyObject(payload.activity) ? payload.activity : undefined;
  const activityAttributes = isNonEmptyObject(activity?.attributes)
    ? (activity.attributes as Record<string, unknown>)
    : {};
  // Activity attributes describe the cycle that was launched and can keep its
  // original duration for the whole run. The shadow contains the appliance's
  // live parameters, so it must win whenever both sources expose the same key.
  const values = { ...activityAttributes, ...parameters };

  const machineModeValue = toNumber(values.machMode) ?? 0;
  const phaseValue = toNumber(values.prPhase) ?? 0;
  const active =
    Boolean(activity) || [2, 3, 9].includes(machineModeValue);
  const remainingMinutes = Math.max(0, toNumber(values.remainingTimeMM) ?? 0);
  const phaseMap = applianceType === 'TD' ? DRYING_PHASES : WASHING_PHASES;
  const rawError = String(values.error ?? values.errors ?? '').trim();
  const error = rawError && !/^0+$/u.test(rawError) ? rawError : undefined;
  const programValue =
    values.prStrDisp ?? values.programName ?? values.program ?? values.prCode;

  return {
    active,
    connected: payload.lastConnEvent?.category !== 'DISCONNECTED',
    doorLocked: toBoolean(values.doorLockStatus ?? values.doorLock),
    doorOpen: toBoolean(values.doorStatus),
    error,
    machineMode: MACHINE_MODES[machineModeValue] ?? `unknown (${machineModeValue})`,
    phase: phaseMap[phaseValue] ?? `unknown (${phaseValue})`,
    program:
      programValue === undefined || programValue === ''
        ? undefined
        : String(programValue),
    remainingSeconds: active ? Math.round(remainingMinutes * 60) : 0,
    remoteControl: toBoolean(values.remoteCtrValid) ?? false,
    spinSpeed: toNumber(values.spinSpeed),
    temperature: toNumber(values.temp),
  };
}
