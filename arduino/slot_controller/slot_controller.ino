// Lucky Signal — UNO R4 WiFi. Joystick A0/A1, PIR A3, LCD 0x27, 8 WS2812 D9.
// Audio belongs to the iPad. D9 is exclusively the LED strip: no speaker/tone().
#include <WiFiS3.h>
#include <WebSocketServer.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_NeoPixel.h>
#include <WDT.h>
#if __has_include("arduino_secrets.h")
#include "arduino_secrets.h"
#else
#define SECRET_SSID ""
#define SECRET_PASS ""
#endif

using namespace net;
WebSocketServer wss{81};
LiquidCrystal_I2C lcd(0x27, 16, 2);
Adafruit_NeoPixel strip(8, 9, NEO_GRB + NEO_KHZ800);
const uint8_t JOY_X = A0, JOY_Y = A1, PIR = A3;
const int PIR_ON = 620, PIR_OFF = 200;
const unsigned long PIR_WARMUP_MS = 40000, PIR_REARM_MS = 3000;
enum Mode {IDLE, ATTRACT, READY, BLOCKED, SPIN, RESULT};
Mode mode = IDLE;
unsigned long lastCommand = 0, lastLever = 0, lastMotion = 0, lastLed = 0, lastProbe = 0, lastWifi = 0;
bool armed = false, pulledBefore = false, pirOn = false, lcdOk = false, connected = false;
int tier = 0;
char lastText[2][17] = {{0}, {0}};

