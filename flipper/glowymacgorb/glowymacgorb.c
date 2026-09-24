// GlowyMacgOrb — Flipper Zero app
//
// - Watches for the orb's NFC card through the flower's seat.
// - Drives the flower's NeoPixels (ring + stem) straight from GPIO.
// - Broadcasts "orb home / orb away" as a BLE advertisement so the orb's
//   Photon 2 and the laptop dashboard can both hear it (no pairing).
//
// Controls:  OK = manual trigger (Wizard-of-Oz backup)
//            Up/Down = LED brightness    Back = exit

#include <furi.h>
#include <furi_hal.h>
#include <furi_hal_bt.h>
#include <gui/gui.h>
#include <notification/notification_messages.h>
#include <nfc/nfc.h>
#include <nfc/nfc_poller.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#define TAG "GlowyMacgOrb"

// ---------- LED wiring ----------
// Data on GPIO pin 2 (PA7), strip power from pin 1 (5V), ground on pin 8 or 11.
// Chain order: ring first, then the stem strip starting at the flower end.
#define LED_PIN         (&gpio_ext_pa7)
#define RING_LEDS       16
#define STEM_LEDS       30
#define LED_COUNT       (RING_LEDS + STEM_LEDS)
#define STEM_FLOWS_DOWN 1 // 1 = pulses travel from the flower down the stem

// ---------- timing ----------
#define FRAME_MS          33 // ~30 fps
#define POLL_GAP_MS       15 // pause between card checks
#define GONE_AFTER_MISSES 3 // missed checks in a row before the orb counts as gone
#define EASE_S            1.2f // how slowly the flower changes mood
#define FLARE_S           0.8f // how fast the instant "I felt that" flash fades
#define PULSE_GAP         10.0f // LEDs between stem pulses

#define TAU 6.2831853f

typedef struct {
    float r, g, b;
} Rgb;

// Colors are perceptual 0-1 values; gamma is applied on output.
static const Rgb RING_IDLE = {1.00f, 0.05f, 0.10f}; // low ember red
static const Rgb RING_HOME = {1.00f, 0.35f, 0.42f}; // warm rose bloom
static const Rgb STEM_IDLE = {0.15f, 1.00f, 0.35f}; // quiet green
static const Rgb STEM_PULSE = {1.00f, 0.35f, 0.42f}; // rose flowing down
static const Rgb WHITE = {1.00f, 1.00f, 1.00f};

typedef struct {
    Gui* gui;
    ViewPort* view_port;
    FuriMessageQueue* input_queue;
    NotificationApp* notifications;

    Nfc* nfc;
    FuriThread* nfc_thread;
    volatile bool running;
    volatile bool card_here; // written by the NFC thread

    bool present;
    bool manual;
    uint8_t seq;
    uint32_t visits;
    float brightness;
    bool otg_was_on;

    float level; // 0 = waiting, 1 = orb home (eased)
    float phase; // breathing phase, integrated so the tempo can change smoothly
    float flow; // stem pulse position
    float flare; // brief swell when the orb arrives
    uint8_t frame[LED_COUNT * 3];
} App;

// ---------- WS2812 bit-bang ----------
// 64 MHz core: one bit = 1.25 us = 80 cycles. Timed off the DWT cycle counter
// with interrupts off for the ~1.4 ms it takes to push a frame.
#define CPU_MHZ 64
#define WS_T0H  (CPU_MHZ * 40 / 100)
#define WS_T1H  (CPU_MHZ * 80 / 100)
#define WS_BIT  (CPU_MHZ * 125 / 100)

static void ws2812_send(const uint8_t* grb, size_t len) {
    GPIO_TypeDef* port = LED_PIN->port;
    const uint32_t mask = LED_PIN->pin;

    __disable_irq();
    uint32_t t = DWT->CYCCNT;
    for(size_t i = 0; i < len; i++) {
        const uint8_t byte = grb[i];
        for(uint8_t bit = 0x80; bit; bit >>= 1) {
            const uint32_t high = (byte & bit) ? WS_T1H : WS_T0H;
            while((int32_t)(DWT->CYCCNT - t) < 0) {
            }
            port->BSRR = mask;
            while((DWT->CYCCNT - t) < high) {
            }
            port->BRR = mask;
            t += WS_BIT;
        }
    }
    __enable_irq();
    // Latch happens during the gap before the next frame (>280 us low).
}

// ---------- animation ----------
static float clamp01(float x) {
    return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x);
}

static float wrapf(float x, float m) {
    while(x >= m)
        x -= m;
    while(x < 0.0f)
        x += m;
    return x;
}

static Rgb mix(Rgb a, Rgb b, float t) {
    return (Rgb){a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t};
}

static uint8_t to_byte(float v, float scale) {
    v = clamp01(v);
    return (uint8_t)(v * v * scale * 255.0f + 0.5f); // gamma 2
}

