// Server-side proxy for the AI Analysis card in the dashboard's Insights tab.
// Keeps ANTHROPIC_API_KEY off the browser — set it via `vercel env add ANTHROPIC_API_KEY`.
const SYSTEM_PROMPT = "You are a productivity analyst for a Hong Kong-based freelancer named Anna. She works across multiple clients including CK, Drip Music, Lawrence, Sony, Cbeauty, Momo, ISNHK, Minizine, Interlude, Sam, and others. Analyse her task data and write a short, direct productivity report in 3-4 sentences maximum. Cover: (1) overall completion performance this week, (2) which client or task type is taking most of her time, (3) any concerning patterns such as overdue tasks or tasks sitting untouched for many days, (4) one specific actionable recommendation for what she should tackle first. Be direct and specific — name actual task names and clients. Do not use bullet points. Write in plain prose. Do not be encouraging or motivational. Facts and recommendations only.";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { tasks, today } = req.body || {};
  if (!Array.isArray(tasks)) return res.status(400).json({ error: 'missing tasks' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Today's date: ${today}\n\nTasks (JSON):\n${JSON.stringify(tasks)}` }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Anthropic API error', resp.status, errText);
      return res.status(502).json({ error: 'Anthropic API error' });
    }
    const data = await resp.json();
    const text = (data.content || []).map(b => b.text || '').join('').trim();
    return res.status(200).json({ text });
  } catch (e) {
    console.error('ai-insights failed', e);
    return res.status(500).json({ error: 'request failed' });
  }
};
