# 5-minute guided tour

Start the stack and open the console:

```bash
docker compose up --build -d
open http://localhost:8080
```

Within ~30 seconds the simulator provisions its fleet (default 6 devices), they authenticate
against the platform through EMQX's HTTP delegation, publish retained `online` status, and start
streaming telemetry. The Fleet view fills in live.

## 1. Watch the pipeline

- **Fleet view**: status dots, live values, sparklines. The stats bar is fed by `/api/stats` + WS.
- **Grafana** (http://localhost:3000): ingest rate, batch-flush p95, device temperature straight
  from TimescaleDB.
- **EMQX dashboard** (http://localhost:18083, admin / `iot-admin-1`): live client list — note every
  client authenticated via the HTTP authenticator, no broker-side credentials.

## 2. Device shadow (desired vs reported)

Open any device → **Shadow** panel. Set `reportingIntervalMs` to `1000` and apply — the platform
publishes a delta, the device applies it, re-reports, and the chart cadence visibly speeds up.

Same thing over the API:

```bash
DEV=$(curl -s localhost:8080/api/devices | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')
VER=$(curl -s localhost:8080/api/devices/$DEV/shadow | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')

curl -s -X PATCH localhost:8080/api/devices/$DEV/shadow \
  -H 'content-type: application/json' \
  -d "{\"version\": $VER, \"desired\": {\"reportingIntervalMs\": 1000}}"
```

Replay the same request (stale version) → `409` — optimistic concurrency in action.

## 3. RPC over MQTT

Device view → **RPC** panel → `readNow` returns the device's current readings synchronously;
`reboot` acknowledges, then the device drops (LWT fires, dot goes gray) and reconnects ~5s later.

```bash
curl -s -X POST localhost:8080/api/devices/$DEV/rpc \
  -H 'content-type: application/json' -d '{"method":"readNow"}'
```

## 4. OTA rollout

Device view → **OTA** panel → deploy `1.1.0` (pre-registered). Progress streams live:
`downloading → verifying → applying → rebooting → complete`, the device goes offline during
"rebooting" (real disconnect), and comes back reporting the new firmware version.

```bash
curl -s -X POST localhost:8080/api/devices/$DEV/firmware \
  -H 'content-type: application/json' -d '{"version":"1.1.0"}'
```

## 5. Alerts

The simulator injects occasional hot-spike episodes, so alerts fire on their own — but you can
force one instantly by tightening a rule in **Alerts & Rules** (e.g. set *High temperature* to
`> 20`). Watch it fire, then auto-resolve after restoring the threshold.

The *Sustained high humidity* seed rule demonstrates duration-gated firing: the condition must
hold for 60s before it trips (no flapping on a single noisy sample).

### Signed webhook action

Point a rule's `webhookUrl` at any public HTTPS request-inspection endpoint and trip it — the
delivery carries `X-Signature: sha256=<hmac>`, `X-Event-Id`, `X-Timestamp`. Verify with:

```bash
echo -n "$BODY" | openssl dgst -sha256 -hmac "dev-webhook-secret"
```

Private/loopback/metadata destinations are refused (SSRF guard) — try `http://127.0.0.1/x` and
check the server log.

## 6. Provision a real (or scripted) device

```bash
curl -s -X POST localhost:8080/api/devices \
  -H 'x-provisioning-token: dev-provisioning-token' \
  -H 'content-type: application/json' \
  -d '{"name":"bench-node-01","kind":"env-sensor","location":"workbench"}'
# → { "device": {...}, "secret": "ds_..." }  ← shown exactly once
```

Connect with any MQTT client using `username = clientid = deviceId`, `password = secret` — then try
publishing to another device's topic and watch the broker deny it (per-topic ACL). No MQTT client
handy? Use the HTTP ingest path:

```bash
curl -s -X POST localhost:8080/api/ingest \
  -H "authorization: Bearer $DEVICE_ID.$SECRET" \
  -H 'content-type: application/json' \
  -d '{"temperature": 24.5, "humidity": 51.2, "battery": 88}'
```

The ESP32 reference in `hardware/esp32-sensor/` speaks the same contract from real hardware.
