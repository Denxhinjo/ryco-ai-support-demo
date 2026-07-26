const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

/* ── Clients ─────────────────────────────────────────── */
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabase = process.env.SUPABASE_URL
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/* ── Routing / SLA tables ────────────────────────────── */
const TEAM_MAP = {
  Network:  { team: 'Network Operations',  sla: '30 minutes' },
  Hardware: { team: 'Hardware Support',    sla: '2 hours'    },
  Software: { team: 'Software Support',    sla: '1 hour'     },
  Access:   { team: 'Identity & Access',   sla: '30 minutes' },
  General:  { team: 'IT Support',          sla: '2 hours'    },
};

/* ── Ticket ID generator ─────────────────────────────── */
function genTicketId() {
  return '#INC-' + (20000 + Math.floor(Math.random() * 9000));
}

/* ── PII redaction ───────────────────────────────────────
   Strips emails and phone numbers from every message before
   they leave our server and reach Groq's API.
   The real email is passed separately in req.body.userEmail
   and substituted back in when writing the ticket to Supabase.
   ─────────────────────────────────────────────────────── */
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?[\d][\d\s\-().]{6,}[\d])/g;

function redactPII(messages) {
  return messages.map(msg => ({
    ...msg,
    content: msg.content
      .replace(EMAIL_RE, '[REDACTED_EMAIL]')
      .replace(PHONE_RE, m => /\d{5,}/.test(m) ? '[REDACTED_PHONE]' : m),
  }));
}

/* ── System prompt ───────────────────────────────────── */
const SYSTEM_PROMPT = `You are an IT Support Agent for RYCO. You help employees resolve IT issues through a two-phase approach: first try to fix it yourself, then escalate if needed.

━━━ PHASE 1 — TROUBLESHOOT ━━━
When a user first describes an IT issue:
- Acknowledge it in one sentence
- Give 1-2 specific, actionable troubleshooting steps tailored to their exact problem
- Ask them to try and report back
- End your message with: <PHASE>helping</PHASE>

If the user says it WORKED → congratulate them briefly, no ticket needed.
End with: <PHASE>resolved</PHASE>

If the user says it DIDN'T WORK → try a different approach (do NOT repeat the same suggestion).
End with: <PHASE>helping</PHASE>

After 3 failed troubleshooting attempts, OR if the user says "just create a ticket" / "escalate" / "I give up":
- Acknowledge the issue persists, tell them you'll escalate to the IT team
- Ask for their work email address
- End with: <PHASE>asking_email</PHASE>

━━━ PHASE 2 — ESCALATE ━━━
Once you have a valid email address:
- Confirm you have it
- Ask how urgent this is, listing these three options on separate lines:
  🔴 High — need it resolved immediately
  🟡 Medium — within the next hour
  🟢 Low — today works
- End with: <PHASE>asking_urgency</PHASE>

Once the user selects or states their urgency (High / Medium / Low):
- Confirm you're creating the ticket
- End your message with <PHASE>creating_ticket</PHASE> immediately followed by the <TICKET_DATA> block

━━━ RULES ━━━
- Keep every response under 80 words
- Be specific with troubleshooting — tailor steps to what the user actually said
- Never suggest the same fix twice
- Never ask for email before troubleshooting has failed (unless user explicitly asks to skip)
- Always end every response with exactly one <PHASE> tag
- The <PHASE> and <TICKET_DATA> tags are stripped before the user sees them

━━━ PRIVACY ━━━
Email addresses are replaced with [REDACTED_EMAIL] before reaching you. Treat it as a valid confirmed email. Use [REDACTED_EMAIL] in the ticket JSON — the server restores the real address.

━━━ CATEGORY / TEAM / SLA ━━━
- Network / VPN → VPN, WiFi, internet, connectivity → Network Operations → 30 minutes
- Access / Permissions → password, locked out, MFA, account, permissions → Identity & Access → 30 minutes
- Hardware → laptop, monitor, keyboard, mouse, printer → Hardware Support → 2 hours
- Software / M365 → Outlook, Teams, Office, M365, SharePoint → Software Support → 1 hour
- Software → app, crash, install, update, error, slow → Software Support → 1 hour
- General → anything else → IT Support → 2 hours

━━━ TICKET DATA FORMAT ━━━
<TICKET_DATA>
{
  "email": "[REDACTED_EMAIL]",
  "issue_summary": "one-line title",
  "details": "full description including what troubleshooting was already attempted",
  "urgency": "High|Medium|Low",
  "category": "Network / VPN|Access / Permissions|Hardware|Software / M365|Software|General"
}
</TICKET_DATA>`;

