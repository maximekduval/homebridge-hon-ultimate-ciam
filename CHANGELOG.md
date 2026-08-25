# Changelog

## 2.2.1

- Switch immediately to the active polling interval when an idle appliance
  reports its door locked, capturing weighing and other short startup phases
  before hOn changes `machMode` from ready to running.
- Return to the five-minute idle interval when the appliance is inactive and
  the door is unlocked.

## 2.2.0

- Renew the eight-hour hOn token with a complete CIAM/PKCE authentication
  instead of replaying a session that can keep returning rejected tokens.
- Retry an unauthorized API request once with the new credentials, without a
  Homebridge restart.
- Poll active cycles every 30 seconds but idle appliances every five minutes by
  default, reducing idle API traffic by 90 percent.
- Add exponential retry backoff up to 30 minutes so an API outage or persistent
  authorization error cannot generate a request and warning every 30 seconds.
- Add the configurable `idlePollInterval` setting.
- Remove the redundant door contact sensor and keep only the linked, read-only
  locked/unlocked service. Existing cached contact services are removed during
  accessory initialization.

## 2.1.2

- Initialize the linked door lock as unsecured instead of unknown before the
  first hOn refresh, preventing Apple Home from caching an `Unknown` summary.

## 2.1.1

- Add a linked, read-only HomeKit lock for the laundry door, matching the
  service layout used by the LG ThinQ Homebridge plugin.
- Read hOn's `doorLockStatus`/`doorLock` value when available and fall back to
  the appliance cycle state on models that do not publish a lock parameter.
- Include physical door and lock transitions in the appliance status log.
- Add the `exposeDoorLock` setting, enabled by default.

## 2.1.0

- Add linked, read-only HomeKit occupancy sensors for weighing, washing,
  rinsing, spinning, drying, steam/refresh and cycle completion.
- Make the timed valve the accessory's explicit primary service.
- Add the `exposePhaseSensors` setting, enabled by default.

## 2.0.3

- Prefer the appliance's live `shadow.parameters` over the static cycle-start
  attributes when both contain `remainingTimeMM` or another state field.
- Preserve activity-only metadata such as the selected program as a fallback.

## 2.0.2

- Keep a local running-cycle clock so reopening Apple Home returns the actual
  remaining seconds instead of restarting from hOn's last whole-minute value.
- Do not reset the local countdown when consecutive hOn polls report the same
  remaining minute.

## 2.0.1

- Publish both HomeKit valve duration characteristics so Apple Home can render
  the running-cycle countdown instead of showing a waiting state.
- Allow laundry cycles up to 24 hours instead of HomeKit's default 60-minute
  valve limit.

## 2.0.0

- Replace the deleted AWS Cognito app-client login with hOn CIAM/PKCE.
- Discover appliances through the post-June-2026 unified API endpoint.
- Add washing-machine (`WM`) support, targeting Haier HW100-B14367U-FR.
- Retain washer-dryer (`WD`) and tumble-dryer (`TD`) monitoring.
- Expose cycle state, remaining duration, door state, program, phase, and faults.
- Keep remote start/stop disabled until it can be tested safely on real hardware.
