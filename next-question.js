export const config = { runtime: 'edge' };

const MAX_QUESTIONS = 5;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { category, history, stepNum } = await req.json();

    // HARD CAP: If we've asked enough questions, go straight to contact
    if (stepNum >= MAX_QUESTIONS || (history && history.length >= MAX_QUESTIONS)) {
      return new Response(JSON.stringify({ type: 'contact' }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      // No API key — return fallback questions
      return new Response(JSON.stringify(getFallbackQuestion(category, stepNum, history)), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const historyText = (history || [])
      .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`)
      .join('\n');

    const questionsRemaining = MAX_QUESTIONS - (history ? history.length : 0);

    const prompt = `You are a smart intake assistant for a home services lead generation platform called SelectServicePros. The homeowner is requesting help in the "${category}" category.

Here is the conversation so far:
${historyText || '(No questions asked yet)'}

You have ${questionsRemaining} question(s) remaining before the form asks for contact info. ${questionsRemaining <= 1 ? 'This is your LAST question — make it count (budget or timeline).' : ''}

Generate the next SINGLE qualifying question to help match them with the right contractor. Focus on:
- What specific service they need (if not yet clear)
- Urgency/timeline
- Budget range (ask this on the last question)
- Property type or scope of work

IMPORTANT RULES:
- Do NOT repeat any question already asked.
- Do NOT ask more than one question.
- Keep the question short and clear.
- If ${questionsRemaining} <= 0, respond with ONLY: {"type":"contact"}

Respond in JSON only. No markdown, no backticks, no explanation. Use one of these formats:

For a multiple-choice question:
{"type":"options","question":"Your question here?","options":["Option 1","Option 2","Option 3","Option 4"]}

For a text input question:
{"type":"text","question":"Your question here?","placeholder":"e.g. example answer"}

For the contact form (when done):
{"type":"contact"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      // API error — use fallback
      return new Response(JSON.stringify(getFallbackQuestion(category, stepNum, history)), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const data = await response.json();
    const text = data.content[0].text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Parse error — use fallback
      return new Response(JSON.stringify(getFallbackQuestion(category, stepNum, history)), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Double-check: if AI returns contact type, honor it
    // Also enforce the cap one more time
    if (parsed.type === 'contact' || stepNum >= MAX_QUESTIONS - 1) {
      // If this was the last allowed question, let it through but next will be contact
      if (parsed.type !== 'contact' && stepNum < MAX_QUESTIONS) {
        // It's a valid question and we haven't hit the cap yet
      } else {
        parsed = { type: 'contact' };
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({
      type: 'text',
      question: 'Can you describe what you need help with?',
      placeholder: 'e.g. My AC stopped cooling'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

// Fallback questions when API is unavailable
function getFallbackQuestion(category, stepNum, history) {
  const asked = (history || []).map(h => h.question.toLowerCase());
  const step = stepNum || 0;

  const fallbacks = {
    'HVAC': [
      { type: 'options', question: 'What type of HVAC service do you need?', options: ['AC repair', 'Heating repair', 'New installation', 'Maintenance/tune-up'] },
      { type: 'options', question: 'How urgent is this?', options: ['Emergency — today', 'Within a few days', 'This week', 'Just planning ahead'] },
      { type: 'options', question: 'What type of property is this for?', options: ['Single-family home', 'Apartment/condo', 'Townhouse', 'Commercial'] },
      { type: 'options', question: 'How old is your current system?', options: ['Less than 5 years', '5–10 years', '10–15 years', '15+ years or unknown'] },
      { type: 'options', question: 'What is your budget range?', options: ['Under $500', '$500–$2,000', '$2,000–$5,000', '$5,000+'] },
    ],
    'Plumbing': [
      { type: 'options', question: 'What type of plumbing service do you need?', options: ['Leak repair', 'Drain cleaning', 'Water heater', 'Fixture install', 'Sewer/main line'] },
      { type: 'options', question: 'How urgent is this?', options: ['Emergency — today', 'Within a few days', 'This week', 'Just planning ahead'] },
      { type: 'options', question: 'Where is the issue?', options: ['Kitchen', 'Bathroom', 'Basement/utility', 'Outdoor/main line'] },
      { type: 'options', question: 'What type of property is this for?', options: ['Single-family home', 'Apartment/condo', 'Townhouse', 'Commercial'] },
      { type: 'options', question: 'What is your budget range?', options: ['Under $300', '$300–$1,000', '$1,000–$3,000', '$3,000+'] },
    ],
    'Electrical': [
      { type: 'options', question: 'What type of electrical work do you need?', options: ['Outlet/switch issue', 'Panel/breaker', 'Wiring', 'Lighting install', 'Generator'] },
      { type: 'options', question: 'How urgent is this?', options: ['Emergency — today', 'Within a few days', 'This week', 'Just planning ahead'] },
      { type: 'options', question: 'What type of property is this for?', options: ['Single-family home', 'Apartment/condo', 'Townhouse', 'Commercial'] },
      { type: 'options', question: 'How old is your electrical panel?', options: ['Less than 10 years', '10–25 years', '25+ years', 'Not sure'] },
      { type: 'options', question: 'What is your budget range?', options: ['Under $300', '$300–$1,000', '$1,000–$3,000', '$3,000+'] },
    ],
  };

  // Default fallback for unknown categories
  const defaultFallbacks = [
    { type: 'text', question: 'What service do you need help with?', placeholder: 'e.g. My AC stopped working' },
    { type: 'options', question: 'How urgent is this?', options: ['Emergency — today', 'Within a few days', 'This week', 'Just planning ahead'] },
    { type: 'options', question: 'What type of property is this for?', options: ['Single-family home', 'Apartment/condo', 'Townhouse', 'Commercial'] },
    { type: 'text', question: 'Can you describe the issue in more detail?', placeholder: 'Tell us more...' },
    { type: 'options', question: 'What is your budget range?', options: ['Under $500', '$500–$2,000', '$2,000–$5,000', '$5,000+'] },
  ];

  const questions = fallbacks[category] || defaultFallbacks;

  if (step >= questions.length) {
    return { type: 'contact' };
  }

  return questions[step];
}
