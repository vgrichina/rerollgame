// Gemini API client for image generation (Nano Banana)

export async function generateImage(apiKey, prompt, options = {}) {
  const { w = 256, h = 256 } = options;
  const model = 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `Generate a ${w}x${h} pixel game sprite/asset: ${prompt}. Pixel art style, flat colors, hard edges, no glow, no gradients.\n[BACKGROUND]: solid flat uniform #FF00FF background.\nDo NOT use #FF00FF or similar colors on the subject.` }],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini image API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error('Gemini image returned empty response');

  // Find the image part (API uses snake_case: inline_data)
  for (const part of parts) {
    const img = part.inlineData || part.inline_data;
    if (img) {
      const mimeType = img.mimeType || img.mime_type || 'image/png';
      return { data: img.data, mimeType }; // base64 image data + mime type
    }
  }
  throw new Error('No image data in Gemini response');
}
