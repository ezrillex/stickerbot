import { config } from './config.js';

const SYSTEM_INSTRUCTION = `You are an expert sticker art prompt engineer for AI image generators.
Your job is to convert the user's sticker idea into a detailed, high-quality image generation prompt.

Follow these strict rules:
1. BACKGROUND: Always specify "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject". This is critical because the background will be removed automatically.
2. ART STYLE: Specify "die-cut sticker art style, bold clean contours, sharp vector illustration, vibrant saturated colors, studio lighting, highly detailed".
3. COMPOSITION: Centered subject, clear silhouette, completely framed within the canvas, no parts cut off at edges.
4. TEXT: Do NOT include text, captions, or words in the image unless the user explicitly asks for words.
5. OUTPUT: Output ONLY the enhanced prompt in plain text. Do NOT add preamble, quotes, explanations, or markdown formatting. Keep it concise (under 80 words).`;

export async function enhancePrompt(userPrompt) {
  const url = config.cloudflare.geminiGatewayUrl;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Create a sticker prompt for: "${userPrompt}"`
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: SYSTEM_INSTRUCTION
        }
      ]
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 250
    }
  };

  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': config.gemini.apiKey
  };

  if (config.cloudflare.gatewayToken) {
    headers['cf-aig-authorization'] = `Bearer ${config.cloudflare.gatewayToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Gateway API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const enhanced = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!enhanced) {
    throw new Error('Gemini returned an empty response or unexpected format.');
  }

  return enhanced;
}
