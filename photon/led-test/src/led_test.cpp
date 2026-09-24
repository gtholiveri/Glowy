// LED + event test for the orb's Photon 2 (cloud-flashable).
//
// The first 5 LEDs on pin D2 breathe warm orange, and flash white when:
//   - the Flipper's broadcast changes (orb placed / removed, or first heard), or
//   - you run:  particle call <device> flash
// `particle get <device> beacons` shows how many Flipper broadcasts it has heard.
//
// Stays connected to the Particle cloud so it can be re-flashed over the air.

#include "Particle.h"
#include "neopixel.h"

SYSTEM_MODE(AUTOMATIC);
SYSTEM_THREAD(ENABLED); // keep the LEDs running even while Wi-Fi is still connecting

#define PIXEL_COUNT 5
#define PIXEL_PIN   SPI1 // Photon 2: SPI1 = pin D2
#define PIXEL_TYPE  WS2812B
const float MAX_BRIGHTNESS = 0.6f;

Adafruit_NeoPixel strip(PIXEL_COUNT, PIXEL_PIN, PIXEL_TYPE);

int beacons = 0; // Flipper broadcasts heard
volatile int lastState = -1; // orb state in the last broadcast
volatile bool flashNow = false;

void onScan(const BleScanResult* result, void* context) {
    uint8_t buf[BLE_MAX_ADV_DATA_LEN];
    size_t len = result->advertisingData().get(BleAdvertisingDataType::MANUFACTURER_SPECIFIC_DATA, buf, sizeof(buf));
    // [0xFF 0xFF] company id, 'G' 'M' magic, state, sequence
    if (len >= 5 && buf[0] == 0xFF && buf[1] == 0xFF && buf[2] == 'G' && buf[3] == 'M') {
        beacons++;
        if (buf[4] != lastState) {
            lastState = buf[4];
            flashNow = true;
        }
    }
}

void scanForever(void*) {
    while (true) {
        BLE.scan(onScan, nullptr);
        delay(5);
    }
}

int flashCommand(String) {
    flashNow = true;
    return 1;
}

uint8_t toByte(float v) {
    v = constrain(v, 0.0f, 1.0f);
    return (uint8_t)(v * v * MAX_BRIGHTNESS * 255.0f + 0.5f); // gamma 2
}

void setup() {
    strip.begin();
    strip.show();
    Particle.function("flash", flashCommand);
    Particle.variable("beacons", beacons);
    BLE.on();
    BleScanParams scanParams = {};
    scanParams.size = sizeof(BleScanParams);
    scanParams.interval = 80; // 50 ms (units of 0.625 ms)
    scanParams.window = 80; // listen the whole interval
    scanParams.timeout = 50; // 500 ms per scan call (units of 10 ms)
    scanParams.active = false;
    scanParams.filter_policy = BLE_SCAN_FP_ACCEPT_ALL;
    BLE.setScanParameters(&scanParams);
    new Thread("scan", scanForever);
}

float flash = 0;
uint32_t lastFrame = 0;

void loop() {
    uint32_t now = millis();
    if (now - lastFrame < 20) return; // ~50 fps
    float dt = fminf((now - lastFrame) / 1000.0f, 0.1f);
    lastFrame = now;

    if (flashNow) {
        flashNow = false;
        flash = 1.0f;
    }
    flash -= flash * dt / (0.35f + dt);

    float breath = 0.5f + 0.5f * sinf(now / 1000.0f * 6.2831853f / 4.0f); // one breath per 4 s
    float k = fmaxf(0.15f + 0.35f * breath, flash); // a flash jumps straight to full brightness
    float r = 1.00f + (1.0f - 1.00f) * flash; // warm orange fading toward white
    float g = 0.45f + (1.0f - 0.45f) * flash;
    float b = 0.08f + (1.0f - 0.08f) * flash;
    for (int i = 0; i < PIXEL_COUNT; i++) {
        strip.setPixelColor(i, toByte(r * k), toByte(g * k), toByte(b * k));
    }
    strip.show();
}
