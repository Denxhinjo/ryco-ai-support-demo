const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data, error } = await supabase
    .from('tickets')
    .select('ticket_id, created_at, requestor_name, category, priority, assigned_team, resolved, resolution_time')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });

  /* Shape response to match what the table renderer expects */
  const rows = (data ?? []).map(t => ({
    ticket_id:       t.ticket_id,
    date:            t.created_at.slice(0, 10),
    requestor:       t.requestor_name,
    category:        t.category,
    priority:        t.priority,
    assigned_team:   t.assigned_team,
    resolved:        t.resolved,
    resolution_time: t.resolution_time ?? null,
  }));

  return res.status(200).json(rows);
};
