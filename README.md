# RYCO AI Support Agent — Public Demo

> A full-stack public showcase of an AI-powered IT support agent built to replicate the architecture I designed using **Microsoft Copilot Studio** and **Power Automate** in a previous role.
> All proprietary data, internal endpoints, and company-specific configuration have been removed.

**Live demo:** [ryco-ai-support-demo.vercel.app](https://ryco-ai-support-demo.vercel.app/)

---

## What This Demonstrates

| Real product (confidential) | This demo |
|---|---|
| Microsoft Copilot Studio | Groq API (`llama-3.3-70b-versatile`) — NLU + conversation |
| Power Automate cloud flow | Vercel serverless function (`api/chat.js`) |
| Dataverse table | Supabase PostgreSQL (`tickets` table) |
| Office 365 Outlook connector | Resend — real HTML confirmation email |
| Teams deployment | Static HTML site deployed on Vercel |

---

## Demo Pages

| Page | What it shows |
|---|---|
| [Overview](index.html) | Problem, solution, impact metrics, tech stack |
| [Interactive Demo](demo.html) | Real AI conversation → real ticket → real email |
| [Architecture](architecture.html) | SVG system diagram + component breakdown |

---

## How It Works

```
User types IT issue in the chat
          │
          ▼
  POST /api/chat
  { messages: [...], sessionId }
          │
          ▼
  Groq API (llama-3.3-70b-versatile)
  System prompt guides:
    1. Greet + ask for email
    2. Ask for more details
    3. Ask for urgency level
    4. Emit <TICKET_DATA> JSON block
          │
   <TICKET_DATA> detected
          │
     ┌────┴────┐
     ▼          ▼
  Supabase    Resend
  INSERT      Send HTML
  ticket row  email to user
     │
     └──► Return ticket to frontend
              │
              ▼
       Flow animation plays
       Ticket card renders
       Live table refreshes
```

PII (emails, phone numbers) is redacted from the conversation before it is sent to Groq, and restored locally when building the ticket record.

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your keys
cp .env.example .env

# 3. Run locally (Vercel CLI serves both static files and API routes)
npx vercel dev
```

> **Do not use `npx serve .` for local dev** — that serves only static files and the `fetch('/api/chat')` calls will 404. Use `vercel dev` so the serverless functions run locally too.

---

## Environment Variables

| Variable | Where to get it |
|---|---|
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) (free, no credit card) |
| `SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase project → Settings → API → `service_role` key |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) |
| `FROM_EMAIL` | A domain you've verified in Resend, e.g. `IT Support <it@yourdomain.com>` |

> For testing email without a verified domain, set `FROM_EMAIL=onboarding@resend.dev` — Resend's sandbox address. It only delivers to your own Resend-verified email.

---

## Supabase Schema

Run this once in your Supabase project's SQL editor:

```sql
create table if not exists public.tickets (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        text not null,
  created_at       timestamptz not null default now(),
  requestor_email  text not null,
  requestor_name   text not null,
  issue_summary    text not null,
  issue_detail     text,
  category         text not null,
  assigned_team    text not null,
  priority         text not null check (priority in ('High', 'Medium', 'Low')),
  sla              text not null,
  description      text,
  status           text not null default 'Open',
  resolved         boolean not null default false,
  resolution_time  text
);

create index if not exists tickets_created_at_idx
  on public.tickets (created_at desc);
```

---

## Deploy to Vercel

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Deploy (first time — follow the prompts)
vercel

# 3. Add environment variables in the Vercel dashboard:
#    Project → Settings → Environment Variables
#    Add all five variables from .env.example

# 4. Redeploy to pick up the env vars
vercel --prod
```

Vercel automatically detects:
- `api/*.js` → serverless functions at `/api/*`
- `*.html`, `css/`, `js/`, `data/` → static files served from root

No build step required.

The live demo above is deployed this way from the `master` branch.

---

## Project Structure

```
├── index.html               Landing page
├── demo.html                Interactive chat demo
├── architecture.html        System architecture diagram
├── css/styles.css           Stylesheet
├── js/demo.js               Frontend — sends messages to /api/chat
├── data/sample-tickets.json Reference data (not used by live table)
├── api/
│   ├── chat.js              POST /api/chat — Groq + Supabase + Resend
│   └── tickets.js           GET  /api/tickets — live ticket list
├── report/                  Written project report (LaTeX/PDF)
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

---

## What the Real Product Used (vs This Demo)

| Capability | Real product | This demo |
|---|---|---|
| NLU / conversation | Copilot Studio topics + slot filling | Groq-hosted Llama system prompt |
| Backend flow | Power Automate cloud flow | Vercel serverless function |
| Ticket storage | Dataverse custom table | Supabase PostgreSQL |
| Email | Office 365 Outlook connector | Resend |
| Routing logic | Power Automate conditions | Category keyword map in `api/chat.js` |
| Channel | Microsoft Teams app | Browser (static HTML) |
| Authentication | Azure AD | None (public demo) |

---

## Disclaimer

This is a **public demo** repository. It does not contain:
- Any real user data, names, or emails from any organisation
- Internal API endpoints, credentials, or secrets
- Proprietary business logic or company-specific configuration
- Any code or assets belonging to a former employer

The "Representative Impact" metrics on the [overview page](index.html) are illustrative figures based on typical outcomes for this type of automation, explicitly labelled as such on the page — they are not measured results from any real deployment.

The architecture and automation patterns shown here are reconstructed from scratch to demonstrate my skills and experience.
