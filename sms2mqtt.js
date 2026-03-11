#!/usr/bin/env node
require('dotenv').config();
const mqtt = require('mqtt');
const Modem = require('@zigasebenik/zte-sms');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const PREFIX = process.env.PREFIX || 'sms2mqtt';
const MODEM_IP = process.env.MODEM_IP || process.env.ZTE_MODEM_IP || '192.168.1.1';
const MODEM_PASSWORD = process.env.MODEM_PASSWORD || process.env.ZTE_MODEM_PASSWORD || 'admin';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '15000', 10);

const modem = new Modem({ modemIP: MODEM_IP, modemPassword: MODEM_PASSWORD });
const client = mqtt.connect(MQTT_URL);

const sentTopic = `${PREFIX}/sent`;
const sendTopic = `${PREFIX}/send`;
const receivedTopic = `${PREFIX}/received`;

let seen = new Set();

function formatDate(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

client.on('connect', () => {
  console.log('Connected to MQTT', MQTT_URL);
  client.subscribe(sendTopic, err => {
    if (err) console.error('Subscribe error:', err);
    else console.log('Subscribed to', sendTopic);
  });
});

client.on('message', async (topic, message) => {
  if (topic !== sendTopic) return;
  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch (err) {
    console.error('Invalid JSON payload on', sendTopic, err);
    return;
  }

  const numberField = payload.number;
  const text = payload.text || '';
  if (!numberField) {
    console.error('Missing number in payload');
    return;
  }

  // support semicolon-separated multiple numbers
  const numbers = String(numberField).split(';').map(n => n.trim()).filter(Boolean);

  for (const number of numbers) {
    try {
      await modem.sendSms(number, text);
      const result = { result: 'success', datetime: formatDate(), number, text };
      client.publish(sentTopic, JSON.stringify(result));
      console.log('Sent SMS to', number);
    } catch (err) {
      const result = { result: 'error', datetime: formatDate(), number, text, error: String(err) };
      client.publish(sentTopic, JSON.stringify(result));
      console.error('Failed to send SMS to', number, err);
    }
  }
});

async function pollInbox() {
  try {
    const msgs = await modem.getAllSms();
    if (!Array.isArray(msgs)) return;
    for (const m of msgs) {
      // try to normalize fields
      const datetime = m.datetime || m.date || m.time || formatDate();
      const number = m.number || m.sender || m.from || '';
      const text = m.text || m.body || m.message || '';
      const key = `${number}::${datetime}::${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const out = { datetime, number, text };
      client.publish(receivedTopic, JSON.stringify(out));
      console.log('Published received SMS from', number);
    }
  } catch (err) {
    console.error('Error polling inbox:', err);
  }
}

(async () => {
  try {
    console.log('Initializing modem', MODEM_IP);
    // some modems may require a login/initialization step; library handles that
    // warm up once
    await pollInbox();
    setInterval(pollInbox, POLL_INTERVAL);
  } catch (err) {
    console.error('Initialization error:', err);
  }
})();

process.on('SIGINT', () => { console.log('Shutting down'); client.end(); process.exit(0); });
