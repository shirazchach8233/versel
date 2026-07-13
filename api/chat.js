// Vercel serverless function: Gemini-powered chat for Study Mode.
// Takes the current question as context + conversation history, returns AI reply.
//
// Required environment variable (set in Vercel Project Settings → Environment Variables):
//   GEMINI_API_KEY   — get one free at https://aistudio.google.com/app/apikey

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const { question, options, correctAnswer, explanation, topic, isAnswered, messages } = req.body || {};
  if (!question || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const keys = ['A', 'B', 'C', 'D'];
  const optionsText = (options || []).map((o, i) => `${keys[i]}. ${o}`).join('\n');

  const answerBlock = isAnswered
    ? `\nCORRECT ANSWER: ${keys[correctAnswer]}. ${(options || [])[correctAnswer]}${explanation ? `\nEXPLANATION: ${explanation}` : ''}`
    : `\n(The student has NOT yet answered — do NOT reveal the correct answer. Help them think through it instead.)`;

  const systemPrompt = `You are a friendly and knowledgeable study assistant for the Kerala PSC Child Development Project Officer (CDPO) exam. A student is studying a question from the "${topic}" topic.

QUESTION:
${question}

OPTIONS:
${optionsText}
${answerBlock}

Your role:
- Help the student understand the underlying concepts deeply.
- Give clear explanations, real-world examples, and memory aids where helpful.
- Relate content to the CDPO exam context (child welfare, Kerala PSC syllabus).
- Keep responses concise — 3 to 6 sentences unless the student asks for more detail.
- Write in plain text without bullet symbols or markdown formatting.
- If asked about something unrelated to this question or CDPO topics, politely redirect.`;

  // Gemini uses "user" / "model" roles (not "assistant")
  const contents = messages.slice(-12).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', errText);
      return res.status(502).json({ error: 'Gemini API error', detail: errText });
    }

    const data = await geminiRes.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) return res.status(502).json({ error: 'Empty response from Gemini' });

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({ error: err.message });
  }
};
