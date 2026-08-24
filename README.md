# Homebridge hOn Ultimate MK

Unofficial Homebridge plugin for Haier, Candy, and Hoover laundry appliances
connected through the hOn cloud.

This fork replaces the deleted Cognito client used by
`homebridge-hon-ultimate@1.0.5` with hOn's current CIAM/PKCE authentication and
the unified appliance API introduced in 2026.

> This plugin relies on an undocumented cloud API. hOn can change the API
> without notice. Do not remove the official hOn app.

## Supported appliances

- Washing machines (`WM`)
- Washer-dryers (`WD`)
- Tumble dryers (`TD`)

The first target washing machine is the Haier `HW100-B14367U-FR`. The API
implementation is intentionally model-independent; real-device feedback for
this exact model is welcome.

## HomeKit services

Each laundry appliance is exposed as a read-only valve-style cycle monitor with:

- active/in-use state;
- remaining duration, including programs longer than 60 minutes;
- current program and phase (custom read-only characteristics);
- connection and appliance-error fault state;
- a linked door contact sensor;
- a linked, read-only door lock showing locked/unlocked state.

By default, the same accessory also exposes linked, read-only phase sensors for
weighing, washing, rinsing, spinning, drying, steam/refresh, and cycle
completion. These standard occupancy sensors are visible in Apple Home and can
be used in automations. Set `exposePhaseSensors` to `false` to hide them.

The door lock uses hOn's dedicated lock parameter when the appliance publishes
it. On models without that parameter, the plugin safely infers the lock from
the physical door and running-cycle states. Set `exposeDoorLock` to `false` to
hide the lock service.

Remote start/stop is deliberately disabled in the first CIAM release. Washing
machines require a valid remote-control state and a complete program payload;
silently sending an incomplete command would be unsafe and unreliable.

## Requirements

- Node.js 20.11 or later
- Homebridge 1.8 or later
- An hOn account with a supported appliance

## Installation

From npm:

```shell
sudo npm install -g homebridge-hon-ultimate-mk
```

For local development:

```shell
npm install
npm run build
npm link
```

Before installing this fork, uninstall `homebridge-hon-ultimate`. Both plugins
use the `hOnUltimate` platform alias and must not run at the same time.

## Configuration

The original configuration keys remain valid:

```json
{
  "platforms": [
    {
      "platform": "hOnUltimate",
      "name": "hOn Ultimate",
      "username": "your-hon-account@example.com",
      "password": "your-hon-password",
      "pollInterval": 30,
      "idlePollInterval": 300,
      "exposeDoorLock": true,
      "exposePhaseSensors": true
    }
  ]
}
```

The deprecated `email` key is also accepted as an alias for `username`.

Polling is adaptive: `pollInterval` is used during a running cycle and
`idlePollInterval` while every appliance is idle. The defaults are 30 seconds
and five minutes respectively. Persistent API failures use exponential backoff
up to 30 minutes. Authentication is renewed automatically before hOn's
eight-hour token expires.

If an accessory from the old package remains after migration, use Homebridge
UI's cached-accessory removal tool once, then restart the child bridge. The
configuration block itself does not need to change.

## Security

- Credentials are sent only to hOn's HTTPS CIAM endpoint.
- Credentials and full authentication URLs are never logged.
- Tokens are kept in memory and are recreated after a Homebridge restart.
- No remote-control command is sent in this release.

## Development

```shell
npm run check
npm test
npm run build
npm pack --dry-run
```

The state normalizer is covered with representative `WM`, `WD`, and `TD` API
shapes. Live cloud tests are intentionally not included because they would
require personal hOn credentials.

## Credits

- `homebridge-hon-ultimate` by jayc68 (MIT package metadata)
- [pyhon-revived](https://github.com/mmalolepszy/pyhon-revived) for the maintained
  hOn authentication/API behavior
- [hon-test-data](https://github.com/mmalolepszy/hon-test-data) for appliance
  response-shape references

This project is not affiliated with Haier, Candy, Hoover, Homebridge, or Apple.
