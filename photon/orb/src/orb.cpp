// GlowyMacgOrb — orb (Particle Photon 2 on battery)
//
// Glowy rides in this orb (her lantern). It listens for the Flipper's BLE broadcast and shows
// her mood. Colors are picked to read through orange plastic, which swallows blues:
//   home on the flower  -> warm gold-orange, slow breathing, bright swell the moment she lands
//   out exploring       -> bright warm white with little twinkles
//   away over a minute  -> homesick: dim ember red, slow "come home" pulse
//
// Needs the "neopixel" library (Particle Workbench: Install Library -> neopixel).

#include "Particle.h"
#include "neopixel.h"

// Stay connected to the Particle cloud so the orb can be re-flashed over the air (no USB
// needed). With the system thread on, the lights and Bluetooth run whether or not Wi-Fi is up.
SYSTEM_MODE(AUTOMATIC);
SYSTEM_THREAD(ENABLED);

// ---------- tweak these ----------
#define PIXEL_COUNT 20
#define PIXEL_PIN   SPI1 // Photon 2: SPI1 = pin D2 (only SPI or SPI1 can drive NeoPixels)
#define PIXEL_TYPE  WS2812B
const float MAX_BRIGHTNESS = 0.45f; // 0-1; lower = longer battery life
const uint32_t LOST_MS = 5000; // no broadcast for this long -> act as if away
const uint32_t HOMESICK_MS = 60000; // matches the dashboard's "Glowy's getting sleepy"
// ----------------------------------

const float HOME_C[3] = {1.00f, 0.50f, 0.12f}; // warm gold-orange, like Glowy on screen
const float AWAKE_C[3] = {1.00f, 0.88f, 0.62f}; // bright warm white: awake and curious
const float SICK_C[3] = {1.00f, 0.16f, 0.03f}; // sleepy ember red

const float TAU_F = 6.2831853f;

Adafruit_NeoPixel strip(PIXEL_COUNT, PIXEL_PIN, PIXEL_TYPE);

volatile bool orbHome = false;
volatile uint32_t lastBeaconMs = 0;

void onScan(const BleScanResult* result, void* context) {
    uint8_t buf[BLE_MAX_ADV_DATA_LEN];
    size_t len = result->advertisingData().get(BleAdvertisingDataType::MANUFACTURER_SPECIFIC_DATA, buf, sizeof(buf));
    // [0xFF 0xFF] company id, 'G' 'M' magic, state, sequence
    if (len >= 5 && buf[0] == 0xFF && buf[1] == 0xFF && buf[2] == 'G' && buf[3] == 'M') {
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

float level = 0, sick = 0, phase = 0, flare = 0;
bool wasHome = false;
uint32_t lastFrame = 0, awayStartMs = 0;
float twinklePhase[PIXEL_COUNT], twinkleSpeed[PIXEL_COUNT];

uint8_t toByte(float v) {
    v = constrain(v, 0.0f, 1.0f);
    return (uint8_t)(v * v * MAX_BRIGHTNESS * 255.0f + 0.5f); // gamma 2
}

float mix(float a, float b, float t) { return a + (b - a) * t; }

void setup() {
    Serial.begin();
    strip.begin();
    strip.show();
    for (int i = 0; i < PIXEL_COUNT; i++) {
        twinklePhase[i] = random(0, 6283) / 1000.0f;
        twinkleSpeed[i] = 1.5f + random(0, 2000) / 1000.0f;
    }
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
        else awayStartMs = now;
        wasHome = home;
    }
    bool homesick = !home && (now - awayStartMs > HOMESICK_MS);

    // Ease between moods so every change is a slow cross-fade.
    level += ((home ? 1.0f : 0.0f) - level) * dt / (1.2f + dt);
    sick += ((homesick ? 1.0f : 0.0f) - sick) * dt / (2.0f + dt);
    float lv = level * level * (3.0f - 2.0f * level); // smoothstep
    float period = mix(mix(3.0f, 7.5f, sick), 5.5f, lv); // seconds per breath
    phase += dt * TAU_F / period;
    if (phase > TAU_F) phase -= TAU_F;
    flare -= flare * dt / (0.8f + dt);

    float kBase = mix(mix(0.45f, 0.15f, sick), 0.60f, lv);
    float kAmp = mix(mix(0.25f, 0.20f, sick), 0.40f, lv);
    float awake = (1.0f - lv) * (1.0f - sick); // how much the curious twinkle shows
    float t = now / 1000.0f;

    for (int i = 0; i < PIXEL_COUNT; i++) {
        // each LED breathes slightly out of step, so the orb shimmers instead of blinking
        float breath = 0.5f + 0.5f * sinf(phase + i * 0.84f);
        float twinkle = 0.6f * awake * powf(fmaxf(0.0f, sinf(t * twinkleSpeed[i] + twinklePhase[i])), 12.0f);
        float k = kBase + kAmp * breath + 0.50f * flare + twinkle;
        // arrival flash and twinkles both lean toward white
        float w = fminf(1.0f, 0.35f * flare + 0.5f * twinkle);
        float c[3];
        for (int j = 0; j < 3; j++) {
            c[j] = (mix(mix(AWAKE_C[j], SICK_C[j], sick), HOME_C[j], lv) * (1 - w) + w) * k;
        }
        strip.setPixelColor(i, toByte(c[0]), toByte(c[1]), toByte(c[2]));
    }
    strip.show();
}
