# Ship Radar

Streams live AIS data for the area around your home from [AISStream.io](https://aisstream.io)
and publishes it as `sensor.ship_radar`. The **Ship Radar card** draws that sensor on your dashboard.

## Setup

1. Create a free account at aisstream.io and copy your API key.
2. Paste it into the **api_key** option below and start the app.
3. Add the dashboard card (see the repository README).

## Options

| Option | Default | Meaning |
|---|---|---|
| `api_key` | | Your AISStream API key. |
| `latitude`, `longitude` | home location | Leave empty to use Home Assistant's home location. |
| `radius_nm` | 30 | How far from home to watch, in nautical miles (5-150). |
| `expire_minutes` | 20 | Forget a ship after this long without a position report. |
| `entity_id` | `sensor.ship_radar` | Name of the sensor the app writes. |

## What the sensor holds

State: number of ships in range. Attributes: `ships` (the nearest 60, with distance, bearing, speed,
type, size, destination), `connected`, `error`, `updated`. A debug copy of the same data is at
`http://<home-assistant>:8099/ships.json` if you enable the port.

AISStream gets its data from volunteer receivers, so coverage varies. Ships only appear when a
receiver in range has heard them.
