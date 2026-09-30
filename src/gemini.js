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
Your job is to convert the user's idea into a prompt for a realistic, funny, cursed internet meme photo.

Follow these strict rules:
1. SUBJECT FIDELITY: Strictly respect the user's requested subject. Do NOT invent or add animals (such as cats, dogs, etc.) or extra characters unless the user explicitly requested them. If the user asks for an object, device, electronics, vehicle, or food (e.g. a burning PC, a broken laptop, wrecked car, ruined food), depict THAT exact subject in a hilarious, chaotic, or cursed meme situation without adding unprompted animals or people.
2. PHOTOGRAPHY STYLE: Specify "funny internet meme photo, amateur candid harsh flash photography, grainy 2000s camera phone photo, slightly blurry motion, low-res aesthetic, cursed chaotic vibe, realistic textures". If (and only if) the subject requested by the user is an animal or person, specify "hilarious awkward expression".
3. WHITE DIE-CUT STICKER OUTLINE: Specify "surrounded by a bold clean white die-cut sticker outline contour framing the entire subject and all scene props, vinyl sticker cut, sharp clean silhouette".
4. BACKGROUND: Specify "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject". The white outline acts as a clean barrier that encapsulates all elements (props, monitors, desks, accessories).
5. COMPOSITION: Centered subject, completely framed within the canvas, no parts touching or cut off by canvas edges.
6. CHARACTER & GAME/IP SAFETY: Never mention game titles, brand names, or "from the video game X". If a character/game is requested, describe the physical costume, creature type, and distinctive features realistically.
7. CONTENT FILTER COMPLIANCE: Keep vocabulary strictly PG and neutral to avoid triggering automated safety filters.
8. TEXT: Do NOT include text, captions, meme subtitles, or watermarks.
9. OUTPUT: Output ONLY the enhanced prompt in plain text. Do NOT add preamble, quotes, explanations, or markdown formatting. Keep it concise (under 80 words).`;

const STICKER_EDIT_SYSTEM_INSTRUCTION = `You are an expert sticker art prompt engineer for AI image generators.
The user is providing an input image (referenced as 'image 0') and wants to transform or edit it into a high-quality die-cut sticker.
Your job is to convert the user's idea into a detailed image generation prompt modifying image 0.

Follow these strict rules:
1. SUBJECT IDENTITY & CONSERVATIVE TRANSLATION: Faithfully preserve the core visual identity, facial features, body structure, clothing, and recognizable physical traits of the subject of image 0. Translate the user's requested modifications conservatively without unnecessarily reinventing, replacing, or distorting the subject or scene props.
2. EXPLICIT REFERENCE: Always explicitly refer to "the subject of image 0" in the prompt.
3. BACKGROUND: Always specify "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject". This is critical because the background will be removed automatically.
4. ART STYLE: Specify "die-cut sticker art style, bold clean contours, sharp vector illustration, vibrant saturated colors, studio lighting, highly detailed".
5. COMPOSITION: Centered subject, clear silhouette, completely framed within the canvas, no parts cut off at edges.
6. CHARACTER & GAME/IP SAFETY: Never mention game titles, brand names, or studio names. Describe visual features physically.
7. CONTENT FILTER COMPLIANCE: Use strictly neutral, family-friendly, descriptive language.
8. TEXT: Do NOT include text, captions, or words in the image unless explicitly requested.
9. OUTPUT: Output ONLY the enhanced prompt in plain text. Do NOT add preamble, quotes, explanations, or markdown formatting. Keep it concise (under 80 words).`;

const MEME_EDIT_SYSTEM_INSTRUCTION = `You are an expert prompt engineer for cursed and hilarious internet meme photos.
The user is providing an input image (referenced as 'image 0') and wants to transform it into a hilarious cursed meme photo.
Your job is to convert the user's idea into a prompt for a realistic, funny internet meme photo modifying image 0.

