// Vercel serverless function: NVIDIA-hosted AI chat for Study Mode.
// Takes the current question as context + conversation history, returns AI reply.
//
// Required environment variable (set in Vercel Project Settings → Environment Variables):
//   NVIDIA_API_KEY   — get one at https://build.nvidia.com

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  const model = process.env.NVIDIA_CHAT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
  if (!apiKey) {
    return res.status(500).json({ error: 'NVIDIA_API_KEY not configured' });
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

  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-12).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  ];

  try {
    const apiRes = await fetch(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model,
          messages: chatMessages,
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 400,
          chat_template_kwargs: { enable_thinking: false },
          stream: false
        })
      }
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('[api/chat] NVIDIA request failed', {
        model,
        status: apiRes.status,
        detail: errText.slice(0, 1000)
      });
      return res.status(502).json({ error: 'The AI assistant is temporarily unavailable. Please try again.' });
    }

    const data = await apiRes.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      console.error('[api/chat] NVIDIA returned an empty response', { model });
      return res.status(502).json({ error: 'The AI assistant returned an empty response. Please try again.' });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('[api/chat] request failed', { model, error: err.message });
    return res.status(500).json({ error: 'The AI assistant could not be reached. Please try again.' });
  }
};
