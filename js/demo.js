/* ──────────────────────────────────────────────
   RYCO AI Support Agent — demo.js
   Real backend: Groq API via /api/chat
   Tickets stored in Supabase, emails via Resend
   ────────────────────────────────────────────── */

/* ── Client-side state ─────────────────────── */
let messages      = [];    // full chat messages array [{role, content}]
let lastTicket    = null;  // set once the API returns a ticket object
let isThinking    = false;
let capturedEmail = null;  // real email, sent separately — never travels to Groq

/* ── DOM refs ──────────────────────────────── */
const chatBody   = () => document.getElementById('chat-body');
const chatInput  = () => document.getElementById('chat-input');
const sendBtn    = () => document.getElementById('send-btn');
const chatStatus = () => document.getElementById('chat-status');

/* ── Utilities ─────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setStep(n, state) {
  const el = document.getElementById('s' + n);
  if (!el) return;
  el.classList.remove('active', 'done', 'pending');
  el.classList.add(state);
}

function lockInput(locked) {
  const inp = chatInput();
  const btn = sendBtn();
  if (!inp || !btn) return;
  inp.disabled  = locked;
  btn.disabled  = locked;
  inp.style.opacity = locked ? '0.45' : '1';
}

function setStatus(text, type) {
  const el = chatStatus();
  if (!el) return;
  const dot = type === 'typing' ? 'typing' : type === 'online' ? 'online' : '';
  el.innerHTML = `<span class="status-dot ${dot}"></span> ${text}`;
}

/* ── Session ID ────────────────────────────── */
function getSessionId() {
  const key = 'ryco_session';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, crypto.randomUUID());
  }
  return sessionStorage.getItem(key);
}

/* ── Step tracker — driven by phase from API ──
   Phase values from the server:
     helping         → troubleshooting in progress
     asking_email    → escalated, collecting email
     asking_urgency  → have email, asking urgency
     creating_ticket → urgency received, creating
     resolved        → self-resolved, no ticket
   ─────────────────────────────────────────── */
const PHASE_STEPS = {
  helping:         { done: [1, 2], active: 3 },
  asking_email:    { done: [1, 2, 3, 4], active: 5 },
  asking_urgency:  { done: [1, 2, 3, 4, 5], active: 6 },
  creating_ticket: { done: [1, 2, 3, 4, 5, 6], active: 7 },
  resolved:        { done: [1, 2, 3], active: null },
};

function syncSteps(phase, ticketDone) {
  for (let i = 1; i <= 8; i++) setStep(i, 'pending');
  if (ticketDone) {
    for (let i = 1; i <= 8; i++) setStep(i, 'done');
    return;
  }
  const map = PHASE_STEPS[phase] ?? PHASE_STEPS.helping;
  map.done.forEach(n => setStep(n, 'done'));
  if (map.active) setStep(map.active, 'active');
}

/* ── Message rendering ─────────────────────── */
function addMessage(from, html, opts = {}) {
  const body = chatBody();
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg from-' + from;

  if (from === 'bot') {
    const av = document.createElement('span');
    av.className   = 'chat-avatar';
    av.textContent = '🤖';
    wrap.appendChild(av);
  }

  const col = document.createElement('div');
  col.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const bubble = document.createElement('div');
  bubble.className  = 'chat-bubble' + (opts.success ? ' success-bubble' : '');
  bubble.innerHTML  = html.replace(/\n/g, '<br>');
  col.appendChild(bubble);

  if (opts.quickReplies?.length) {
    const row = document.createElement('div');
    row.className = 'quick-replies';
    opts.quickReplies.forEach(label => {
      const btn = document.createElement('button');
      btn.className   = 'qr-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        row.querySelectorAll('.qr-btn').forEach(b => {
          b.disabled = true;
          b.style.opacity = '0.45';
        });
        handleUserInput(label);
      });
      row.appendChild(btn);
    });
    col.appendChild(row);
  }

  const ts = document.createElement('div');
  ts.className   = 'chat-time';
  ts.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  col.appendChild(ts);

  wrap.appendChild(col);
  body.appendChild(wrap);
  body.scrollTop = body.scrollHeight;
}

