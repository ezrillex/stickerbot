import { config } from './config.js';

const STICKER_SYSTEM_INSTRUCTION = `You are an expert sticker art prompt engineer for AI image generators.
Your job is to convert the user's sticker idea into a detailed, high-quality image generation prompt.

Follow these strict rules:
1. BACKGROUND: Always specify "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject". This is critical because the background will be removed automatically.
2. ART STYLE: Specify "die-cut sticker art style, bold clean contours, sharp vector illustration, vibrant saturated colors, studio lighting, highly detailed".
3. COMPOSITION: Centered subject, clear silhouette, completely framed within the canvas, no parts cut off at edges.
4. TEXT: Do NOT include text, captions, or words in the image unless the user explicitly asks for words.
5. OUTPUT: Output ONLY the enhanced prompt in plain text. Do NOT add preamble, quotes, explanations, or markdown formatting. Keep it concise (under 80 words).`;

const MEME_SYSTEM_INSTRUCTION = `You are an expert prompt engineer for cursed and hilarious internet meme photos.
Your job is to convert the user's idea into a prompt for a realistic, funny reaction meme photo, like iconic viral low-quality internet animal/reaction memes (e.g. funny flexing cat, bewildered dog, awkward candid expressions).

Follow these strict rules:
1. PHOTOGRAPHY STYLE: Specify "funny internet reaction meme, amateur candid flash photography, grainy 2000s flip phone photo, slightly blurry motion, low-res camera aesthetic, cursed funny photo, realistic authentic fur/skin texture, hilarious awkward expression".
2. ABSOLUTELY NO STICKER/CARTOON ELEMENTS: Do NOT mention "sticker", "die-cut", "border", "white outline", "vector", "drawing", "illustration", or "cartoon". It MUST look like a real photograph of a real creature/subject with a funny, expressive face or goofy posture.
3. BACKGROUND: Always specify "isolated on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor". This is required for automatic cutout.
4. COMPOSITION: Centered subject with an exaggerated funny pose or facial expression.
5. TEXT: Do NOT include text, captions, meme subtitles, or watermarks.
6. OUTPUT: Output ONLY the enhanced prompt in plain text. Do NOT add preamble, quotes, explanations, or markdown formatting. Keep it concise (under 80 words).`;

export async function enhancePrompt(userPrompt, mode = 'sticker') {
  const url = config.cloudflare.geminiGatewayUrl;
  const isMeme = mode === 'meme';
  const systemInstruction = isMeme ? MEME_SYSTEM_INSTRUCTION : STICKER_SYSTEM_INSTRUCTION;
  const userText = isMeme
    ? `Create a funny low-quality meme photo prompt for: "${userPrompt}"`
    : `Create a sticker prompt for: "${userPrompt}"`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: userText
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: systemInstruction
        }
      ]
    },
    generationConfig: {
      temperature: 0.8,
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

export function enhanceStickerPrompt(userPrompt) {
  return enhancePrompt(userPrompt, 'sticker');
}

export function enhanceMemePrompt(userPrompt) {
  return enhancePrompt(userPrompt, 'meme');
}
