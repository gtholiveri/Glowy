# Wiring

```
FLOWER                                        ORB
Flipper Zero (under the seat)                 Photon 2 + LiPo battery
 ├─ reads the NFC card in the orb   ─ BLE ─►   └─ LED strip on pin D2
 └─ GPIO pin 2 → ring → stem strip            NFC card on the bottom face
```

The laptop needs no wiring; just turn its Bluetooth on.

---

## 1. Flower: Flipper → LEDs

The Flipper's GPIO header takes **male** jumper wires. Pin labels are printed on the case.

| Flipper pin (label) | Connect to |
|---|---|
| **1** (5V) | Ring **5V** (may be labeled VCC or +) |
| **2** (A7) | Ring **DIN** (data in), through a 330 Ω resistor if you have one |
| **8** or **11** (GND) | Ring **GND** |

Then chain the stem strip off the ring:

```
Flipper pin 1 (5V)  ───────────────── Ring 5V  ─── Ring 5V out  ──── Stem 5V
Flipper pin 2 (A7)  ──[330 Ω]──────── Ring DIN     Ring DOUT ─────── Stem DIN  (top of stem)
Flipper pin 8 (GND) ───────────────── Ring GND ─── Ring GND out ──── Stem GND
                          optional: 470–1000 µF capacitor across ring 5V/GND
                                    (the stripe on the capacitor goes to GND)
```

- **The LEDs are only powered while the app is running.** The app switches the Flipper's 5V pin on at start and off on exit, so dark LEDs with the app closed is normal.
- **Direction matters.** Data only flows one way. The arrows printed on the stem strip point *away* from its DIN end: DIN goes at the top by the flower, with the arrows pointing down the stem.
- **Keep the data wire from pin 2 to the ring short**, under about 15 cm.
- **Power:** about 0.3 A at the default 50% brightness (roughly double at 100%). The Flipper handles that. If it resets when the LEDs brighten, turn brightness down with the Down button, or plug a USB power bank into the Flipper.

### Placing the Flipper
- **Back up, screen down:** the Flipper sits under the seat with its **back** (not the screen) facing up toward the orb, with no more than 3 mm of plastic in between.
- **Find the sweet spot first:** open NFC → Read on the Flipper and slide the card around its back. Mark the spot that reads fastest, and center that spot under the seat.
- **Keep LEDs out of the path between the Flipper and the orb.** The copper in LED strips can block the card read. Put the ring around the edge of the seat or under the petals, not directly over the sweet spot.

---

## 2. Orb: Photon 2 → LEDs

| Photon 2 pin | Connect to |
|---|---|
| **D2** | LED **DIN**, through a 330 Ω resistor if you have one |
| **LI+** | LED **5V** / VCC |
| **GND** | LED **GND** |
| Battery connector | LiPo battery |

**Why LI+:** it's the battery's own voltage (3.7–4.2 V), live whenever the battery is plugged in.
- VUSB only has power when USB is plugged in.
- The 3V3 pin can't reliably supply LED current.
- LEDs running at battery voltage also read the Photon's 3.3 V data signal more reliably than LEDs at 5 V.

### Battery
- **Check polarity before plugging in.** The battery's red wire must line up with the **+** marking next to the Photon's battery connector. Some batteries are wired backwards, and that kills the board.
- **Charging:** plug USB into the Photon. Charge with the orb open, not packed with paper.
- **Off switch:** unplug the battery.
- **Runtime:** roughly 3+ hours per 1000 mAh at default brightness. As the battery runs low, blue fades first.

### Inside the orb (bottom to top)
1. **NFC card**, flat against the inside of the bottom face, centered, taped down.
2. **1–2 cm of crumpled paper.** This keeps the battery and board away from the card, which protects the read range.
3. **Photon, battery and breadboard**, wrapped together in one sheet of paper.
4. **LEDs**, taped along the inside edges, facing inward onto the paper.
5. **Loose crumpled paper** to fill the rest, then close the lid.

---

## 3. Match the code to your LEDs

| What | File | Setting |
|---|---|---|
| Flower ring LED count | `flipper/glowymacgorb/glowymacgorb.c` | `RING_LEDS` |
| Stem LED count (0 if no stem strip) | `flipper/glowymacgorb/glowymacgorb.c` | `STEM_LEDS` |
| Stem pulse direction | `flipper/glowymacgorb/glowymacgorb.c` | `STEM_FLOWS_DOWN` |
| Orb LED count | `photon/orb/src/orb.cpp` | `PIXEL_COUNT` |
| Orb brightness | `photon/orb/src/orb.cpp` | `MAX_BRIGHTNESS` |

Flower brightness is adjusted live with Up/Down on the Flipper.

After changing a setting, rebuild:
- **Flipper:** run `python -m ufbt launch` in `flipper/glowymacgorb`.
- **Orb:** run `particle flash --local` in `photon/orb`.

---

## Troubleshooting

**Where to look when something's off:**
- **Flipper:** the screen says "The orb is home", and its own LED turns red when it sees the card.
- **Orb:** run `particle serial monitor` with the Photon on USB. It prints `orb home` / `orb away`.
- **Laptop:** the `bridge.py` window prints `orb home` / `orb away`.

| Symptom | Likely cause | Fix |
|---|---|---|
| LEDs stay dark | App not running, GND missing, or DIN/DOUT swapped | Start the app; check GND; follow the arrows |
| Random colors or flicker on the flower | Flipper's 3.3 V data signal is too weak for 5 V LEDs | Shorten the data wire, add the 330 Ω resistor and the capacitor. Still bad: add a 74AHCT125 level shifter, or use a "sacrificial pixel" (search that term) |
| Flower glows green where it should be red | Strip uses a different color order | In `put_pixel()` in `glowymacgorb.c`, swap the `c.g` and `c.r` lines |
| Flipper reboots when the LEDs brighten | Too much current | Down button to dim, or a USB power bank on the Flipper |
| Ring works, stem stays dark | `STEM_LEDS` is 0, or the stem is wired at the wrong end | Set the count; DIN goes at the top |
| Card isn't detected | Too far, off the sweet spot, or metal near the card | Test with the Flipper's built-in NFC → Read first; center the card on the sweet spot; move the battery, board and LEDs away from the card |
| Orb doesn't react | Flipper Bluetooth off, or the orb isn't flashed | Flipper: Settings → Bluetooth → ON; check `particle serial monitor` |
