import { describe, expect, it } from 'vitest';

import { normalizeLaundryState } from '../src/state';

describe('normalizeLaundryState', () => {
  it('normalizes a running Haier washing-machine cycle', () => {
    const state = normalizeLaundryState(
      {
        activity: {
          category: 'CYCLE',
          attributes: {
            prStrDisp: 'Cotton',
            remainingTimeMM: '106',
          },
        },
        lastConnEvent: { category: 'CONNECTED' },
        shadow: {
          parameters: {
            doorStatus: { parNewVal: '0' },
            error: { parNewVal: '00' },
            machMode: { parNewVal: '2' },
            prPhase: { parNewVal: '1' },
            remoteCtrValid: { parNewVal: '1' },
            spinSpeed: { parNewVal: '1400' },
            temp: { parNewVal: '40' },
          },
        },
      },
      'WM',
    );

    expect(state).toMatchObject({
      active: true,
      connected: true,
      doorOpen: false,
      error: undefined,
      machineMode: 'running',
      phase: 'washing',
      program: 'Cotton',
      remainingSeconds: 6_360,
      remoteControl: true,
      spinSpeed: 1_400,
      temperature: 40,
    });
  });

  it('prefers live shadow parameters over stale cycle attributes', () => {
    const state = normalizeLaundryState(
      {
        activity: {
          category: 'CYCLE',
          attributes: {
            prStrDisp: 'Cotton',
            remainingTimeMM: '78',
          },
        },
        lastConnEvent: { category: 'CONNECTED' },
        shadow: {
          parameters: {
            machMode: { parNewVal: '2' },
            prPhase: { parNewVal: '1' },
            remainingTimeMM: { parNewVal: '51' },
          },
        },
      },
      'WM',
    );

    expect(state.program).toBe('Cotton');
    expect(state.remainingSeconds).toBe(3_060);
  });

  it('does not report a selected program as a running cycle', () => {
    const state = normalizeLaundryState(
      {
        activity: {},
        lastConnEvent: { category: 'CONNECTED' },
        shadow: {
          parameters: {
            machMode: { parNewVal: '1' },
            prPhase: { parNewVal: '0' },
            remainingTimeMM: { parNewVal: '170' },
          },
        },
      },
      'WM',
    );

    expect(state.active).toBe(false);
    expect(state.machineMode).toBe('ready');
    expect(state.remainingSeconds).toBe(0);
  });

  it('maps tumble-dryer phases independently from washing phases', () => {
    const state = normalizeLaundryState(
      {
        activity: { category: 'CYCLE' },
        shadow: {
          parameters: {
            machMode: { parNewVal: '2' },
            prPhase: { parNewVal: '3' },
          },
        },
      },
      'TD',
    );

    expect(state.phase).toBe('cooldown');
  });

  it('marks disconnected appliances and non-zero errors as faulty', () => {
    const state = normalizeLaundryState(
      {
        activity: {},
        lastConnEvent: { category: 'DISCONNECTED' },
        shadow: {
          parameters: {
            error: { parNewVal: 'E07' },
            machMode: { parNewVal: '6' },
          },
        },
      },
      'WM',
    );

    expect(state.connected).toBe(false);
    expect(state.error).toBe('E07');
    expect(state.machineMode).toBe('error');
  });
});
