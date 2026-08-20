# ESP32 sensor — reference firmware

A small, idiomatic PlatformIO/Arduino sketch showing how a **real** device would speak the
same MQTT contract as `apps/simulator`. It is a reference for wiring a physical ESP32 + DHT22
into the platform — **it is not built, flashed, or tested in CI**, and there are no automated
checks for this directory (the repo's `bun test` / `bunx biome check` only cover the TypeScript
apps; this is plain C++/Arduino).

## What it implements

- Connects to Wi-Fi, then to the EMQX broker via `PubSubClient` using `username = clientid =
  DEVICE_ID` and `password = DEVICE_SECRET` (per the platform's MQTT auth delegation contract).
- Sets a retained Last Will (`devices/{id}/status` = `offline`) and publishes retained `online`
  plus a full shadow-reported document on connect.
- Publishes telemetry (`temperature`, `humidity`, `battery`) from a DHT22 + a battery ADC pin on
  `telemetry/{id}`, at `reportingIntervalMs` cadence (default 3000ms).
- Subscribes to `devices/{id}/shadow/delta` and applies `reportingIntervalMs`, then republishes
  the full reported state.
- Subscribes to `devices/{id}/rpc/request/+`; handles `identify` by blinking the status LED and
  replying `{ok:true}` on `devices/{id}/rpc/response/{requestId}`. Any other method replies
  `{ok:false, error:"unknown method"}`.

## What it deliberately leaves out

Unlike `apps/simulator`, this firmware does **not** implement OTA progress simulation or the
`reboot` / `readNow` / `getState` RPC methods, and it only applies the `reportingIntervalMs`
shadow key (not `ledOn` beyond what it reports, or `firmwareVersion`). For full-fidelity coverage
of the platform's device contract, run `apps/simulator` — this sketch exists to show the pattern
on real hardware, not to duplicate the simulator's feature set.

## Building

1. Install [PlatformIO](https://platformio.org/) (CLI or the VS Code extension).
2. Copy `include/config.h.example` to `include/config.h` (gitignored) and fill in your Wi-Fi
   credentials, broker host, and a device id/secret obtained from `POST /api/devices` (see the
   root README or `apps/simulator`).
3. Wire a DHT22 data pin to `DHT_PIN` (default GPIO4) and, optionally, a battery-voltage divider
   to `BATTERY_ADC_PIN` (default GPIO34).
4. `pio run -t upload` to flash, `pio device monitor` to watch serial output.

## Hardware

- ESP32 dev board (any `esp32dev`-compatible target)
- DHT22 temperature/humidity sensor
- Optional: resistor divider from a LiPo/battery rail into an ADC-capable pin, for the battery
  reading (falls back to whatever the pin floats to if left unconnected — fine for a bench demo,
  not for production).
