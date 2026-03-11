sms2mqtt — MQTT bridge to send/receive SMS via ZTE F50 modem

Usage

1. Copy `.env.example` to `.env` and set values (MQTT broker, modem IP/password).

2. Install dependencies:

```bash
npm install
```

3. Start the service:

```bash
npm start
```

Topics

- To send SMS: publish JSON to `sms2mqtt/send` (or `{PREFIX}/send`):

  {"number":"+33612345678", "text":"This is a test message"}

- Sent confirmation published on `sms2mqtt/sent`:

  {"result":"success","datetime":"2021-01-23 13:00:00","number":"+33612345678","text":"This is a test message"}

- Received SMS are published on `sms2mqtt/received`:

  {"datetime":"2021-01-23 13:30:00","number":"+31415926535","text":"Hi, Be the Pi with you"}

Notes

- Multiple numbers supported using semicolon separated list: `"number":"+33612345678;+33123456789"`.
- Very long and unicode messages are supported; confirmations are sent per number.

Docker

Build the image from the repository root:

```bash
docker build -t zte-sms-mqtt .
```

Run the container (recommended to provide a host network or reach the modem from container):

```bash
# using an env file (.env) in the project root
docker run -d --name zte-sms-mqtt --env-file .env --network host zte-sms-mqtt
```

If you don't want to use host networking, map the MQTT broker and modem reachability appropriately.

Non-host networking (optional)

If you'd rather run the container without `--network host`, a sample `docker-compose.override.yml` is provided. It uses bridge networking and offers an `extra_hosts` mapping so the container can resolve the modem hostname to the IP configured in your `.env`.

Usage:

```bash
docker-compose -f docker-compose.yml -f docker-compose.override.yml build
docker-compose -f docker-compose.yml -f docker-compose.override.yml up -d
```

Notes:
- Ensure `MODEM_IP` is set in your `.env`. The override file maps `zte-modem` to that IP; you may also keep using the `MODEM_IP` value directly.
- Port `1883` is exposed in the override for convenience; remove the `ports` entry if you don't need it.
