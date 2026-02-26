'use strict';

require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const path = require('path');

const app = express();

// ── Configuration ────────────────────────────────────────────────────────────
const ACCOUNT_SID    = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN     = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER    = process.env.TWILIO_PHONE_NUMBER;
const TARGET_NUMBER  = process.env.TARGET_NUMBER || '82008';
const PORT           = parseInt(process.env.PORT || '3000', 10);

// Known short-code services (used to label agent notifications in the UI)
const KNOWN_SERVICES = {
  '82008': { name: 'Alaska Airlines', logo: '✈️' },
};

// In-memory message store (keyed by conversation: from+to pair)
// Each entry: { direction: 'outbound'|'inbound', body, timestamp, sid }
const messages = [];

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API: get config (safe, no secrets) ────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    targetNumber: TARGET_NUMBER,
    serviceInfo: KNOWN_SERVICES[TARGET_NUMBER] || null,
    configured: Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER),
  });
});

// ── API: list messages ────────────────────────────────────────────────────────
app.get('/api/messages', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const result = messages.filter(m => m.timestamp > since);
  res.json(result);
});

// ── API: send a message ────────────────────────────────────────────────────────
app.post('/api/send', async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Message body is required.' });
  }

  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    return res.status(503).json({
      error: 'Twilio is not configured. Copy .env.example to .env and fill in your credentials.',
    });
  }

  try {
    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
    const msg = await client.messages.create({
      body: body.trim(),
      from: FROM_NUMBER,
      to: TARGET_NUMBER,
    });

    const entry = {
      sid: msg.sid,
      direction: 'outbound',
      body: body.trim(),
      from: FROM_NUMBER,
      to: TARGET_NUMBER,
      timestamp: Date.now(),
    };
    messages.push(entry);

    res.json(entry);
  } catch (err) {
    console.error('Twilio send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Webhook: receive inbound messages from Twilio ─────────────────────────────
// Point your Twilio number's "A MESSAGE COMES IN" webhook to:
//   https://<your-host>/webhook/inbound
app.post('/webhook/inbound', (req, res) => {
  const from = req.body.From || '';
  const to   = req.body.To   || '';
  const body = req.body.Body || '';

  if (from && body) {
    messages.push({
      direction: 'inbound',
      body,
      from,
      to,
      timestamp: Date.now(),
    });
    console.log(`Inbound message from ${from}: ${body}`);
  }

  // Respond with an empty TwiML response (no auto-reply)
  res.type('text/xml').send('<Response></Response>');
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Alaska Air SMS Chat running at http://localhost:${PORT}`);
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    console.warn('⚠  Twilio credentials not set. Copy .env.example → .env and add your credentials.');
  }
});

module.exports = app; // exported for testing
