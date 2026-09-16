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
    // Double yellow: 45° animated hazard stripes (racing chevrons)
    int offset = (millis() / 60) % 16;
    for (int y = 0; y < PANEL_HEIGHT; y++) {
        for (int x = 0; x < PANEL_WIDTH; x++) {
            if (((x + y + offset) % 16) < 8) {
                matrix->drawPixel(x, y, COLOR_YELLOW);
            } else {
                matrix->drawPixel(x, y, COLOR_BLACK);
            }
        }
    }
}

void drawRed() {
    // Solid high-impact red
    matrix->fillScreen(COLOR_RED);
}

void drawBlue() {
    // FIA Blue flag: bright blue with high-visibility flashing corner beacons
    matrix->fillScreen(COLOR_BLUE);
    bool flash = (millis() / 150) % 2 == 0;
    uint16_t cornerColor = flash ? COLOR_WHITE : COLOR_BLUE;
    
    // 4 Corner Beacons
    matrix->fillRect(0, 0, 10, 10, cornerColor);
    matrix->fillRect(PANEL_WIDTH - 10, 0, 10, 10, cornerColor);
    matrix->fillRect(0, PANEL_HEIGHT - 10, 10, 10, cornerColor);
    matrix->fillRect(PANEL_WIDTH - 10, PANEL_HEIGHT - 10, 10, 10, cornerColor);
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
    // Dark blue background with animated falling bright cyan raindrops
    matrix->fillScreen(matrix->color565(0, 10, 50));
    int t = millis() / 40;
    for (int col = 0; col < PANEL_WIDTH; col += 8) {
        int dropY = (t + col * 3) % PANEL_HEIGHT;
        matrix->drawFastVLine(col, dropY, 6, matrix->color565(100, 200, 255));
        matrix->drawPixel(col, (dropY + 6) % PANEL_HEIGHT, COLOR_WHITE);
    }
}

void drawSafetyCar() {
    matrix->fillScreen(COLOR_BLACK);
    // Orange roof beacon simulation at top
    bool beacon = (millis() / 100) % 2 == 0;
    matrix->fillRect(0, 0, PANEL_WIDTH, 8, beacon ? COLOR_ORANGE : COLOR_BLACK);

    // "SC" text centered
    matrix->setTextSize(3);
    matrix->setTextColor(COLOR_YELLOW);
    matrix->setCursor(15, 22);
    matrix->print("SC");
}

void drawVSC() {
    matrix->fillScreen(COLOR_BLACK);
    matrix->setTextSize(2);
    matrix->setTextColor(COLOR_YELLOW);
    matrix->setCursor(14, 24);
    matrix->print("VSC");
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
    } else if (strcmp(flagStr, "blue") == 0) {
        currentFlag = FLAG_BLUE;
    } else if (strcmp(flagStr, "slippery") == 0) {
        currentFlag = FLAG_SLIPPERY;
    } else if (strcmp(flagStr, "rain") == 0) {
        currentFlag = FLAG_RAIN;
    } else if (strcmp(flagStr, "safety_car") == 0) {
        currentFlag = FLAG_SC;
    } else if (strcmp(flagStr, "vsc") == 0) {
        currentFlag = FLAG_VSC;
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
        case FLAG_CHEQUERED:     drawChequered(); break;
        case FLAG_WHITE:         drawWhite(); break;
    }

    // Frame delay (approx 60-80 FPS for smooth hazard animations)
    delay(15);
}