void line(uint8_t row, const char *text) {
  char buf[17]; snprintf(buf, sizeof(buf), "%-16.16s", text);
  if (!strcmp(buf, lastText[row])) return;
  strcpy(lastText[row], buf);
  if (lcdOk) {lcd.setCursor(0, row); lcd.print(buf);}
}
void idle() {mode = IDLE; line(0, "Lucky Signal"); line(1, connected ? "Avvicinati!" : "Attendo bridge");}
void event(const char *name) {JsonDocument d; d["evt"] = name; char buffer[64]; size_t n = serializeJson(d, buffer, sizeof(buffer)); wss.broadcast(WebSocket::DataType::TEXT, buffer, n);}
void motion() {
  // Motion never overwrites a pending spin/result; the app owns the state.
  event("motion");
  if (mode == IDLE) {mode = ATTRACT; lastCommand = millis(); line(1, "Qualcuno arriva");}
}
void message(const char *data, uint16_t length) {
  JsonDocument d; if (length > 240 || deserializeJson(d, data, length)) return;
  const char *cmd = d["cmd"] | "";
  if (!strcmp(cmd, "ping")) {event("pong"); return;}
  if (!strcmp(cmd, "spin")) mode = SPIN;
  else if (!strcmp(cmd, "attract")) mode = ATTRACT;
  else if (!strcmp(cmd, "ready")) mode = READY;
  else if (!strcmp(cmd, "blocked")) mode = BLOCKED;
  else if (!strcmp(cmd, "idle")) mode = IDLE;
  else if (!strcmp(cmd, "result")) {mode = RESULT; tier = constrain(d["tier"] | 0, 0, 3); if ((d["hub"] | false) && tier == 0) tier = 2;}
  else return;
  lastCommand = millis();
  line(0, d["l1"] | (mode == SPIN ? "Gira gira..." : "Lucky Signal"));
  line(1, d["l2"] | (mode == IDLE ? "Avvicinati!" : ""));
}
uint32_t color(int r, int g, int b, int level) {return strip.Color(r * level / 255, g * level / 255, b * level / 255);}
void leds(unsigned long now) {
  if (now - lastLed < 25) return; lastLed = now;
  for (uint8_t i = 0; i < 8; i++) {
    uint32_t c = 0;
    if (mode == ATTRACT) c = strip.ColorHSV((uint16_t)(now * 12 + i * 8192), 255, 255);
    else if (mode == READY) c = color(255, 170, 30, 50 + abs((int)((now / 12) % 200) - 100));
    else if (mode == SPIN) {uint8_t distance = ((now / 45) + 8 - i) % 8; c = color(120, 200, 255, distance == 0 ? 255 : distance == 1 ? 100 : distance == 2 ? 40 : 5);}
    else if (mode == RESULT) {
      if (tier >= 3) c = random(3) == 0 ? strip.Color(255,255,255) : color(255,180,30,120 + random(135));
      else if (tier == 2) c = ((now / 90 + i) & 1) ? color(170,100,255,230) : color(255,180,30,200);
      else if (tier == 1) c = (now / 270) & 1 ? color(40,220,90,220) : 0;
      else c = color(255,30,30,30 + 40 * ((now / 360) & 1));
    }
    strip.setPixelColor(i, c);
  }
  strip.show();
}
void setup() {
  Serial.begin(115200); analogReadResolution(10);
  strip.begin(); strip.setBrightness(140); strip.clear(); strip.show();
  Wire.begin(); Wire.setTimeout(25);
  Wire.beginTransmission(0x27); lcdOk = Wire.endTransmission() == 0;
  if (lcdOk) {lcd.init(); lcd.backlight();}
  line(0, "Lucky Signal"); line(1, "WiFi...");
  WiFi.setTimeout(2500); if (strlen(SECRET_SSID)) WiFi.begin(SECRET_SSID, SECRET_PASS);
  // No fallback AP: it would disconnect the iPad from its backend.
  wss.onConnection([](WebSocket &ws) {
    if (connected) {ws.close(WebSocket::CloseCode::NORMAL_CLOSURE, true); return;}
    connected = true; event("hello"); idle();
    ws.onMessage([](WebSocket &, const WebSocket::DataType type, const char *data, uint16_t length) {if (type == WebSocket::DataType::TEXT) message(data, length);});
    ws.onClose([](WebSocket &, const WebSocket::CloseCode, const char *, uint16_t) {connected = false; idle();});
  });
  wss.begin(); WDT.begin(8000);
  Serial.println("Lucky Signal hardware v1. Commands: l=lever, m=motion, s=status");
}
void loop() {
  WDT.refresh(); unsigned long now = millis(); wss.listen();
  int dx = abs(analogRead(JOY_X) - 512), dy = abs(analogRead(JOY_Y) - 512);
  bool pulled = dx > 300 || dy > 300;
  if (dx < 120 && dy < 120) armed = true;
  if (pulled && armed && !pulledBefore && now - lastLever > 400) {lastLever = now; armed = false; event("lever");}
  pulledBefore = pulled;
  int pir = analogRead(PIR);
  if (now >= PIR_WARMUP_MS) {
    if (!pirOn && pir > PIR_ON && now - lastMotion > PIR_REARM_MS) {pirOn = true; lastMotion = now; motion();}
    else if (pirOn && pir < PIR_OFF) pirOn = false;
  }
  // A live app renews the command. Never invent a result on timeout.
  if (mode != IDLE && now - lastCommand > 5000) idle();
  leds(now);
  if (now - lastProbe > 1000) {
    lastProbe = now; Wire.beginTransmission(0x27); bool ok = Wire.endTransmission() == 0;
    if (ok && !lcdOk) {lcd.init(); lcd.backlight(); for (uint8_t row = 0; row < 2; row++) {lcd.setCursor(0,row); lcd.print(lastText[row]);}}
    lcdOk = ok;
  }
  if (now - lastWifi > 20000) {
    lastWifi = now;
    if (WiFi.status() != WL_CONNECTED) {
      connected = false; mode = IDLE; line(1, "WiFi scollegato");
      // Bound association attempts below the watchdog window.
      WDT.refresh(); WiFi.setTimeout(2500); if (strlen(SECRET_SSID)) WiFi.begin(SECRET_SSID, SECRET_PASS); WDT.refresh();
    }
    Serial.print("IP "); Serial.println(WiFi.localIP());
    if (!connected && WiFi.status() == WL_CONNECTED) {line(0, WiFi.localIP().toString().c_str()); line(1, "WS porta 81");}
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'l') event("lever");
    else if (c == 'm') motion();
    else if (c == 's') {Serial.print("IP "); Serial.print(WiFi.localIP()); Serial.print(" bridge="); Serial.print(connected); Serial.print(" pir="); Serial.print(pir); Serial.print(" mode="); Serial.println((int)mode);}
  }
}
