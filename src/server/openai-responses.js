// OpenAI Responses API client (async background generation)

import { DEFAULT_OPENAI_MODEL } from '../shared/defaults.js';

const BASE_URL = 'https://api.openai.com/v1/responses';

export async function createResponse(apiKey, prompt, model = DEFAULT_OPENAI_MODEL) {
  const resp = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      instructions: 'You are a game developer AI that creates canvas-command games. Respond with a single JavaScript code block containing metadata(), resources(), and update() functions.',
      max_output_tokens: 24000,
      background: true,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI Responses API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return { id: data.id, status: data.status };
}

export async function getResponse(apiKey, responseId) {
  const resp = await fetch(`${BASE_URL}/${responseId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI status check failed ${resp.status}: ${err}`);
  }

  const data = await resp.json();

  if (data.status === 'completed' || data.status === 'complete') {
    const messageItem = data.output?.find(item => item.type === 'message');
    const text = messageItem?.content?.[0]?.text;
    if (text) {
      return { status: 'completed', text };
    }
    return { status: 'failed', error: 'No text in completed response' };
  }

  if (data.status === 'failed') {
    const err = data.error;
    const errorMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err) || 'Unknown error';
    return { status: 'failed', error: errorMsg };
  }

  if (data.status === 'cancelled') {
    return { status: 'failed', error: 'Response was cancelled' };
  }

  if (data.status === 'incomplete') {
    return { status: 'failed', error: `Incomplete: ${data.incomplete_details?.reason || 'unknown'}` };
  }

  // queued or in_progress
  return { status: data.status };
}
