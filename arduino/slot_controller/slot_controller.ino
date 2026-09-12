// Lucky Signal — UNO R4 WiFi. Joystick A0/A1, PIR A3, LCD 0x27, 8 WS2812 D9.
// Audio belongs to the iPad. D9 is exclusively the LED strip: no speaker/tone().
#include <WiFiS3.h>
#include <WiFiSSLClient.h>
#include "HttpResponse.h"
#include "InputGate.h"
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

#ifndef SLOT_BACKEND_HOST
#define SLOT_BACKEND_HOST "web-production-e2628.up.railway.app"
#endif
#ifndef SLOT_HARDWARE_TOKEN
#define SLOT_HARDWARE_TOKEN ""
#endif
WiFiSSLClient backend;
HttpResponse response;
InputGate inputGate;
char deviceId[33], pairingCode[9] = "";
uint32_t sequence = 0, requestAt = 0, responseAt = 0, pollAt = 0, motionAt = 0;
bool waiting = false, motionPending = false, tabletBound = false;
unsigned failures = 0;
int httpStatus = 0;
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
void idle() {mode = IDLE; line(0, "Lucky Signal"); line(1, connected ? "Avvicinati!" : "Backend offline");}
void event(const char *name) {
  if (!strcmp(name,"lever")) inputGate.pull(millis());
  if (!strcmp(name,"motion") && connected && tabletBound) {motionPending = true; motionAt = millis();}
}
void motion() {
  // Motion never overwrites a pending spin/result; the app owns the state.
  event("motion");
  if (mode == IDLE) {mode = ATTRACT; lastCommand = millis(); line(1, "Qualcuno arriva");}
}
void message(const char *data, uint16_t length) {
  JsonDocument d; if (length > 240 || deserializeJson(d, data, length)) return;
  const char *cmd = d["cmd"] | "";
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
void networkFailed() {
  backend.stop(); waiting = false; connected = false; tabletBound = false;
  inputGate.clear(); motionPending = false;
  failures = min(failures + 1, 5U);
  pollAt = millis() + min(1000UL << (failures-1), 10000UL);
  idle();
}
void acceptResponse() {
  httpStatus = response.status;
  if (httpStatus != 200) {Serial.print("Backend HTTP "); Serial.println(httpStatus); networkFailed(); return;}
  JsonDocument d;
  if (deserializeJson(d,response.body,response.size) || !d["bound"].is<bool>() || !d["code"].is<const char *>() || !d["gate"].is<const char *>() || !d["command"].is<JsonObject>()) {networkFailed(); return;}
  const char *code = d["code"], *gate = d["gate"];
  if (strlen(code)!=8 || strspn(code,"0123456789")!=8 || strlen(gate)>80) {networkFailed(); return;}
  unsigned long now=millis();
  // Ignore late replies, including old readiness, even if TLS stayed connected.
  if (now-requestAt>=1800) {networkFailed(); return;}
  connected = true; tabletBound = d["bound"]; failures = 0; responseAt = now;
  if (strcmp(pairingCode,code)) {strcpy(pairingCode,code); if (!tabletBound) {Serial.print("Pairing code: "); Serial.println(pairingCode);}}
  inputGate.update(tabletBound ? gate : "",now);
  char command[240]; size_t n=serializeJson(d["command"],command,sizeof(command));
  if (n>=sizeof(command)) {networkFailed(); return;}
  message(command,n);
  if (!tabletBound) {mode=IDLE; line(0,"Collega iPad:"); line(1,pairingCode);}
  waiting=false; pollAt=now+200;
  if (response.closeConnection) backend.stop();
}
void networkLoop() {
  unsigned long now=millis();
  if (!strlen(SECRET_SSID) || strlen(SLOT_HARDWARE_TOKEN)<32) {line(0,"Config mancante"); line(1,"WiFi / token"); return;}
  if (WiFi.status()!=WL_CONNECTED) {if (connected || waiting) networkFailed(); return;}
  if (connected && now-responseAt>=2000) {connected=false; inputGate.clear();}
  if (waiting) {
    // Read a bounded slice per loop; PIR/joystick/LEDs are sampled between slices.
    int available=backend.available();
    if (available>0) {
      uint8_t bytes[256]; int count=backend.read(bytes,min(available,256));
      for (int i=0;i<count;i++) response.feed((char)bytes[i]);
    }
    if (!response.done && !backend.connected()) response.end();
    if (response.failed || millis()-requestAt>=1800) {networkFailed(); return;}
    if (response.done) acceptResponse();
    return;
  }
  if ((int32_t)(now-pollAt)<0) return;
  if (!backend.connected()) {
    inputGate.clear(); motionPending=false;
    WDT.refresh(); int ok=backend.connect(SLOT_BACKEND_HOST,443); WDT.refresh();
    if (!ok) {httpStatus=0; Serial.println("Backend TLS unavailable"); networkFailed(); return;}
  }
  now=millis();
  JsonDocument d; d["deviceId"]=deviceId; d["seq"]=++sequence; d["online"]=true;
  JsonArray events=d["events"].to<JsonArray>();
  if (inputGate.hasPending(now)) {JsonObject e=events.add<JsonObject>(); e["evt"]="lever"; e["gate"]=inputGate.pending;}
  if (motionPending && now-motionAt<750) {JsonObject e=events.add<JsonObject>(); e["evt"]="motion";}
  // Drop before transmission: a timeout is ambiguous, never retry this input.
  inputGate.sent(); motionPending=false;
  char body[384]; size_t length=serializeJson(d,body,sizeof(body));
  if (length>=sizeof(body)) {networkFailed(); return;}
  char request[1024];
  int n=snprintf(request,sizeof(request),"POST /api/hardware/device HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nContent-Type: application/json\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nConnection: keep-alive\r\nContent-Length: %u\r\n\r\n%s",SLOT_BACKEND_HOST,SLOT_HARDWARE_TOKEN,(unsigned)length,body);
  if (n<0 || n>=(int)sizeof(request)) {networkFailed(); return;}
  response.reset(); requestAt=millis(); waiting=true;
  if (backend.write((const uint8_t*)request,n)!=(size_t)n) networkFailed();
}
void setup() {
  Serial.begin(115200); analogReadResolution(10);
  strip.begin(); strip.setBrightness(140); strip.clear(); strip.show();
  Wire.begin(); Wire.setTimeout(25);
  Wire.beginTransmission(0x27); lcdOk = Wire.endTransmission() == 0;
  if (lcdOk) {lcd.init(); lcd.backlight();}
  line(0, "Lucky Signal"); line(1, "WiFi...");
  WiFi.setTimeout(2500); if (strlen(SECRET_SSID)) WiFi.begin(SECRET_SSID, SECRET_PASS);
  // Verified TLS uses the ESP32-S3 radio's built-in CA bundle and hostname.
  // No insecure fallback, certificate override, LAN listener or local bridge.
  backend.setConnectionTimeout(2500);
  randomSeed(analogRead(A2) ^ micros());
  for (uint8_t i=0;i<16;i++) sprintf(deviceId+i*2,"%02x",(unsigned)random(256));
  WDT.begin(8000);
  Serial.print("Lucky Signal hardware v2 HTTPS / radio "); Serial.println(WiFi.firmwareVersion());
  Serial.println("Commands: l=lever, m=motion, s=status");
}
void loop() {
  WDT.refresh(); unsigned long now = millis();
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
  if (connected && !tabletBound && mode == IDLE) {line(0,"Collega iPad:"); line(1,pairingCode);}
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

  }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'l') event("lever");
    else if (c == 'm') motion();
    else if (c == 's') {Serial.print("IP "); Serial.print(WiFi.localIP()); Serial.print(" backend="); Serial.print(connected); Serial.print(" pir="); Serial.print(pir); Serial.print(" mode="); Serial.print((int)mode); Serial.print(" http="); Serial.print(httpStatus); Serial.print(" wifi="); Serial.println(WiFi.status());}
  }
  networkLoop();
}