static void put_pixel(App* app, int i, Rgb c, float k) {
    uint8_t* p = &app->frame[i * 3];
    p[0] = to_byte(c.g * k, app->brightness);
    p[1] = to_byte(c.r * k, app->brightness);
    p[2] = to_byte(c.b * k, app->brightness);
}

static void render(App* app, float dt) {
    const float target = app->present ? 1.0f : 0.0f;
    app->level += (target - app->level) * dt / (EASE_S + dt);
    const float lv = app->level * app->level * (3.0f - 2.0f * app->level); // smoothstep

    const float period = 6.5f - 2.0f * lv; // seconds per breath
    app->phase = wrapf(app->phase + dt * TAU / period, TAU);
    app->flow = wrapf(app->flow + dt * (0.6f + 3.0f * lv), PULSE_GAP);
    app->flare -= app->flare * dt / (FLARE_S + dt);

    // Ring: a slow breath with a gentle ripple around the flower. On arrival it
    // flashes bright and a little white right away, then settles into the bloom.
    const Rgb ring = mix(mix(RING_IDLE, RING_HOME, lv), WHITE, 0.35f * app->flare);
    for(int i = 0; i < RING_LEDS; i++) {
        const float breath = 0.5f + 0.5f * sinf(app->phase + 0.8f * sinf(i * TAU / RING_LEDS));
        const float k = (0.30f + 0.30f * lv) + (0.20f + 0.20f * lv) * breath + 0.50f * app->flare;
        put_pixel(app, i, ring, k);
    }

    // Stem: dim green breathing; when the orb is home, rose pulses drift along it.
    for(int j = 0; j < STEM_LEDS; j++) {
        const int pos = STEM_FLOWS_DOWN ? j : (STEM_LEDS - 1 - j);
        const float breath = 0.5f + 0.5f * sinf(app->phase - 1.2f - pos * 0.12f);
        const float d = wrapf(app->flow - (float)pos, PULSE_GAP);
        const float s = d < PULSE_GAP * 0.5f ? d : d - PULSE_GAP; // < 0: pulse still arriving
        const float pulse = s >= 0.0f ? 1.0f / (1.0f + s * s * 0.35f) :
                                        1.0f / (1.0f + s * s * 4.0f);
        const float base = 0.22f + 0.12f * breath;
        const float glow = 0.90f * pulse * (lv > app->flare ? lv : app->flare);
        const Rgb c = {
            STEM_IDLE.r * base + STEM_PULSE.r * glow,
            STEM_IDLE.g * base + STEM_PULSE.g * glow,
            STEM_IDLE.b * base + STEM_PULSE.b * glow,
        };
        put_pixel(app, RING_LEDS + j, c, 1.0f);
    }
}

// ---------- BLE broadcast ----------
static void beacon_publish(App* app) {
    const uint8_t data[] = {
        0x02, 0x01, 0x06, // flags
        0x07, 0xFF, // manufacturer data, 6 bytes follow
        0xFF, 0xFF, // company id 0xFFFF (reserved for testing)
        'G',  'M', // magic
        app->present ? 1 : 0,
        app->seq,
    };
    furi_hal_bt_extra_beacon_stop();
    furi_hal_bt_extra_beacon_set_data(data, sizeof(data));
    furi_hal_bt_extra_beacon_start();
}

static void beacon_init(App* app) {
    GapExtraBeaconConfig config = {
        .min_adv_interval_ms = 20, // fast, so listeners hear a change within a few packets
        .max_adv_interval_ms = 30,
        .adv_channel_map = GapAdvChannelMapAll,
        .adv_power_level = GapAdvPowerLevel_0dBm,
        .address_type = GapAddressTypePublic,
        .address = {0x21, 0x47, 0x4D, 0x4F, 0x52, 0x42},
    };
    furi_hal_bt_extra_beacon_stop();
    furi_hal_bt_extra_beacon_set_config(&config);
    beacon_publish(app);
}

// ---------- NFC ----------
// A bare "is an NFC-A card in the field?" check, looped as fast as it will go.
// Much quicker than the full scanner, which identifies every protocol a card
// speaks before reporting anything.
static int32_t presence_thread(void* context) {
    App* app = context;
    uint8_t misses = GONE_AFTER_MISSES;
    while(app->running) {
        NfcPoller* poller = nfc_poller_alloc(app->nfc, NfcProtocolIso14443_3a);
        const bool found = nfc_poller_detect(poller);
        nfc_poller_free(poller);

        if(found) {
            misses = 0;
        } else if(misses < GONE_AFTER_MISSES) {
            misses++;
        }
        app->card_here = misses < GONE_AFTER_MISSES;
        furi_delay_ms(POLL_GAP_MS);
    }
    return 0;
}