function showTyping() {
  const el = document.createElement('div');
  el.className = 'typing-indicator';
  el.id        = 'typing-indicator';
  el.innerHTML = `<span class="chat-avatar">🤖</span>
    <div class="typing-dots"><span></span><span></span><span></span></div>`;
  chatBody().appendChild(el);
  chatBody().scrollTop = chatBody().scrollHeight;
  setStatus('Typing…', 'typing');
}

function hideTyping() {
  document.getElementById('typing-indicator')?.remove();
  setStatus('Online', 'online');
}

/* ── Flow animation (sidebar badge) ───────── */
async function runFlowAnimation() {
  const badge = document.getElementById('flow-badge');
  badge.classList.remove('hidden');
  for (const id of ['fs1', 'fs2', 'fs3', 'fs4', 'fs5']) {
    await sleep(560);
    document.getElementById(id)?.classList.remove('hidden');
  }
}

/* ── Ticket card (populated from API data) ── */
function showTicketCard(ticket) {
  const priClass = ticket.priority === 'High'   ? 'red-badge'
                 : ticket.priority === 'Medium' ? 'yellow-badge' : 'green-badge';

  const created = ticket.created_at
    ? new Date(ticket.created_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  document.getElementById('ticket-card').innerHTML = `
    <div class="ticket-card-inner">
      <div class="ticket-header">
        <span class="ticket-icon">🎫</span>
        <div>
          <h3>Ticket Created Successfully</h3>
          <p>Record written to Supabase · Confirmation email sent via Resend</p>
        </div>
      </div>
      <div class="ticket-fields">
        <div class="tf"><span class="tf-label">Ticket ID</span>
          <span class="tf-val mono">${ticket.ticket_id}</span></div>
        <div class="tf"><span class="tf-label">Status</span>
          <span class="tf-val badge-sm green-badge">Open</span></div>
        <div class="tf"><span class="tf-label">Priority</span>
          <span class="tf-val badge-sm ${priClass}">${ticket.priority}</span></div>
        <div class="tf"><span class="tf-label">Requestor</span>
          <span class="tf-val">${ticket.requestor_name}</span></div>
        <div class="tf"><span class="tf-label">Email</span>
          <span class="tf-val mono">${ticket.requestor_email}</span></div>
        <div class="tf"><span class="tf-label">Category</span>
          <span class="tf-val">${ticket.category}</span></div>
        <div class="tf"><span class="tf-label">Assigned Team</span>
          <span class="tf-val">${ticket.assigned_team}</span></div>
        <div class="tf"><span class="tf-label">SLA</span>
          <span class="tf-val">Response within ${ticket.sla}</span></div>
        <div class="tf"><span class="tf-label">Created</span>
          <span class="tf-val mono">${created}</span></div>
        <div class="tf full-width"><span class="tf-label">Description</span>
          <span class="tf-val">${ticket.description}</span></div>
      </div>
    </div>`;

  document.getElementById('ticket-card').classList.remove('hidden');
  document.getElementById('ticket-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Core: send message → /api/chat ────────── */
async function handleUserInput(rawText) {
  const text = rawText.trim();
  if (!text || isThinking || lastTicket) return;

  /* Capture email the moment the user types it so we can send it
     separately from the messages array — it never reaches Groq */
  if (!capturedEmail) {
    const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) capturedEmail = emailMatch[0].toLowerCase();
  }

  /* Append user turn and show it */
  messages.push({ role: 'user', content: text });
  addMessage('user', text);

  isThinking = true;
  lockInput(true);
  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages, sessionId: getSessionId(), userEmail: capturedEmail }),
    });

    hideTyping();

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      addMessage('bot', `⚠️ Something went wrong: ${err.error || res.status}. Please try again.`);
      messages.pop();
      isThinking = false;
      lockInput(false);
      return;
    }

    const data = await res.json();

    /* Append assistant reply to history */
    messages.push({ role: 'assistant', content: data.message });

    if (data.ticket) {
      /* ── Ticket received ─────────────────────────────────────────── */
      lastTicket = data.ticket;

      await runFlowAnimation();
      syncSteps('creating_ticket', true);

      addMessage('bot', data.message, { success: true });
      lockInput(true);
      chatInput().placeholder = 'Conversation complete — click "New Conversation" to restart.';

      await sleep(400);
      showTicketCard(data.ticket);
      loadTicketTable();

    } else {
      /* ── Regular reply ───────────────────────────────────────────── */
      const phase = data.phase ?? 'helping';
      syncSteps(phase, false);

      /* Show urgency quick replies when the AI is asking for urgency */
      const opts = phase === 'asking_urgency'
        ? { quickReplies: ['🔴 High — need it now', '🟡 Medium — within the hour', '🟢 Low — today is fine'] }
        : {};

      addMessage('bot', data.message, opts);

      if (phase === 'resolved') {
        lockInput(true);
        chatInput().placeholder = 'Issue resolved! Click "New Conversation" to start again.';
      } else {
        lockInput(false);
        chatInput()?.focus();
      }
    }

  } catch (networkErr) {
    hideTyping();
    addMessage('bot', '⚠️ Network error — please check your connection and try again.');
    messages.pop();
    lockInput(false);
  }

  isThinking = false;
}