Follow these strict rules:
1. SUBJECT IDENTITY & CONSERVATIVE TRANSLATION: Faithfully preserve the recognizable identity and key physical features of the subject of image 0. Apply the requested funny or chaotic modification conservatively to the subject of image 0 without replacing the subject.
2. EXPLICIT REFERENCE: Always explicitly refer to "the subject of image 0".
3. PHOTOGRAPHY STYLE: Specify "funny internet meme photo, amateur candid harsh flash photography, grainy 2000s camera phone photo, slightly blurry motion, low-res aesthetic, cursed chaotic vibe, realistic textures".
4. WHITE DIE-CUT STICKER OUTLINE: Specify "surrounded by a bold clean white die-cut sticker outline contour framing the entire subject, vinyl sticker cut, sharp clean silhouette".
5. BACKGROUND: Specify "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject".
6. COMPOSITION: Centered subject, completely framed within the canvas, no parts cut off by canvas edges.
7. CONTENT FILTER COMPLIANCE: Keep vocabulary strictly PG and neutral.
8. TEXT: Do NOT include text, captions, meme subtitles, or watermarks.
9. OUTPUT: Output ONLY the enhanced prompt in plain text. Keep it concise (under 80 words).`;

export async function enhancePrompt(userPrompt, mode = 'sticker', options = {}) {
  const url = config.cloudflare.geminiGatewayUrl;
  const isMeme = mode === 'meme';
  const { hasReferenceImage = false, isBareCommand = false } = options;

  let systemInstruction;
  let userText;

  if (hasReferenceImage) {
    systemInstruction = isMeme ? MEME_EDIT_SYSTEM_INSTRUCTION : STICKER_EDIT_SYSTEM_INSTRUCTION;
    if (isBareCommand) {
      userText = isMeme
        ? 'Transform the subject of image 0 into a funny cursed meme photo, faithfully preserving their recognizable physical identity.'
        : 'Transform the subject of image 0 into a die-cut sticker illustration, faithfully preserving their recognizable physical identity.';
    } else {
      userText = isMeme
        ? `Transform the subject of image 0 into a funny cursed meme photo with this conservative modification: "${userPrompt}"`
        : `Transform the subject of image 0 into a sticker with this conservative modification: "${userPrompt}"`;
    }
  } else {
    systemInstruction = isMeme ? MEME_SYSTEM_INSTRUCTION : STICKER_SYSTEM_INSTRUCTION;
    userText = isMeme
      ? `Create a funny low-quality meme photo prompt for: "${userPrompt}"`
      : `Create a sticker prompt for: "${userPrompt}"`;
  }

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

export async function sanitizePrompt(blockedPrompt, mode = 'sticker', options = {}) {
  const url = config.cloudflare.geminiGatewayUrl;
  const isMeme = mode === 'meme';
  const { hasReferenceImage = false } = options;

  const systemInstruction = `You are an expert prompt sanitization engineer for AI image generators.
An image generation prompt was blocked by an AI safety or copyright/trademark filter.
Your task is to rewrite the prompt so it 100% passes all automated safety, copyright, and moderation filters, while preserving the user's visual intent.

Strict rules:
1. Completely remove any game titles, movie titles, brand names, franchise names, or phrases like "from the video game...", "game character".
2. Replace them with pure physical and visual descriptions (clothing, colors, distinctive equipment/gear, creature archetype, pose, expression).
3. Ensure all vocabulary is strictly safe, neutral, and family-friendly, avoiding any ambiguous words that could trigger false-positive safety flags.
4. Maintain the background requirement: "on a solid pure black #000000 background, completely solid black backdrop with zero gradients, zero shadows, no floor, isolated subject".
${isMeme ? '5. Maintain the meme aesthetic: amateur candid harsh flash photography, cursed chaotic meme vibe, realistic textures, no cartoon/vector keywords.' : '5. Maintain the sticker art style: die-cut sticker art style, bold clean contours, sharp vector illustration.'}
${hasReferenceImage ? '6. Explicitly preserve the reference to "the subject of image 0" and keep modifications conservative.\n7. Output ONLY the sanitized prompt in plain text without quotes, preamble, or markdown. Keep it under 75 words.' : '6. Output ONLY the sanitized prompt in plain text without quotes, preamble, or markdown. Keep it under 75 words.'}`;

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
