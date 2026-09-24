# GlowyMacgOrb

Glowy is a tiny fairy of light who lives in a glowing rose and can't fly yet. The orb is her
lantern. Lift it and she goes exploring with you; bring it back and she returns with a new
friend who thanks you, shares why we're grateful for them, and moves into the garden on
screen. Every few friends, the garden grows.

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
pip install ufbt bleak google-genai
python -m ufbt update
```
Put a Gemini API key (from aistudio.google.com/apikey) in a file named `.env` at the repo root,
either as the bare key or as `GEMINI_API_KEY=...`. It's git-ignored. Without it the creatures
still chat, using built-in lines.

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
cd photon/orb
particle flash --local
```
(Compiles in the cloud, flashes over USB. The `neopixel` library comes in automatically
from `project.properties`.) The orb runs offline, so always flash it over USB.

Moods: warm rose breathing at home (bright swell when it lands), curious teal-white twinkle
while carried, dim amber "come home" pulse after a minute away.

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
| C | Make someone talk now |

The garden is saved in the browser, so a reload keeps it. Reset it before the demo.

Art lives in `dashboard/web/assets/`. To remake it (needs the Gemini key, plus
`pip install "rembg[cpu]" pillow`):
```
cd dashboard/tools
python make_art.py              # anything missing
python make_art.py frog bee     # just these creatures
python make_art.py stages       # all six garden stages
```
