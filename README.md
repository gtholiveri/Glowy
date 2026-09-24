# GlowyMacgOrb

```
Flipper (in the flower) ──BLE broadcast "orb home/away"──► Photon 2 (in the orb)
   │ reads the orb's NFC card                         └──► laptop bridge.py ──► dashboard
   └─ drives the flower ring + stem LEDs (GPIO pin 2)
```

No pairing and no USB at demo time: the Flipper broadcasts its state dozens of times a
second and anything nearby just listens.

**Wiring, power and placement: see [WIRING.md](WIRING.md).**

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

Wiring: strip data → pin 2 (PA7), strip 5V → pin 1, GND → pin 8 or 11.
Set `RING_LEDS` / `STEM_LEDS` at the top of `glowymacgorb.c`. Chain order is ring
first, then the stem starting at the flower end.

Controls: OK = manual trigger, Up/Down = brightness, Back = exit.

## Orb — `photon/orb/`
Strip data → D2 (SPI1). Set `PIXEL_COUNT` at the top of `src/orb.cpp`.
```
particle login
cd photon/orb
particle flash --local
```
(Compiles in the cloud, flashes over USB. The `neopixel` library comes in automatically
from `project.properties`.) The orb runs offline, so always flash it over USB.

## Dashboard — `dashboard/`
```
cd dashboard
python bridge.py
```
Open http://localhost:8765 in Chrome.
Space = manual toggle, H = hide the buttons for presenting.
