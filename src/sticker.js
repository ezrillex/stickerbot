import sharp from 'sharp';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import { config } from './config.js';

/**
 * Removes solid dark background from an image buffer and returns a transparent PNG buffer.
 * Samples corner pixels to detect the exact background tone and applies smooth anti-aliased cutout.
 */
export async function removeDarkBackground(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const totalPixels = width * height;

  // Sample the 4 corners to estimate the actual background color
  const cornerCoords = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3]
  ];

  let sumR = 0, sumG = 0, sumB = 0;
  for (const [cx, cy] of cornerCoords) {
    const idx = (cy * width + cx) * channels;
    sumR += data[idx];
    sumG += data[idx + 1];
    sumB += data[idx + 2];
  }

  const bgR = sumR / cornerCoords.length;
  const bgG = sumG / cornerCoords.length;
  const bgB = sumB / cornerCoords.length;

  // Thresholds for distance from background color
  const lowThreshold = 22;  // Below this distance: 100% transparent
  const highThreshold = 48; // Above this distance: 100% opaque

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Euclidean distance in RGB color space from background
    const dist = Math.sqrt(
      (r - bgR) ** 2 +
      (g - bgG) ** 2 +
      (b - bgB) ** 2
    );

    if (dist <= lowThreshold) {
      data[idx + 3] = 0; // Transparent
    } else if (dist < highThreshold) {
      // Smooth alpha ramp for anti-aliasing
      const alphaFactor = (dist - lowThreshold) / (highThreshold - lowThreshold);
      data[idx + 3] = Math.round(alphaFactor * 255);
    }
  }

  return sharp(data, {
    raw: {
      width,
      height,
      channels
    }
  })
    .png()
    .toBuffer();
}

/**
 * Converts raw image buffer into a transparent WhatsApp WebP sticker with metadata.
 */
export async function createSticker(imageBuffer) {
  // Step 1: Remove background to create transparent PNG
  let transparentPng;
  try {
    transparentPng = await removeDarkBackground(imageBuffer);
  } catch (err) {
    console.warn('[Sticker] Background removal warning, using original image:', err.message);
    transparentPng = imageBuffer;
  }

  // Step 2: Format as WhatsApp WebP sticker with EXIF metadata
  const sticker = new Sticker(transparentPng, {
    pack: config.bot.stickerPack,
    author: config.bot.stickerAuthor,
    type: StickerTypes.FULL,
    categories: ['🔥', '✨', '🎨'],
    quality: 75
  });

  return sticker.toBuffer();
}