/* ── Input wiring ──────────────────────────── */
function submitInput() {
  const inp = chatInput();
  const val = inp?.value.trim();
  if (!val) return;
  inp.value = '';
  handleUserInput(val);
}

/* ── Reset ─────────────────────────────────── */
function resetDemo() {
  messages      = [];
  lastTicket    = null;
  isThinking    = false;
  capturedEmail = null;
  sessionStorage.removeItem('ryco_session');

  chatBody().querySelectorAll('.chat-msg, .typing-indicator').forEach(el => el.remove());
  for (let i = 1; i <= 9; i++) setStep(i, 'pending');

  document.getElementById('flow-badge').classList.add('hidden');
  ['fs1','fs2','fs3','fs4','fs5'].forEach(id =>
    document.getElementById(id)?.classList.add('hidden')
  );

  const tc = document.getElementById('ticket-card');
  tc.innerHTML = '';
  tc.classList.add('hidden');

  lockInput(false);
  const inp = chatInput();
  if (inp) { inp.placeholder = 'Describe your IT issue…'; inp.focus(); }
  setStatus('Online', 'online');

  setTimeout(showWelcome, 300);
}

function showWelcome() {
  addMessage('bot',
    '👋 Hi! I\'m the IT Support Agent.\n\nTell me what IT issue you\'re running into and I\'ll get a ticket created for you straight away.',
    { quickReplies: ['VPN not connecting', 'Locked out of account', 'Laptop / hardware issue', 'App or software issue'] }
  );
}

/* ── Init ──────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  chatInput()?.addEventListener('keydown', e => { if (e.key === 'Enter') submitInput(); });
  sendBtn()?.addEventListener('click', submitInput);

  setTimeout(() => { showWelcome(); chatInput()?.focus(); }, 400);
  loadTicketTable();
});

/* ── Live ticket table (hits /api/tickets) ── */
async function loadTicketTable() {
  const tbody = document.getElementById('ticket-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#475569;padding:20px">Loading…</td></tr>';

  try {
    const data = await fetch('/api/tickets').then(r => r.json());

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#475569;padding:20px">'
        + 'No tickets yet — complete the demo above to create the first one!</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.forEach(t => {
      const tr = document.createElement('tr');
      const priClass = t.priority === 'High' ? 'pri-high' : t.priority === 'Medium' ? 'pri-medium' : 'pri-low';
      tr.innerHTML = `
        <td class="mono">${t.ticket_id}</td>
        <td>${t.date}</td>
        <td>${t.requestor}</td>
        <td>${t.category}</td>
        <td class="${priClass}">${t.priority}</td>
        <td>${t.assigned_team}</td>
        <td class="${t.resolved ? 'res-yes' : 'res-no'}">${t.resolved ? 'Yes' : 'In Progress'}</td>
        <td>${t.resolution_time || '—'}</td>`;
      tbody.appendChild(tr);
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#475569;padding:20px">'
      + 'Could not load ticket data — run via <code>vercel dev</code> or the deployed URL.</td></tr>';
  }
}
