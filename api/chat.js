// Vercel serverless function for the Study Mode AI assistant.
// Provider order: OpenAI (when configured), then NVIDIA with one retry.
// Required: OPENAI_API_KEY and/or NVIDIA_API_KEY. Keep both server-side only.

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

function extractOpenAIReply(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) return part.text;
    }
  }
  return null;
}

async function callOpenAI({ apiKey, model, systemPrompt, messages }) {
  const startedAt = Date.now();
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: messages,
      max_output_tokens: 400,
      store: false
    })
  });
  const requestId = response.headers?.get?.('x-request-id') || null;
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`OpenAI returned ${response.status}`);
    error.context = { provider: 'openai', model, status: response.status, requestId, detail: detail.slice(0, 1000) };
    throw error;
  }
  const reply = extractOpenAIReply(await response.json());
  if (!reply) {
    const error = new Error('OpenAI returned an empty response');
    error.context = { provider: 'openai', model, requestId };
    throw error;
  }
  console.log('[api/chat] provider success', { provider: 'openai', model, requestId, durationMs: Date.now() - startedAt });
  return reply;
}

async function callNvidia({ apiKey, model, chatMessages, attempt }) {
  const startedAt = Date.now();
  const response = await fetch(NVIDIA_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model,
      messages: chatMessages,
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 400,
      chat_template_kwargs: { enable_thinking: false },
      stream: false
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`NVIDIA returned ${response.status}`);
    error.context = { provider: 'nvidia', model, attempt, status: response.status, detail: detail.slice(0, 1000) };
    throw error;
  }
  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) {
    const error = new Error('NVIDIA returned an empty response');
    error.context = { provider: 'nvidia', model, attempt };
    throw error;
  }
  console.log('[api/chat] provider success', { provider: 'nvidia', model, attempt, durationMs: Date.now() - startedAt });
  return reply;
}

function logProviderFailure(error) {
  console.error('[api/chat] provider failed', { ...(error.context || {}), error: error.message });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const openAIKey = process.env.OPENAI_API_KEY;
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  if (!openAIKey && !nvidiaKey) return res.status(500).json({ error: 'No AI provider is configured.' });

  const { question, options, correctAnswer, explanation, topic, isAnswered, messages } = req.body || {};
  if (!question || !Array.isArray(messages)) return res.status(400).json({ error: 'Missing required fields' });

  const keys = ['A', 'B', 'C', 'D'];
  const optionsText = (options || []).map((option, index) => `${keys[index]}. ${option}`).join('\n');
  const answerBlock = isAnswered
    ? `\nCORRECT ANSWER: ${keys[correctAnswer]}. ${(options || [])[correctAnswer]}${explanation ? `\nEXPLANATION: ${explanation}` : ''}`
    : '\n(The student has NOT yet answered — do NOT reveal the correct answer. Help them think through it instead.)';

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

  const conversation = messages.slice(-12).map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content
  }));
  const chatMessages = [{ role: 'system', content: systemPrompt }, ...conversation];

  if (openAIKey) {
    // A small non-reasoning model responds quickly to short study questions.
    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini';
    try {
      const reply = await callOpenAI({ apiKey: openAIKey, model, systemPrompt, messages: conversation });
      return res.status(200).json({ reply, provider: 'openai' });
    } catch (error) {
      logProviderFailure(error);
    }
  }

  if (nvidiaKey) {
    const model = process.env.NVIDIA_CHAT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const reply = await callNvidia({ apiKey: nvidiaKey, model, chatMessages, attempt });
        return res.status(200).json({ reply, provider: 'nvidia' });
      } catch (error) {
        logProviderFailure(error);
      }
    }
  }

  return res.status(502).json({ error: 'All AI providers are temporarily unavailable. Please try again.' });
};
