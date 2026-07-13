// Vercel serverless function: Claude-powered chat for Study Mode.
// Takes the current question as context + conversation history, returns AI reply.
//
// Required environment variable (set in Vercel Project Settings → Environment Variables):
//   ANTHROPIC_API_KEY   — get one free at https://console.anthropic.com

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question, options, correctAnswer, explanation, topic, isAnswered, messages } = req.body || {};
  if (!question || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const keys = ['A', 'B', 'C', 'D'];
  const optionsText = (options || [])
    .map((o, i) => `${keys[i]}. ${o}`)
    .join('\n');

  // If the student has already answered, include the correct answer + explanation.
  // If not yet answered, Claude will help them reason through it without spoiling.
  const answerBlock = isAnswered
    ? `\nCORRECT ANSWER: ${keys[correctAnswer]}. ${(options || [])[correctAnswer]}${explanation ? `\nEXPLANATION: ${explanation}` : ''}`
    : `\n(The student has not yet answered this question — do NOT reveal the correct answer. Help them think through it instead.)`;

  const systemPrompt = `You are a knowledgeable and friendly study assistant for the Kerala PSC Child Development Project Officer (CDPO) exam. A student is studying a question from the "${topic}" topic.

QUESTION:
${question}

OPTIONS:
${optionsText}
${answerBlock}

Your role:
- Help the student understand the underlying concepts deeply.
- Give clear explanations, real-world examples, and mnemonics where helpful.
- Relate content to the CDPO exam context (child welfare, Kerala PSC syllabus).
- Keep responses concise — 3–6 sentences unless the student asks for more detail.
- If asked about something unrelated to this question or CDPO exam topics, politely redirect.
- Write in plain text (no markdown headers or bullet symbols — just clear prose).`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: messages.slice(-12), // keep last 12 turns to avoid token overflow
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', errText);
      return res.status(502).json({ error: 'AI API error', detail: errText });
    }

    const data = await anthropicRes.json();
    const reply = data.content && data.content[0] && data.content[0].text;
    if (!reply) return res.status(502).json({ error: 'Empty response from AI' });

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({ error: err.message });
  }
};
