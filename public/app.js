'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let lastTimestamp = 0;
let polling = null;
let sending = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const messagesEl    = document.getElementById('messages');
const inputEl       = document.getElementById('msg-input');
const sendBtn       = document.getElementById('send-btn');
const statusDot     = document.getElementById('status-dot');
const agentBanner   = document.getElementById('agent-banner');
const bannerTitle   = document.getElementById('banner-title');
const bannerBody    = document.getElementById('banner-body');
const configWarning = document.getElementById('config-warning');
const headerLogo    = document.getElementById('header-logo');
const headerName    = document.getElementById('header-name');
const headerNumber  = document.getElementById('header-number');
const toast         = document.getElementById('new-msg-toast');

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isAtBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
}

function scrollToBottom(force) {
  if (force || isAtBottom()) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function setStatus(state) {
  statusDot.className = state;
  statusDot.title = { connected: 'Connected', error: 'Connection error', '': 'Connecting…' }[state] || '';
}

// ── Render a single message bubble ───────────────────────────────────────────
function renderMessage(msg) {
  const row = document.createElement('div');
  row.className = `bubble-row ${msg.direction}`;
  row.dataset.sid = msg.sid || msg.timestamp;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = msg.body;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const label = msg.direction === 'outbound' ? 'You' : (msg.from || 'Agent');
  meta.textContent = `${label} · ${formatTime(msg.timestamp)}`;

  row.appendChild(bubble);
  row.appendChild(meta);
  return row;
}

// ── Load config and initialise UI ─────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();

    // Update header
    headerNumber.textContent = cfg.targetNumber || '82008';
    if (cfg.serviceInfo) {
      headerLogo.textContent = cfg.serviceInfo.logo || '✈️';
      headerName.textContent = cfg.serviceInfo.name + ' SMS';
    }

    // Show agent notification banner for any short code (≤6 digits) or known service
    const target = String(cfg.targetNumber || '');
    const isShortCode = /^\d{5,6}$/.test(target);
    if (isShortCode || cfg.serviceInfo) {
      const svc = cfg.serviceInfo;
      bannerTitle.textContent = svc
        ? `${svc.logo || '🤖'} ${svc.name} – Automated Agent`
        : '🤖 Automated Short-Code Service';
      bannerBody.textContent = isShortCode
        ? `You are chatting with ${svc ? svc.name : 'an automated SMS service'} (${target}). ` +
          'Responses are from a bot or automated system — not a live agent. ' +
          'Message & data rates may apply. Reply STOP to opt out.'
        : bannerBody.textContent;
      agentBanner.classList.remove('hidden');
    }

    // Show config warning if Twilio not set up
    if (!cfg.configured) {
      configWarning.classList.remove('hidden');
    }

    setStatus('connected');
  } catch (e) {
    setStatus('error');
    console.error('Failed to load config', e);
  }

  // Start polling for messages
  await poll();
  polling = setInterval(poll, 3000);
}

// ── Poll for new messages ─────────────────────────────────────────────────────
async function poll() {
  try {
    const res = await fetch(`/api/messages?since=${lastTimestamp}`);
    if (!res.ok) throw new Error(res.statusText);
    const msgs = await res.json();
    setStatus('connected');

    if (msgs.length === 0) return;

    const wasAtBottom = isAtBottom();
    let hasInbound = false;

    msgs.forEach(msg => {
      // Skip if already rendered
      const id = msg.sid || msg.timestamp;
      if (messagesEl.querySelector(`[data-sid="${id}"]`)) return;

      messagesEl.appendChild(renderMessage(msg));
      lastTimestamp = Math.max(lastTimestamp, msg.timestamp);
      if (msg.direction === 'inbound') hasInbound = true;
    });

    scrollToBottom(wasAtBottom);

    // Toast notification for new inbound messages when not at bottom
    if (hasInbound && !wasAtBottom) {
      showToast('New message from agent ↓');
    }
  } catch (e) {
    setStatus('error');
    console.error('Poll error', e);
  }
}

// ── Send a message ───────────────────────────────────────────────────────────
async function send() {
  const body = inputEl.value.trim();
  if (!body || sending) return;

  sending = true;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(`⚠️ ${data.error || 'Failed to send'}`);
    } else {
      inputEl.value = '';
      autoResize();
      // Render immediately (don't wait for next poll)
      if (!messagesEl.querySelector(`[data-sid="${data.sid || data.timestamp}"]`)) {
        messagesEl.appendChild(renderMessage(data));
        lastTimestamp = Math.max(lastTimestamp, data.timestamp);
      }
      scrollToBottom(true);
    }
  } catch (e) {
    showToast('⚠️ Network error — check your connection');
    console.error('Send error', e);
  } finally {
    sending = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>`;
  }
}

// ── Auto-resize textarea ──────────────────────────────────────────────────────
function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}

// ── Toast click: scroll to bottom ─────────────────────────────────────────────
toast.addEventListener('click', () => {
  scrollToBottom(true);
  toast.classList.remove('show');
});

// ── Events ────────────────────────────────────────────────────────────────────
sendBtn.addEventListener('click', send);
inputEl.addEventListener('input', autoResize);
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
