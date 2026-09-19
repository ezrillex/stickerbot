import sharp from 'sharp';
import webpmux from 'node-webpmux';
import crypto from 'crypto';
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
 * Injects WhatsApp sticker EXIF metadata (pack name, author, categories/emojis) into a WebP buffer.
 * WhatsApp requires a little-endian TIFF EXIF chunk with custom tag 0x5741 containing the sticker pack JSON.
 */
export async function addStickerExif(webpBuffer, metadata = {}) {
  const img = new webpmux.Image();
  await img.load(webpBuffer);

  const json = JSON.stringify({
    'sticker-pack-id': metadata.id || crypto.randomBytes(16).toString('hex'),
    'sticker-pack-name': metadata.pack || config.bot.stickerPack || 'Rolex AI',
    'sticker-pack-publisher': metadata.author || config.bot.stickerAuthor || 'StickerBot',
    'emojis': metadata.categories || ['🔥', '✨', '🎨']
  });

  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);
  const jsonBuffer = Buffer.from(json, 'utf-8');
  const exif = Buffer.concat([exifHeader, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);

  img.exif = exif;
  return await img.save(null);
}

/**
 * Converts raw image buffer into a transparent WhatsApp WebP sticker with metadata.
 * Processes background cutout and formats into 512x512 WebP with WhatsApp EXIF metadata.
 */
export async function createSticker(imageBuffer, metadata = {}) {
  let webpBuffer;

  try {
    // Step 1: Decode to raw RGBA buffer
    const { data, info } = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const totalPixels = width * height;

    // Step 2: Sample corner pixels to estimate background color
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

    // Step 3: Remove dark background if corners are dark (average luminance < 60)
    const isDarkBg = ((bgR + bgG + bgB) / 3) < 60;
    if (isDarkBg) {
      const lowThreshold = 22;  // Below this distance: 100% transparent
      const highThreshold = 48; // Above this distance: 100% opaque

      for (let i = 0; i < totalPixels; i++) {
        const idx = i * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const dist = Math.sqrt(
          (r - bgR) ** 2 +
          (g - bgG) ** 2 +
          (b - bgB) ** 2
        );

        if (dist <= lowThreshold) {
          data[idx + 3] = 0; // Transparent
        } else if (dist < highThreshold) {
          const alphaFactor = (dist - lowThreshold) / (highThreshold - lowThreshold);
          data[idx + 3] = Math.round(alphaFactor * 255);
        }
      }
    }

    // Step 4: Fit inside 512x512 transparent canvas and directly encode to WebP
    webpBuffer = await sharp(data, {
      raw: { width, height, channels }
    })
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 75, effort: 4 })
      .toBuffer();

  } catch (err) {
    console.warn('[Sticker] Background cutout warning, using fallback WebP conversion:', err.message);
    webpBuffer = await sharp(imageBuffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 75, effort: 4 })
      .toBuffer();
  }

  // Step 5: Format as WhatsApp WebP sticker with EXIF metadata
  return addStickerExif(webpBuffer, {
    pack: metadata.pack || config.bot.stickerPack,
    author: metadata.author || config.bot.stickerAuthor,
    categories: metadata.categories || ['🔥', '✨', '🎨'],
    ...metadata
  });
}
