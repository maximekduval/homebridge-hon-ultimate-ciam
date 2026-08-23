# Changelog

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