/* ── Email template ──────────────────────────────────── */
function buildEmail(ticket) {
  const { team, sla } = TEAM_MAP[ticket.category] ?? TEAM_MAP.General;
  const priColor = ticket.urgency === 'High' ? '#ef4444' : ticket.urgency === 'Medium' ? '#f59e0b' : '#22c55e';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto">
    <tr><td style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #1e3a5f">
      <!-- Header -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="background:#1a2744;padding:24px 28px;border-bottom:1px solid #1e3a5f">
          <span style="font-size:22px">🤖</span>
          <span style="color:#e2e8f0;font-size:16px;font-weight:700;margin-left:10px;vertical-align:middle">IT Support Agent</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px">
          <p style="color:#94a3b8;font-size:14px;margin:0 0 6px">Your ticket has been created</p>
          <h1 style="color:#e2e8f0;font-size:22px;margin:0 0 24px">${ticket.ticket_id}</h1>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1e3a5f;border-radius:8px;overflow:hidden">
            ${row('Issue', ticket.issue_summary)}
            ${row('Priority', `<span style="color:${priColor};font-weight:600">${ticket.urgency}</span>`)}
            ${row('Category', ticket.category)}
            ${row('Assigned Team', team)}
            ${row('SLA', `Response within ${sla}`)}
            ${row('Status', '<span style="color:#22c55e;font-weight:600">Open</span>')}
          </table>
          <p style="color:#64748b;font-size:13px;margin:20px 0 0">The ${team} team has been notified and will be in touch shortly.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 28px;border-top:1px solid #1e3a5f;background:#0f172a">
          <p style="color:#475569;font-size:12px;margin:0">This is an automated message from the RYCO IT Support Agent demo. Reference: ${ticket.ticket_id}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function row(label, value) {
  return `<tr style="border-bottom:1px solid #1e3a5f">
    <td style="padding:10px 14px;color:#64748b;font-size:13px;width:130px;background:#0f1f35">${label}</td>
    <td style="padding:10px 14px;color:#e2e8f0;font-size:13px">${value}</td>
  </tr>`;
}

/* ── Main handler ────────────────────────────────────── */
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, sessionId, userEmail } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  /* ── Redact PII before sending to Groq ── */
  const redactedMessages = redactPII(messages);

  /* ── Call Groq (receives no raw emails or phone numbers) ── */
  let rawText;
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...redactedMessages,
      ],
    });
    rawText = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    console.error('Groq error:', err.message);
    return res.status(502).json({ error: 'AI service unavailable. Please try again.' });
  }

  /* ── Parse phase tag ── */
  const phaseMatch  = rawText.match(/<PHASE>([\s\S]*?)<\/PHASE>/);
  const phase       = phaseMatch ? phaseMatch[1].trim() : 'helping';

  /* ── Parse ticket block ── */
  const ticketMatch = rawText.match(/<TICKET_DATA>([\s\S]*?)<\/TICKET_DATA>/);
  const cleanMessage = rawText
    .replace(/<PHASE>[\s\S]*?<\/PHASE>/, '')
    .replace(/<TICKET_DATA>[\s\S]*?<\/TICKET_DATA>/, '')
    .trim();

  let ticket = null;

  if (ticketMatch) {
    try {
      const parsed = JSON.parse(ticketMatch[1].trim());
      const { team, sla } = TEAM_MAP[parsed.category] ?? TEAM_MAP.General;

      /* Restore the real email — Groq only ever saw [REDACTED_EMAIL] */
      const resolvedEmail = userEmail ?? parsed.email;

      ticket = {
        ticket_id:     genTicketId(),
        email:         resolvedEmail,
        issue_summary: parsed.issue_summary,
        details:       parsed.details,
        urgency:       parsed.urgency,
        category:      parsed.category,
        assigned_team: team,
        sla,
        session_id:    sessionId ?? null,
        status:        'Open',
      };

      /* ── Write to Supabase ── */
      if (supabase) {
        const { error } = await supabase.from('tickets').insert(ticket);
        if (error) console.error('Supabase insert error:', error.message);
      }

      /* ── Send confirmation email via Resend ── */
      if (resend) {
        await resend.emails.send({
          from:    process.env.FROM_EMAIL ?? 'onboarding@resend.dev',
          to:      ticket.email,
          subject: `IT Support Ticket Created — ${ticket.ticket_id}`,
          html:    buildEmail(ticket),
        }).catch(err => console.error('Resend error:', err.message));
      }

    } catch (parseErr) {
      console.error('Ticket parse error:', parseErr.message, ticketMatch[1]);
    }
  }

  return res.status(200).json({ message: cleanMessage, phase, ticket });
};
