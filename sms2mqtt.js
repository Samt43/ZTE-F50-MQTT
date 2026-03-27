#!/usr/bin/env node
require('dotenv').config();
const mqtt = require('mqtt');
const Modem = require('@zigasebenik/zte-sms');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const MQTT_URL = process.env.MQTT_URL || 'mqtt://10.3.0.1:1883';
const PREFIX = process.env.PREFIX || 'sms2mqtt';
const MODEM_IP = process.env.MODEM_IP || process.env.ZTE_MODEM_IP || '192.168.1.1';
const MODEM_PASSWORD = process.env.MODEM_PASSWORD || process.env.ZTE_MODEM_PASSWORD || 'admin';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '15000', 10);
const PING_ADDR = process.env.PING_ADDR || '8.8.8.8';
const PING_INTERVAL = parseInt(process.env.PING_INTERVAL || '10000', 10);

let modem = new Modem({ modemIP: MODEM_IP, modemPassword: MODEM_PASSWORD });
// Simple async mutex to serialize modem access so login/logout stay paired
class Mutex {
  constructor() { this._lock = Promise.resolve(); }
  async acquire() {
    let release;
    const p = new Promise(resolve => (release = resolve));
    const prev = this._lock;
    this._lock = prev.then(() => p);
    await prev;
    return release;
  }
}
const modemMutex = new Mutex();

// Keep modem logged in for a short time to avoid logging in/out on every call.
let loggedIn = false;
let lastAccess = 0;
let logoutTimer = null;
const LOGOUT_DELAY = 10 * 60 * 1000; // 10 minutes

function scheduleLogout() {
  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = setTimeout(async () => {
    const age = Date.now() - lastAccess;
    if (age < LOGOUT_DELAY) return;
    let release;
    try {
      release = await modemMutex.acquire();
      if (!loggedIn) return;
      await modem.logout();
      loggedIn = false;
    } catch (e) {
      console.error('Error during modem.logout():', e);
    } finally {
      if (release) release();
    }
  }, LOGOUT_DELAY);
}

// Helper to ensure modem.login() runs before the action and modem.logout() after,
// even if the action throws. Also serializes access so multiple async callers
// won't interleave login/logout.
async function withModem(action) {
  const release = await modemMutex.acquire();
  try {
    // Try the action first without logging in
    try {
      return await action();
    } catch (err) {
      // If it fails, try logging in and retrying once
      console.log('Action failed, attempting login and retry:', err.message);
      await modem.login();
      loggedIn = true;
      lastAccess = Date.now();
      scheduleLogout();
      return await action();
    }
  } finally {
    release();
  }
}
// MQTT connection options (support username/password via env)
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const mqttOptions = {};
if (process.env.MQTT_USERNAME) mqttOptions.username = process.env.MQTT_USERNAME;
if (process.env.MQTT_PASSWORD) mqttOptions.password = process.env.MQTT_PASSWORD;
if (process.env.MQTT_CLIENT_ID) mqttOptions.clientId = process.env.MQTT_CLIENT_ID;
let client;
if (DRY_RUN) {
  // replace modem with a safe stub that logs actions
  modem = {
    login: async () => console.log('DRY_RUN modem.login'),
    logout: async () => console.log('DRY_RUN modem.logout'),
    sendSms: async (number, text) => { console.log('DRY_RUN sendSms', number, text); return { result: 'ok' }; },
    getAllSms: async () => [{ datetime: formatDate(), number: '+10000000000', text: 'dry-run' }],
    resetConnection: async () => console.log('DRY_RUN resetConnection')
  };
  client = {
    on: (ev, cb) => { if (ev === 'connect') setImmediate(cb); },
    publish: (topic, msg, opts, cb) => { console.log('DRY_RUN publish', topic, msg); if (typeof opts === 'function') opts(); if (cb) cb && cb(); },
    subscribe: (topic, cb) => { console.log('DRY_RUN subscribe', topic); if (cb) cb(); },
    end: () => console.log('DRY_RUN client.end')
  };
} else {
  client = mqtt.connect(MQTT_URL, mqttOptions);
}

const sentTopic = `${PREFIX}/sent`;
const sendTopic = `${PREFIX}/send`;
const receivedTopic = `${PREFIX}/received`;

let seen = new Set();
let resetting = false;
let consecutivePingFailures = 0;

async function checkPing() {
  try {
    await exec(`ping -c 1 -W 2 ${PING_ADDR}`, { timeout: 4000 });
    // ping ok
    consecutivePingFailures = 0;
    return;
  } catch (err) {
    consecutivePingFailures += 1;
    console.error('Ping failed to', PING_ADDR, String(err), `(consecutive: ${consecutivePingFailures})`);

    // Only attempt reset once we've seen 3 consecutive ping failures
    if (consecutivePingFailures < 3) return;

    if (resetting) return;
    resetting = true;
    try {
      console.log('Attempting modem reset via resetConnection');
      // call modem resetConnection if available
      await withModem(async () => {
        await modem.resetConnection();
      });
    } catch (e) {
      console.error('Error during modem resetConnection:', e);
    } finally {
      resetting = false;
      // reset counter so we require 3 more consecutive failures before trying again
      consecutivePingFailures = 0;
    }
  }
}

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

  try {
    await withModem(async () => {
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
  } catch (err) {
    console.error('Error sending SMS:', err);
  }
});

async function pollInbox() {
  try {
    const msgs = await withModem(async () => await modem.getAllSms());
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
    if (DRY_RUN) {
      console.log('DRY_RUN: running self-test (no modem/network will be used)');
      try {
        await withModem(async () => {
          await modem.sendSms('+1234567890', 'dry-run');
          const msgs = await modem.getAllSms();
          console.log('DRY_RUN msgs:', msgs);
          await modem.resetConnection();
        });
        console.log('DRY_RUN self-test completed');
      } catch (e) {
        console.error('DRY_RUN self-test error:', e);
      }
      process.exit(0);
    }
    // some modems may require a login/initialization step; library handles that
    // warm up once
    await pollInbox();
    setInterval(pollInbox, POLL_INTERVAL);
    // start ping watchdog
    try {
      await checkPing();
      setInterval(checkPing, PING_INTERVAL);
      console.log('Ping watchdog started for', PING_ADDR);
    } catch (e) {
      console.error('Error starting ping watchdog:', e);
    }
  } catch (err) {
    console.error('Initialization error:', err);
  }
})();

process.on('SIGINT', () => { console.log('Shutting down'); client.end(); process.exit(0); });
