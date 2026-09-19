import { config } from './config.js';

const STICKER_SYSTEM_INSTRUCTION = `You are an expert sticker art prompt engineer for AI image generators.
Your job is to convert the user's sticker idea into a detailed, high-quality image generation prompt.

Follow these strict rules:
1. BACKGROUND: Always specify "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject". This is critical because the background will be removed automatically.
2. ART STYLE: Specify "die-cut sticker art style, bold clean contours, sharp vector illustration, vibrant saturated colors, studio lighting, highly detailed".
3. COMPOSITION: Centered subject, clear silhouette, completely framed within the canvas, no parts cut off at edges.
4. CHARACTER & GAME/IP SAFETY: AI image generators strictly block prompts containing trademarked game names, brand names, or phrases like "from the video game X", "game character", or studio names.
   - When the user asks for a character from any video game, anime, movie, or series (e.g., Mario, Sonic, Peak, Pokémon, etc.):
     NEVER mention the name of the game, franchise, studio, or the words "video game / game character".
     INSTEAD, immediately describe the character's VISUAL APPEARANCE in rich physical detail (clothing, color palette, distinctive equipment/gear, posture, facial expression, species/creature features).
     For generic or indie references (like "juego peak"): depict an adorable stylized mountaineer adventurer character with cozy climbing winter gear, beanie, and hiking equipment.
5. CONTENT FILTER COMPLIANCE: Use strictly neutral, family-friendly, descriptive language. Avoid ambiguous words that could trigger false-positive AI safety/moderation filters.
6. TEXT: Do NOT include text, captions, or words in the image unless the user explicitly asks for words.
7. OUTPUT: Output ONLY the enhanced prompt in plain text. Do NOT add preamble, quotes, explanations, or markdown formatting. Keep it concise (under 80 words).`;

const MEME_SYSTEM_INSTRUCTION = `You are an expert prompt engineer for cursed and hilarious internet meme photos.
Your job is to convert the user's idea into a prompt for a realistic, funny reaction meme photo, like iconic viral low-quality internet animal/reaction memes (e.g. funny flexing cat, bewildered dog, awkward candid expressions).

Follow these strict rules:
1. PHOTOGRAPHY STYLE: Specify "funny internet reaction meme, amateur candid flash photography, grainy 2000s flip phone photo, slightly blurry motion, low-res camera aesthetic, cursed funny photo, realistic authentic fur/skin texture, hilarious awkward expression".
2. ABSOLUTELY NO STICKER/CARTOON ELEMENTS: Do NOT mention "sticker", "die-cut", "border", "white outline", "vector", "drawing", "illustration", or "cartoon". It MUST look like a real photograph of a real creature/subject with a funny, expressive face or goofy posture.
3. BACKGROUND: Always specify "isolated on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor". This is required for automatic cutout.
4. COMPOSITION: Centered subject with an exaggerated funny pose or facial expression.
5. CHARACTER & GAME/IP SAFETY: Never mention game titles, brand names, or "from the video game X". If a character/game is requested, describe the physical costume, creature type, and distinctive features realistically.
6. CONTENT FILTER COMPLIANCE: Keep vocabulary strictly PG and neutral to avoid triggering automated safety filters.
7. TEXT: Do NOT include text, captions, meme subtitles, or watermarks.
8. OUTPUT: Output ONLY the enhanced prompt in plain text. Do NOT add preamble, quotes, explanations, or markdown formatting. Keep it concise (under 80 words).`;

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

export async function sanitizePrompt(blockedPrompt, mode = 'sticker') {
  const url = config.cloudflare.geminiGatewayUrl;
  const isMeme = mode === 'meme';

  const systemInstruction = `You are an expert prompt sanitization engineer for AI image generators.
An image generation prompt was blocked by an AI safety or copyright/trademark filter.
Your task is to rewrite the prompt so it 100% passes all automated safety, copyright, and moderation filters, while preserving the user's visual intent.

Strict rules:
1. Completely remove any game titles, movie titles, brand names, franchise names, or phrases like "from the video game...", "game character".
2. Replace them with pure physical and visual descriptions (clothing, colors, distinctive equipment/gear, creature archetype, pose, expression).
3. Ensure all vocabulary is strictly safe, neutral, and family-friendly, avoiding any ambiguous words that could trigger false-positive safety flags.
4. Maintain the background requirement: "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject".
${isMeme ? '5. Maintain the meme aesthetic: amateur candid flash photography, funny expression, no cartoon/vector keywords.' : '5. Maintain the sticker art style: die-cut sticker art style, bold clean contours, sharp vector illustration.'}
6. Output ONLY the sanitized prompt in plain text without quotes, preamble, or markdown. Keep it under 75 words.`;

  const userText = `This prompt was blocked by an AI safety/copyright filter: "${blockedPrompt}". Rewrite and sanitize it with pure visual descriptions so it passes all filters safely.`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.6,
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
    throw new Error(`Gemini Sanitize API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const sanitized = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!sanitized) {
    throw new Error('Gemini returned an empty sanitized prompt.');
  }

  return sanitized;
}

export function enhanceStickerPrompt(userPrompt) {
  return enhancePrompt(userPrompt, 'sticker');
}

export function enhanceMemePrompt(userPrompt) {
  return enhancePrompt(userPrompt, 'meme');
}
