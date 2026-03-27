export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
          return new Response(null, {
                  headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'POST',
                            'Access-Control-Allow-Headers': 'Content-Type',
                  }
          });
    }

  const { answers, questionCount, maxQuestions } = await req.json();
    const remaining = (maxQuestions || 5) - (questionCount || 0);
    const conversationSoFar = (answers || []).map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");

  const prompt = `You are an AI intake agent for SelectServicePros, a Houston HVAC lead platform. Ask the single most useful next qualifying question based on the conversation. Conversation so far:\n${conversationSoFar}\n\nQuestions remaining: ${remaining}\n\nRules: Ask ONE question. Be relevant and adaptive. Give 2-5 multiple choice options when possible. If remaining=1 ask about budget. Never ask for contact info.\n\nRespond ONLY with valid JSON:\n{"question":"...","type":"options","options":["...","...","...","..."]}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 500,
                messages: [{ role: "user", content: prompt }]
        })
  });

  const data = await response.json();
    const text = data.content?.[0]?.text || '{"question":"What is your budget range?","type":"options","options":["Under $500","$500-$2,000","$2,000-$5,000","$5,000+"]}';
    const clean = text.replace(/```json|```/g, "").trim();

  return new Response(clean, {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
