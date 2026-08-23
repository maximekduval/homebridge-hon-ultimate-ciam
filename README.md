# Homebridge hOn Ultimate CIAM

Unofficial Homebridge plugin for Haier, Candy, and Hoover laundry appliances
connected through the hOn cloud.

This fork replaces the deleted Cognito client used by
`homebridge-hon-ultimate@1.0.5` with hOn's current CIAM/PKCE authentication and
the unified appliance API introduced in 2026.

> This is beta software backed by an undocumented cloud API. hOn can change the
> API without notice. Do not remove the official hOn app.

## Supported appliances

- Washing machines (`WM`)
- Washer-dryers (`WD`)
- Tumble dryers (`TD`)

The first target washing machine is the Haier `HW100-B14367U-FR`. The API
implementation is intentionally model-independent, but this exact model still
needs a real-device validation before the beta label can be removed.

## HomeKit services

Each laundry appliance is exposed as a read-only valve-style cycle monitor with:

- active/in-use state;
- remaining duration;
- current program and phase (custom read-only characteristics);
- connection and appliance-error fault state;
- a linked door contact sensor.

Remote start/stop is deliberately disabled in the first CIAM release. Washing
machines require a valid remote-control state and a complete program payload;
silently sending an incomplete command would be unsafe and unreliable.

## Requirements

- Node.js 20.11 or later
- Homebridge 1.8 or later
- An hOn account with a supported appliance

## Installation

During local testing:

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
      "pollInterval": 30
    }
  ]
}
```

The deprecated `email` key is also accepted as an alias for `username`.

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

## Preparing the npm publication

The provisional package name is `homebridge-hon-ultimate-ciam`, which was
available when this fork was created. Before publishing:

1. validate on the target washer;
2. remove the beta suffix only after successful validation;
3. run `npm publish --access public` from an npm account allowed to publish the
   chosen name.

## Credits

- `homebridge-hon-ultimate` by jayc68 (MIT package metadata)
- [pyhon-revived](https://github.com/mmalolepszy/pyhon-revived) for the maintained
  hOn authentication/API behavior
- [hon-test-data](https://github.com/mmalolepszy/hon-test-data) for appliance
  response-shape references

This project is not affiliated with Haier, Candy, Hoover, Homebridge, or Apple.