static void update_presence(App* app) {
    const bool present = app->manual || app->card_here;
    if(present == app->present) return;

    app->present = present;
    app->seq++;
    if(present) {
        app->visits++;
        app->flare = 1.0f;
        notification_message(app->notifications, &sequence_set_only_red_255);
    } else {
        notification_message(app->notifications, &sequence_reset_rgb);
    }
    FURI_LOG_I(TAG, present ? "ORB_IN" : "ORB_OUT");
    beacon_publish(app);
}

// ---------- UI ----------
static void draw_callback(Canvas* canvas, void* context) {
    App* app = context;
    char line[40];

    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str_aligned(canvas, 64, 2, AlignCenter, AlignTop, "GlowyMacgOrb");
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str_aligned(
        canvas, 64, 20, AlignCenter, AlignTop, app->present ? "The orb is home" : "Waiting for the orb...");
    snprintf(line, sizeof(line), "visits: %lu   light: %d%%", app->visits, (int)(app->brightness * 100));
    canvas_draw_str_aligned(canvas, 64, 34, AlignCenter, AlignTop, line);
    canvas_draw_str_aligned(
        canvas,
        64,
        50,
        AlignCenter,
        AlignTop,
        app->manual ? "MANUAL ON - OK to release" : "OK: manual   Up/Dn: light");
}

static void input_callback(InputEvent* event, void* context) {
    App* app = context;
    furi_message_queue_put(app->input_queue, event, 0);
}

int32_t glowymacgorb_app(void* p) {
    UNUSED(p);
    App* app = malloc(sizeof(App));
    memset(app, 0, sizeof(App));
    app->brightness = 0.5f;

    app->input_queue = furi_message_queue_alloc(8, sizeof(InputEvent));
    app->view_port = view_port_alloc();
    view_port_draw_callback_set(app->view_port, draw_callback, app);
    view_port_input_callback_set(app->view_port, input_callback, app);
    app->gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(app->gui, app->view_port, GuiLayerFullscreen);
    app->notifications = furi_record_open(RECORD_NOTIFICATION);
    notification_message(app->notifications, &sequence_display_backlight_enforce_on);

    // 5V out on GPIO pin 1 for the strip
    app->otg_was_on = furi_hal_power_is_otg_enabled();
    if(!app->otg_was_on) furi_hal_power_enable_otg();
    furi_hal_gpio_init(LED_PIN, GpioModeOutputPushPull, GpioPullNo, GpioSpeedVeryHigh);
    furi_hal_gpio_write(LED_PIN, false);

    beacon_init(app);

    app->nfc = nfc_alloc();
    app->running = true;
    app->nfc_thread = furi_thread_alloc_ex("GlowyNfc", 2048, presence_thread, app);
    furi_thread_start(app->nfc_thread);

    uint32_t last_frame = furi_get_tick();
    bool running = true;
    while(running) {
        InputEvent event;
        if(furi_message_queue_get(app->input_queue, &event, FRAME_MS) == FuriStatusOk &&
           (event.type == InputTypeShort || event.type == InputTypeRepeat)) {
            switch(event.key) {
            case InputKeyBack:
                running = false;
                break;
            case InputKeyOk:
                app->manual = !app->manual;
                break;
            case InputKeyUp:
                app->brightness = clamp01(app->brightness + 0.1f);
                break;
            case InputKeyDown:
                app->brightness = app->brightness > 0.15f ? app->brightness - 0.1f : 0.05f;
                break;
            default:
                break;
            }
        }

        const uint32_t now = furi_get_tick();
        float dt = (now - last_frame) / 1000.0f;
        if(dt > 0.1f) dt = 0.1f;
        last_frame = now;

        update_presence(app);
        render(app, dt);
        ws2812_send(app->frame, sizeof(app->frame));
        view_port_update(app->view_port);
    }

    // Shut everything down and leave the LEDs dark.
    app->running = false;
    furi_thread_join(app->nfc_thread);
    furi_thread_free(app->nfc_thread);
    nfc_free(app->nfc);

    furi_hal_bt_extra_beacon_stop();

    memset(app->frame, 0, sizeof(app->frame));
    ws2812_send(app->frame, sizeof(app->frame));
    furi_hal_gpio_init_simple(LED_PIN, GpioModeAnalog);
    if(!app->otg_was_on) furi_hal_power_disable_otg();

    notification_message(app->notifications, &sequence_reset_rgb);
    notification_message(app->notifications, &sequence_display_backlight_enforce_auto);
    furi_record_close(RECORD_NOTIFICATION);
    gui_remove_view_port(app->gui, app->view_port);
    furi_record_close(RECORD_GUI);
    view_port_free(app->view_port);
    furi_message_queue_free(app->input_queue);
    free(app);
    return 0;
}
