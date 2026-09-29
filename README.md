# Glowy

Prototype project for Terra Labs experience design build sprint.

Narrative: Glowy is a fairylike creature that lives in a lantern, and who you take on quests / adventures through the environment. As you move around and tap the lantern to points of interest, Glowy's LEDs react and the state of the garden (projected on a web app) changes.

```
Flipper (in the flower) ──BLE broadcast "orb home/away"──► Photon 2 (in the orb)
   │ reads the orb's NFC card                         └──► laptop bridge.py ──► dashboard
   └─ drives the flower ring + stem LEDs (GPIO pin 2)
```

No pairing and no USB at demo time: the Flipper broadcasts its state dozens of times a
second and anything nearby just listens.

**Wiring, power and placement: see [WIRING.md](WIRING.md).**

## Quick start (double-click these)
| File | Does |
|---|---|
| `start-dashboard.cmd` | Stops any bridge already running, starts a fresh one in its own window, opens the dashboard |
| `start-dashboard-fake.cmd` | Same, with no Flipper: type in the bridge window to place (`p`) / remove (`r`) the orb |
| `flash-flipper.cmd` | Checks a Flipper is on USB, builds the app from this folder, installs and launches it |

Options pass through, e.g. `start-dashboard.cmd -Port 8766` or `-NoBrowser`.

## Setup (once)
```
pip install ufbt bleak
python -m ufbt update
```

## Flipper app — `flipper/glowymacgorb/`
Built against official firmware 1.4.3. Update the Flipper to the latest official
release in qFlipper first (or point ufbt at your firmware's SDK if you run a custom one).

1. Close qFlipper and plug in the Flipper.
2. `cd flipper/glowymacgorb` then `python -m ufbt launch` (builds, installs, runs).
3. Flipper: Settings → Bluetooth → ON.

Set `RING_LEDS` / `STEM_LEDS` at the top of `glowymacgorb.c`. Chain order is ring
first, then the stem starting at the flower end.

Controls: OK = manual trigger, Left = LED test (first 5 blink), Up/Down = brightness,
Back = exit. The screen also shows whether the strip's 5V is on.

## Orb — `photon/orb/`
Strip data → D2 (SPI1). Set `PIXEL_COUNT` at the top of `src/orb.cpp`.
```
particle login
particle list                  # find the orb's device name, e.g. p2348 (must say "online")
cd photon/orb
particle flash p2348           # compiles in the cloud and flashes over the air
```
The `neopixel` library comes in automatically from `project.properties`. The firmware stays
connected to the Particle cloud so it can always be re-flashed over the air; the lights and
Bluetooth work with or without Wi-Fi. (`particle flash --local` flashes over USB instead.)

**LED test:** `photon/led-test` lights just the first 5 LEDs, breathing orange, and flashes
them white when the Flipper's broadcast changes or when you run `particle call p2348 flash`.
`particle get p2348 beacons` shows how many Flipper broadcasts it has heard.

Moods, picked to read through orange plastic: warm gold-orange breathing at home (bright
swell when it lands), bright warm-white twinkle while carried, dim ember-red "come home" pulse
after a minute away.

## Dashboard — `dashboard/`
```
cd dashboard
python bridge.py
```
Open http://localhost:8765 in Chrome and click once (browsers need a click before sound).
If port 8765 is busy, `python bridge.py 8766` and open that port instead. The previous
dashboard still works at `/legacy.html`.

**No Flipper?** `python bridge.py --fake` skips Bluetooth. Type in the bridge's window:
Space/Enter toggles the orb, `p` places it, `r` removes it, `q` quits. The page reacts exactly
as if the Flipper had sent it.

| Key | Does |
|---|---|
| Space | Lift / return the orb by hand (backup if the Flipper acts up) |
| F | A friend arrives right now |
| 0–5 | Jump to a garden stage (0 = bare, 5 = full bloom) |
| R, R | Reset the garden |
| H | Hide the status line and cursor |
| M | Mute |

The garden is saved in the browser, so a reload keeps it. Reset it before the demo.

Art lives in `dashboard/web/assets/`. To remake it, put a Gemini API key (from
aistudio.google.com/apikey) in a git-ignored `.env` file at the repo root, as the bare key or
`GEMINI_API_KEY=...`, then `pip install google-genai "rembg[cpu]" pillow` and:
```
cd dashboard/tools
python make_art.py              # anything missing
python make_art.py frog bee     # just these creatures
python make_art.py stages       # all six garden stages
```
