// ESP32 reference sensor firmware for the iot-fleet-platform telemetry contract.
// Reference implementation only — see README.md. Not built or tested in CI.
//
// Wire contract mirrors packages/shared/src/{topics,schemas}.ts:
//   telemetry:       {temperature, humidity, battery}
//   shadow delta in: {version, state: {reportingIntervalMs?, ledOn?, firmwareVersion?}}
//   shadow reported: {reportingIntervalMs, ledOn, firmwareVersion}
//   rpc request in:  {id, method, params?}
//   rpc response:    {id, ok, result?, error?}

#include <ArduinoJson.h>
#include <DHT.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "config.h"

DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

const String STATUS_TOPIC = "devices/" + String(DEVICE_ID) + "/status";
const String TELEMETRY_TOPIC = "telemetry/" + String(DEVICE_ID);
const String SHADOW_REPORTED_TOPIC = "devices/" + String(DEVICE_ID) + "/shadow/reported";
const String SHADOW_DELTA_TOPIC = "devices/" + String(DEVICE_ID) + "/shadow/delta";
const String RPC_REQUEST_FILTER = "devices/" + String(DEVICE_ID) + "/rpc/request/+";
const String RPC_REQUEST_PREFIX = "devices/" + String(DEVICE_ID) + "/rpc/request/";
const String RPC_RESPONSE_PREFIX = "devices/" + String(DEVICE_ID) + "/rpc/response/";

unsigned long reportingIntervalMs = DEFAULT_REPORTING_INTERVAL_MS;
unsigned long lastReportMs = 0;
bool ledOn = false;

void publishReportedState() {
  JsonDocument doc;
  doc["reportingIntervalMs"] = reportingIntervalMs;
  doc["ledOn"] = ledOn;
  doc["firmwareVersion"] = "1.0.0";
  char buf[128];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(SHADOW_REPORTED_TOPIC.c_str(), (const uint8_t*)buf, n, false);
}

void publishTelemetry() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  if (isnan(humidity) || isnan(temperature)) return; // sensor glitch — skip this tick

  int raw = analogRead(BATTERY_ADC_PIN); // expects a resistor-divider to VBAT
  float battery = constrain((raw / 4095.0f) * 100.0f, 0.0f, 100.0f);

  JsonDocument doc;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["battery"] = battery;
  char buf[128];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(TELEMETRY_TOPIC.c_str(), (const uint8_t*)buf, n, false);
}

void respondRpc(const String& requestId, const char* id, bool ok, const char* error) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = ok;
  if (error) doc["error"] = error;
  char buf[192];
  size_t n = serializeJson(doc, buf);
  String topic = RPC_RESPONSE_PREFIX + requestId;
  mqtt.publish(topic.c_str(), (const uint8_t*)buf, n, false);
}

void handleShadowDelta(JsonDocument& doc) {
  if (!doc["state"]["reportingIntervalMs"].isNull()) {
    reportingIntervalMs = doc["state"]["reportingIntervalMs"].as<unsigned long>();
  }
  publishReportedState(); // spec: apply known keys, then publish full reported state
}

void handleRpcRequest(const String& requestId, JsonDocument& doc) {
  const char* id = doc["id"] | "";
  const char* method = doc["method"] | "";
  if (strcmp(method, "identify") == 0) {
    for (int i = 0; i < 6; i++) {
      digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
      delay(150);
    }
    respondRpc(requestId, id, true, nullptr);
  } else {
    // This reference firmware only implements identify; everything else is out of scope.
    respondRpc(requestId, id, false, "unknown method");
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length) != DeserializationError::Ok) return;

  String t(topic);
  if (t == SHADOW_DELTA_TOPIC) {
    handleShadowDelta(doc);
  } else if (t.startsWith(RPC_REQUEST_PREFIX)) {
    handleRpcRequest(t.substring(RPC_REQUEST_PREFIX.length()), doc);
  }
}

void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(250);
}

void connectMqtt() {
  while (!mqtt.connected()) {
    // username == clientid == DEVICE_ID: the platform's auth delegation enforces this.
    mqtt.connect(DEVICE_ID, DEVICE_ID, DEVICE_SECRET, STATUS_TOPIC.c_str(), 1, true, "offline");
    if (mqtt.connected()) {
      mqtt.publish(STATUS_TOPIC.c_str(), "online", true);
      publishReportedState();
      mqtt.subscribe(SHADOW_DELTA_TOPIC.c_str(), 1);
      mqtt.subscribe(RPC_REQUEST_FILTER.c_str(), 1);
    } else {
      delay(2000);
    }
  }
}

void setup() {
  pinMode(STATUS_LED_PIN, OUTPUT);
  dht.begin();
  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastReportMs >= reportingIntervalMs) {
    lastReportMs = now;
    publishTelemetry();
  }
}
