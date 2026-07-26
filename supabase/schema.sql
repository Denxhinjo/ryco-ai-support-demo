-- RYCO AI Support Agent — Supabase schema
-- Paste this into: Supabase Dashboard → SQL Editor → New query → Run

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
