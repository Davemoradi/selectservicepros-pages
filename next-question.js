export const config = { runtime: 'edge' };

const FALLBACKS = [
  {"question":"How urgent is this issue?","type":"options","options":["Emergency — need help today","Within the next 1-2 days","This week","Just getting quotes"]},
  {"question":"What type of property is this?","type":"options","options":["Single-family home","Townhouse or duplex","Condo or apartment","Small business"]},
  {"question":"How old is your HVAC system?","type":"options","options":["Less than 5 years","5-10 years","10-15 years","15+ years or unknown"]},
  {"question":"What is your approximate budget?","type":"options","options":["Under $500","$500 - $2,000","$2,000 - $5,000","$5,000 or more"]}
];

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const answers = body.answers || [];
    const questionCount = body.questionCount || 0;
    const remaining = (body.maxQuestions || 5) - questionCount;

    const conversation = answers
      .map(function(a) { return 'Q: ' + a.question + '\nA: ' + a.answer; })
      .join('\n\n');

    const systemPrompt = 'You are an intake agent for SelectServicePros, a Houston home services platform. Ask smart qualifying questions about a homeowner HVAC need. Respond ONLY with valid JSON — no markdown, no explanation. Format: {"question":"...","type":"options","options":["...","..."]}';

    const userPrompt = 'Conversation so far:\n' + conversation + '\n\nQuestions remaining: ' + remaining + '\n\nGenerate the single most useful next qualifying question. Adapt to what they said. Give 2-5 multiple choice options. If remaining=1, ask about budget. Never ask for contact info. Respond with ONLY valid JSON.';

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify(FALLBACKS[Math.min(questionCount - 1, FALLBACKS.length - 1)]), { headers: corsHeaders });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      return new Response(JSON.stringify(FALLBACKS[Math.min(questionCount - 1, FALLBACKS.length - 1)]), { headers: corsHeaders });
    }

    const data = await response.json();
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    JSON.parse(clean); // validate
    return new Response(clean, { headers: corsHeaders });

  } catch (err) {
    const fallback = {"question":"How soon do you need this addressed?","type":"options","options":["As soon as possible","Within 1-2 days","This week","Just exploring options"]};
    return new Response(JSON.stringify(fallback), { status: 200, headers: corsHeaders });
  }
}
