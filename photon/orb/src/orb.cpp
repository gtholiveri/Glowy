// The Red Flower — orb (Particle Photon 2 on battery)
//
// Listens for the Flipper's BLE broadcast and breathes:
//   away from the flower -> slow, cool, moonlit teal ("sleeping")
//   home on the flower   -> warm rose, a little livelier, with a soft swell on arrival
//
// Needs the "neopixel" library (Particle Workbench: Install Library -> neopixel).

#include "Particle.h"
#include "neopixel.h"

SYSTEM_MODE(SEMI_AUTOMATIC); // stays offline: no Wi-Fi/cloud needed. Flash over USB.

// ---------- tweak these ----------
#define PIXEL_COUNT 20
#define PIXEL_PIN   SPI1 // Photon 2: SPI1 = pin D2 (only SPI or SPI1 can drive NeoPixels)
#define PIXEL_TYPE  WS2812B
const float MAX_BRIGHTNESS = 0.45f; // 0-1; lower = longer battery life
const uint32_t LOST_MS = 5000; // no broadcast for this long -> act as if away
// ----------------------------------

const float TAU_F = 6.2831853f;

Adafruit_NeoPixel strip(PIXEL_COUNT, PIXEL_PIN, PIXEL_TYPE);

volatile bool orbHome = false;
volatile uint32_t lastBeaconMs = 0;

void onScan(const BleScanResult* result, void* context) {
    uint8_t buf[BLE_MAX_ADV_DATA_LEN];
    size_t len = result->advertisingData().get(BleAdvertisingDataType::MANUFACTURER_SPECIFIC_DATA, buf, sizeof(buf));
    // [0xFF 0xFF] company id, 'R' 'F' magic, state, sequence
    if (len >= 5 && buf[0] == 0xFF && buf[1] == 0xFF && buf[2] == 'R' && buf[3] == 'F') {
        orbHome = (buf[4] == 1);
        lastBeaconMs = millis();
    }
}

void scanForever(void*) {
    while (true) {
        BLE.scan(onScan, nullptr);
        delay(5);
    }
}

float level = 0, phase = 0, flare = 0;
bool wasHome = false;
uint32_t lastFrame = 0;

uint8_t toByte(float v) {
    v = constrain(v, 0.0f, 1.0f);
    return (uint8_t)(v * v * MAX_BRIGHTNESS * 255.0f + 0.5f); // gamma 2
}

void setup() {
    Serial.begin();
    strip.begin();
    strip.show();
    BLE.on();
    BleScanParams scanParams = {};
    scanParams.size = sizeof(BleScanParams);
    scanParams.interval = 80; // 50 ms (units of 0.625 ms)
    scanParams.window = 80; // listen the whole interval, so no broadcast slips past
    scanParams.timeout = 50; // 500 ms per scan call (units of 10 ms)
    scanParams.active = false; // just listen
    scanParams.filter_policy = BLE_SCAN_FP_ACCEPT_ALL;
    BLE.setScanParameters(&scanParams);
    new Thread("scan", scanForever);
}

void loop() {
    uint32_t now = millis();
    if (now - lastFrame < 20) return; // ~50 fps
    float dt = fminf((now - lastFrame) / 1000.0f, 0.1f);
    lastFrame = now;

    bool home = orbHome && (now - lastBeaconMs < LOST_MS);
    if (home != wasHome) {
        Serial.println(home ? "orb home" : "orb away");
        if (home) flare = 1.0f;
        wasHome = home;
    }

    level += ((home ? 1.0f : 0.0f) - level) * dt / (1.2f + dt);
    float lv = level * level * (3.0f - 2.0f * level); // smoothstep
    float period = 7.0f - 2.0f * lv; // seconds per breath
    phase += dt * TAU_F / period;
    if (phase > TAU_F) phase -= TAU_F;
    flare -= flare * dt / (0.8f + dt);

    const float SLEEP[3] = {0.25f, 0.75f, 1.00f}; // moonlit teal
    const float HOME[3] = {1.00f, 0.30f, 0.38f}; // warm rose

    for (int i = 0; i < PIXEL_COUNT; i++) {
        // each LED breathes slightly out of step, so the orb shimmers instead of blinking
        float breath = 0.5f + 0.5f * sinf(phase + i * 0.84f);
        float k = (0.30f + 0.30f * lv) + (0.20f + 0.20f * lv) * breath + 0.50f * flare;
        // on arrival: an instant bright, slightly white flash that settles into the bloom
        float w = 0.35f * flare;
        float r = ((SLEEP[0] + (HOME[0] - SLEEP[0]) * lv) * (1 - w) + w) * k;
        float g = ((SLEEP[1] + (HOME[1] - SLEEP[1]) * lv) * (1 - w) + w) * k;
        float b = ((SLEEP[2] + (HOME[2] - SLEEP[2]) * lv) * (1 - w) + w) * k;
        strip.setPixelColor(i, toByte(r), toByte(g), toByte(b));
    }
    strip.show();
}
