import { config } from './config.js';

export async function generateImage(prompt, inputImageBuffer = null) {
  const url = config.cloudflare.fluxUrl;

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('width', '512');
  formData.append('height', '512');

  if (inputImageBuffer) {
    formData.append(
      'input_image_0',
      new Blob([inputImageBuffer], { type: 'image/jpeg' }),
      'input.jpg'
    );
  }

  const headers = {
    'Authorization': `Bearer ${config.cloudflare.apiToken}`
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Workers AI FLUX error (${response.status}): ${errorText}`;
    let isSafetyBlocked = false;
    let isQuotaExhausted = false;

    try {
      const errJson = JSON.parse(errorText);
      if (errJson.errors && errJson.errors.length > 0) {
        const firstErr = errJson.errors[0];
        if (firstErr.code === 3030) {
          errorMessage = 'The image request was blocked by Cloudflare AI safety/content filters. Please try a different description.';
          isSafetyBlocked = true;
        } else if (firstErr.code === 4006) {
          errorMessage = 'Daily Cloudflare Workers AI neuron quota exhausted. Resets at 00:00 UTC.';
          isQuotaExhausted = true;
        } else {
          errorMessage = `Workers AI error (${firstErr.code}): ${firstErr.message}`;
        }
      }
    } catch {
      // not json, use fallback message
    }

    const err = new Error(errorMessage);
    err.isSafetyBlocked = isSafetyBlocked;
    err.isQuotaExhausted = isQuotaExhausted;
    throw err;
  }

  // Handle both JSON (Base64) and raw binary image streams
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!data.success && data.errors && data.errors.length > 0) {
      throw new Error(`Workers AI returned failure: ${data.errors[0].message}`);
    }
    const base64Image = data?.result?.image;
    if (!base64Image) {
      throw new Error('Workers AI returned no image in response.');
    }
    return Buffer.from(base64Image, 'base64');
  } else {
    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}
