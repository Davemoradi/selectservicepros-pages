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

  const { answers, questionCount, maxQuestions, category } = await req.json();
  const remaining = (maxQuestions || 5) - (questionCount || 0);
  const serviceCat = category || 'General Home Services';
  const conversationSoFar = (answers || []).map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");

  const prompt = `You are an AI intake agent for SelectServicePros, a Houston home services lead platform covering HVAC, plumbing, electrical, roofing, handyman, appliance repair, remodeling, painting, pool & spa, and windows & doors.

The customer selected category: ${serviceCat}

Conversation so far:
${conversationSoFar}

Questions remaining: ${remaining}

Rules:
- Ask ONE question that helps qualify this ${serviceCat} lead
- Be specific to the ${serviceCat} category
- Give 2-5 multiple choice options when possible
- Always include "Other" as the last option so customers can describe unique situations
- If the customer previously answered "Other: [description]", use that context to ask a more targeted follow-up
- If remaining=1, ask about budget/timeline
- Never ask for contact info
- Keep questions conversational and helpful, not interrogative

Respond ONLY with valid JSON:
{"question":"...","type":"options","options":["...","...","...","Other"]}`;

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
  const text = data.content?.[0]?.text || '{"question":"What is your budget range for this project?","type":"options","options":["Under $500","$500-$2,000","$2,000-$5,000","$5,000+","Other"]}';
  const clean = text.replace(/```json|```/g, "").trim();

  return new Response(clean, {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
