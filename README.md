# HA Ship Radar

Ships near your home on a Home Assistant dashboard. Each vessel is drawn as a side-on silhouette
at its real bearing and distance from you, sized by length, with a wake when it is moving.
Inspired by [HABirdDashboard](https://github.com/adamoberley/HABirdDashboard).

```
AISStream.io  --websocket-->  Ship Radar app  --sensor.ship_radar-->  Ship Radar card
 (free API key)               (keeps a ship table,                     (radar + list)
                               filters to your area)
```

The app writes the ship list into the attributes of one sensor, so the card only reads Home Assistant
state. It works over Nabu Casa and HTTPS with no extra ports.

## Install

**1. The app** (needs Home Assistant OS or Supervised)

Settings > Apps (Add-ons) > menu > Repositories > add this repo's URL, install **Ship Radar**, paste your
free [AISStream](https://aisstream.io) API key into its options, start it, and check the log says
"Connected to AISStream".

**2. The card**

HACS > Custom repositories > add this repo as type **Dashboard**, download **Ship Radar Card**, reload.
Without HACS: copy `dist/ship-radar-card.js` to `/config/www/` and add `/local/ship-radar-card.js`
as a JavaScript module resource.

**3. Add it**

```yaml
type: custom:ship-radar-card
entity: sensor.ship_radar
```

Open `docs/preview.html` in a browser to see the card with mock data before installing anything.

## Card options

| Option | Default | |
|---|---|---|
| `entity` | `sensor.ship_radar` | Sensor written by the app |
| `title` | `Ships nearby` | |
| `view` | `radar` | `radar` or `list` (you can switch on the card) |
| `units` | `nm` | `nm` or `km` for distances |
| `scale` | `sqrt` | `sqrt` spreads out ships near home; `linear` is true to scale |
| `range_nm` | app radius | Zoom in to a smaller range |
| `labels` | `false` | Show every name that fits; tapping a ship always shows its name |
| `show_moored` | `true` | Hide moored and anchored ships when `false` |
| `max_age` | `30` | Hide ships not heard for this many minutes |

## Good to know

- Only the nearest 60 ships are published, to stay under Home Assistant's 16 KB attribute limit.
  Exclude the sensor from the recorder so history is not attempted:
  ```yaml
  recorder:
    exclude:
      entities:
        - sensor.ship_radar
  ```
- The sensor is written through the REST API, so it disappears after a Home Assistant restart until
  the app's next update (a few seconds).
- Ship names, destinations and so on are broadcast by the vessels themselves. The card escapes them
  before display.
- Silhouettes come from the AIS ship-type code. Ships that have not sent their type yet are drawn as a plain hull.
- Receiving and using AIS data is subject to AISStream's terms and your local rules.

## Development

```
python3 -m unittest discover -s tests   # relay logic
```
