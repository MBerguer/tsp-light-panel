/**
 * ESP32-S3 Firmware for HUB75 Digital Light Flag Panel
 * Autódromo Víctor Borrat Fabini (El Pinar) - TSP Light Panel System
 *
 * Receives UDP broadcast packets from tsp-server on port 8888.
 * Drives 64x64 or 64x32 outdoor LED matrix panels using hardware DMA.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

// ============================================================================
// CONFIGURATION (Adjust for each physical post)
// ============================================================================
#define PANEL_ID          1                 // Physical Panel Number (1 to 14)
#define UDP_PORT          8888              // Matching tsp-server port

// Wi-Fi Credentials (or connected to post Access Point)
const char* WIFI_SSID     = "TSP_TRACK_NET";
const char* WIFI_PASS     = "ElPinar2026!";

// Panel Dimensions
#define PANEL_WIDTH       64                // Width in pixels
#define PANEL_HEIGHT      64                // Height in pixels
#define PANELS_CHAINED    1                 // 1 for 64x64, or 2 for cascaded

// ============================================================================
// HUB75 PIN DEFINITIONS (Default for ESP32-S3 Matrix Boards / Waveshare)
// ============================================================================
#define R1_PIN  42
#define G1_PIN  41
#define B1_PIN  40
#define R2_PIN  39
#define G2_PIN  38
#define B2_PIN  37
#define A_PIN   45
#define B_PIN   36
#define C_PIN   48
#define D_PIN   35
#define E_PIN   21  // required for 64x64 (1/32 scan)
#define LAT_PIN 47
#define OE_PIN  14
#define CLK_PIN 2

// ============================================================================
// GLOBAL INSTANCES & STATE
// ============================================================================
MatrixPanel_I2S_DMA *matrix = nullptr;
WiFiUDP udp;
char incomingPacket[1024];

enum FlagKind {
    FLAG_OFF,
    FLAG_GREEN,
    FLAG_YELLOW_SINGLE,
    FLAG_YELLOW_DOUBLE,
    FLAG_RED,
    FLAG_BLUE,
    FLAG_SLIPPERY,
    FLAG_RAIN,
    FLAG_SC,
    FLAG_VSC,
    FLAG_FCY,
    FLAG_CHEQUERED,
    FLAG_WHITE
};

FlagKind currentFlag = FLAG_OFF;
unsigned long lastPacketTime = 0;
uint32_t animFrame = 0;

// Color Palette (RGB565)
uint16_t COLOR_BLACK;
uint16_t COLOR_WHITE;
uint16_t COLOR_GREEN;
uint16_t COLOR_YELLOW;
uint16_t COLOR_RED;
uint16_t COLOR_BLUE;
uint16_t COLOR_ORANGE;

// ============================================================================
// FLAG RENDERERS (Optimized for 64x64 matrix)
// ============================================================================

void drawOff() {
    matrix->fillScreen(COLOR_BLACK);
    // Link heartbeat dot (bottom right)
    if ((millis() - lastPacketTime < 3000) && ((millis() / 500) % 2 == 0)) {
        matrix->drawPixel(PANEL_WIDTH - 1, PANEL_HEIGHT - 1, matrix->color565(0, 40, 0));
    }
}

void drawGreen() {
    matrix->fillScreen(COLOR_GREEN);
}

void drawYellowSingle() {
    // Single yellow: flash whole screen at 2 Hz
    if ((millis() / 250) % 2 == 0) {
        matrix->fillScreen(COLOR_YELLOW);
    } else {
        matrix->fillScreen(COLOR_BLACK);
    }
}

void drawYellowDouble() {
    // Double yellow: corner-to-corner diagonal split alternating triangles
    bool phase = (millis() / 180) % 2 == 0;
    uint16_t c1 = phase ? COLOR_YELLOW : COLOR_BLACK;
    uint16_t c2 = phase ? COLOR_BLACK : COLOR_YELLOW;
    // Top-right triangle
    matrix->fillTriangle(0, 0, PANEL_WIDTH - 1, 0, PANEL_WIDTH - 1, PANEL_HEIGHT - 1, c1);
    // Bottom-left triangle
    matrix->fillTriangle(0, 0, 0, PANEL_HEIGHT - 1, PANEL_WIDTH - 1, PANEL_HEIGHT - 1, c2);
}

void drawRed() {
    // Solid high-impact red
    matrix->fillScreen(COLOR_RED);
}

void drawBlue() {
    // Solid high-impact electric blue
    matrix->fillScreen(COLOR_BLUE);
}

void drawSlippery() {
    // Diagonal red and yellow hazard stripes
    for (int y = 0; y < PANEL_HEIGHT; y++) {
        for (int x = 0; x < PANEL_WIDTH; x++) {
            if (((x + y) % 16) < 8) {
                matrix->drawPixel(x, y, COLOR_RED);
            } else {
                matrix->drawPixel(x, y, COLOR_YELLOW);
            }
        }
    }
}

void drawRain() {
    // Black background with scrolling bright cyan teardrop raindrops tilted 45° to the left
    matrix->fillScreen(COLOR_BLACK);
    int t = (millis() / 35) % PANEL_HEIGHT;
    uint16_t cyan = matrix->color565(0, 212, 255);
    
    // 3 staggered columns of teardrops scrolling down
    int cols[3] = {14, 32, 50};
    int yOffsets[3] = {PANEL_HEIGHT / 2, 0, PANEL_HEIGHT / 2};

    for (int i = 0; i < 3; i++) {
        int cx = cols[i];
        int cy = (t + yOffsets[i]) % PANEL_HEIGHT;

        // Bulbous rounded base at bottom-right, pointed tip pointing top-left (45° angle)
        matrix->fillCircle(cx + 2, cy + 2, 4, cyan);
        matrix->fillTriangle(cx - 1, cy + 5, cx + 5, cy - 1, cx - 6, cy - 6, cyan);
    }
}

void drawYellowFrame() {
    for (int i = 0; i < 3; i++) {
        matrix->drawRect(i, i, PANEL_WIDTH - 2 * i, PANEL_HEIGHT - 2 * i, COLOR_YELLOW);
    }
}

void drawSafetyCar() {
    // Black background with thick yellow frame and white "SC" font
    matrix->fillScreen(COLOR_BLACK);
    drawYellowFrame();
    matrix->setTextSize(3);
    matrix->setTextColor(COLOR_WHITE);
    matrix->setCursor(15, 22);
    matrix->print("SC");
}

void drawVSC() {
    // Black background with thick yellow frame and white "VSC" font
    matrix->fillScreen(COLOR_BLACK);
    drawYellowFrame();
    matrix->setTextSize(2);
    matrix->setTextColor(COLOR_WHITE);
    matrix->setCursor(14, 24);
    matrix->print("VSC");
}

void drawFCY() {
    // Black background with thick yellow frame and white "FCY" font
    matrix->fillScreen(COLOR_BLACK);
    drawYellowFrame();
    matrix->setTextSize(2);
    matrix->setTextColor(COLOR_WHITE);
    matrix->setCursor(14, 24);
    matrix->print("FCY");
}

void drawChequered() {
    // 8x8 checkerboard squares
    int squareSize = 8;
    for (int y = 0; y < PANEL_HEIGHT; y += squareSize) {
        for (int x = 0; x < PANEL_WIDTH; x += squareSize) {
            bool isWhite = ((x / squareSize) + (y / squareSize)) % 2 == 0;
            matrix->fillRect(x, y, squareSize, squareSize, isWhite ? COLOR_WHITE : COLOR_BLACK);
        }
    }
}

void drawWhite() {
    matrix->fillScreen(COLOR_WHITE);
}

// ============================================================================
// PACKET PROCESSING
// ============================================================================

void parseFlagMessage(const char* flagStr, const char* subStr) {
    if (strcmp(flagStr, "off") == 0) {
        currentFlag = FLAG_OFF;
    } else if (strcmp(flagStr, "green") == 0) {
        currentFlag = FLAG_GREEN;
    } else if (strcmp(flagStr, "yellow") == 0) {
        if (subStr && strcmp(subStr, "double") == 0) {
            currentFlag = FLAG_YELLOW_DOUBLE;
        } else {
            currentFlag = FLAG_YELLOW_SINGLE;
        }
    } else if (strcmp(flagStr, "red") == 0) {
        currentFlag = FLAG_RED;
    } else if (strcmp(flagStr, "blue") == 0 || strcmp(flagStr, "customblue") == 0 || strcmp(flagStr, "custom_blue") == 0) {
        currentFlag = FLAG_BLUE;
    } else if (strcmp(flagStr, "slippery") == 0) {
        currentFlag = FLAG_SLIPPERY;
    } else if (strcmp(flagStr, "rain") == 0) {
        currentFlag = FLAG_RAIN;
    } else if (strcmp(flagStr, "safety_car") == 0) {
        currentFlag = FLAG_SC;
    } else if (strcmp(flagStr, "vsc") == 0) {
        currentFlag = FLAG_VSC;
    } else if (strcmp(flagStr, "fcy") == 0 || strcmp(flagStr, "full_course_yellow") == 0) {
        currentFlag = FLAG_FCY;
    } else if (strcmp(flagStr, "chequered") == 0) {
        currentFlag = FLAG_CHEQUERED;
    } else if (strcmp(flagStr, "white") == 0) {
        currentFlag = FLAG_WHITE;
    }
}

void processUdpPacket(const char* json) {
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) return;

    lastPacketTime = millis();
    const char* type = doc["type"];
    if (!type) return;

    // 1. Direct Flag Change for our specific panel
    if (strcmp(type, "flag_change") == 0) {
        uint32_t p = doc["panel"];
        if (p == PANEL_ID) {
            const char* f = doc["flag"];
            const char* s = doc["sub"];
            parseFlagMessage(f, s);
        }
    }
    // 2. Periodic Heartbeat with all panels
    else if (strcmp(type, "heartbeat") == 0) {
        JsonArray panels = doc["panels"];
        for (JsonObject item : panels) {
            if (item["p"] == PANEL_ID) {
                const char* f = item["f"];
                const char* s = item["s"];
                parseFlagMessage(f, s);
                break;
            }
        }
    }
}

// ============================================================================
// ARDUINO SETUP & LOOP
// ============================================================================

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n[TSP] Starting Light Panel Controller...");

    // Setup HUB75 DMA Display
    HUB75_I2S_CFG mxconfig(
        PANEL_WIDTH,
        PANEL_HEIGHT,
        PANELS_CHAINED
    );

    mxconfig.gpio.r1 = R1_PIN;
    mxconfig.gpio.g1 = G1_PIN;
    mxconfig.gpio.b1 = B1_PIN;
    mxconfig.gpio.r2 = R2_PIN;
    mxconfig.gpio.g2 = G2_PIN;
    mxconfig.gpio.b2 = B2_PIN;
    mxconfig.gpio.a = A_PIN;
    mxconfig.gpio.b = B_PIN;
    mxconfig.gpio.c = C_PIN;
    mxconfig.gpio.d = D_PIN;
    mxconfig.gpio.e = E_PIN;
    mxconfig.gpio.lat = LAT_PIN;
    mxconfig.gpio.oe = OE_PIN;
    mxconfig.gpio.clk = CLK_PIN;
    mxconfig.driver = HUB75_I2S_CFG::SHIFTREG;

    matrix = new MatrixPanel_I2S_DMA(mxconfig);
    matrix->begin();
    matrix->setBrightness8(255); // Max outdoor brightness

    // Precalculate colors
    COLOR_BLACK  = matrix->color565(0, 0, 0);
    COLOR_WHITE  = matrix->color565(255, 255, 255);
    COLOR_GREEN  = matrix->color565(0, 255, 0);
    COLOR_YELLOW = matrix->color565(255, 230, 0);
    COLOR_RED    = matrix->color565(255, 0, 0);
    COLOR_BLUE   = matrix->color565(0, 80, 255);
    COLOR_ORANGE = matrix->color565(255, 120, 0);

    // Self-test boot flash (Green -> Yellow -> Red -> Off)
    matrix->fillScreen(COLOR_GREEN);
    delay(200);
    matrix->fillScreen(COLOR_YELLOW);
    delay(200);
    matrix->fillScreen(COLOR_RED);
    delay(200);
    matrix->fillScreen(COLOR_BLACK);

    // Wi-Fi Connection
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.printf("[TSP] Connecting to WiFi '%s'...", WIFI_SSID);

    udp.begin(UDP_PORT);
    Serial.printf("\n[TSP] UDP listener bound on port %d\n", UDP_PORT);
}

void loop() {
    // 1. Read incoming UDP Broadcast packets
    int packetSize = udp.parsePacket();
    if (packetSize > 0) {
        int len = udp.read(incomingPacket, sizeof(incomingPacket) - 1);
        if (len > 0) {
            incomingPacket[len] = '\0';
            processUdpPacket(incomingPacket);
        }
    }

    // 2. Render active flag state
    switch (currentFlag) {
        case FLAG_OFF:           drawOff(); break;
        case FLAG_GREEN:         drawGreen(); break;
        case FLAG_YELLOW_SINGLE: drawYellowSingle(); break;
        case FLAG_YELLOW_DOUBLE: drawYellowDouble(); break;
        case FLAG_RED:           drawRed(); break;
        case FLAG_BLUE:          drawBlue(); break;
        case FLAG_SLIPPERY:      drawSlippery(); break;
        case FLAG_RAIN:          drawRain(); break;
        case FLAG_SC:            drawSafetyCar(); break;
        case FLAG_VSC:           drawVSC(); break;
        case FLAG_FCY:           drawFCY(); break;
        case FLAG_CHEQUERED:     drawChequered(); break;
        case FLAG_WHITE:         drawWhite(); break;
    }

    // Frame delay (approx 60-80 FPS for smooth hazard animations)
    delay(15);
}
