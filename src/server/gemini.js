// Gemini API client for image generation

export async function generateImage(apiKey, prompt, options = {}) {
  const { w = 256, h = 256 } = options;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `Generate a ${w}x${h} pixel game sprite/asset: ${prompt}. Simple, clean pixel art style with transparent background.` }],
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

  // Find the image part
  for (const part of parts) {
    if (part.inlineData) {
      return part.inlineData.data; // base64 image data
    }
  }
  throw new Error('No image data in Gemini response');
}
