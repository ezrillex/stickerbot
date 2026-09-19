import sharp from 'sharp';
import webpmux from 'node-webpmux';
import crypto from 'crypto';
import { config } from './config.js';

/**
 * Performs a boundary-connected flood fill (BFS) to remove ONLY the outer dark background
 * touching the canvas edges, keeping all internal dark features (eyes, pupils, clothes, coffee, shadows)
 * 100% solid and opaque.
 */
export function applyFloodFillCutout(data, width, height, channels, bgR, bgG, bgB) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let head = 0, tail = 0;

  const lowThreshold = 22;  // Maximum distance from bg color to consider outer background
  const highThreshold = 48; // Edge anti-aliasing feathering threshold

  // Step 1: Seed queue with matching background pixels along all 4 canvas borders
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const pIdx = y * width + x;
      if (!visited[pIdx]) {
        const idx = pIdx * channels;
        const dist = Math.sqrt(
          (data[idx] - bgR) ** 2 +
          (data[idx + 1] - bgG) ** 2 +
          (data[idx + 2] - bgB) ** 2
        );
        if (dist <= lowThreshold) {
          visited[pIdx] = 1;
          queue[tail++] = pIdx;
        }
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const pIdx = y * width + x;
      if (!visited[pIdx]) {
        const idx = pIdx * channels;
        const dist = Math.sqrt(
          (data[idx] - bgR) ** 2 +
          (data[idx + 1] - bgG) ** 2 +
          (data[idx + 2] - bgB) ** 2
        );
        if (dist <= lowThreshold) {
          visited[pIdx] = 1;
          queue[tail++] = pIdx;
        }
      }
    }
  }

  // Step 2: Breadth-first search traversing ONLY connected outer background pixels
  while (head < tail) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = (curr / width) | 0;

    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (!visited[nIdx]) {
          const idx = nIdx * channels;
          const dist = Math.sqrt(
            (data[idx] - bgR) ** 2 +
            (data[idx + 1] - bgG) ** 2 +
            (data[idx + 2] - bgB) ** 2
          );
          if (dist <= lowThreshold) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }
    }
  }

  // Step 3: Make all connected outer background pixels 100% transparent
  for (let i = 0; i < totalPixels; i++) {
    if (visited[i] === 1) {
      data[i * channels + 3] = 0;
    }
  }

  // Step 4: Anti-aliasing pass — smooth alpha ramp ONLY on boundary pixels touching the outer background
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const pIdx = cy * width + cx;
      if (visited[pIdx] === 0) {
        const idx = pIdx * channels;
        const dist = Math.sqrt(
          (data[idx] - bgR) ** 2 +
          (data[idx + 1] - bgG) ** 2 +
          (data[idx + 2] - bgB) ** 2
        );
        if (dist < highThreshold) {
          const touchesBg = (
            (cx > 0 && visited[pIdx - 1] === 1) ||
            (cx < width - 1 && visited[pIdx + 1] === 1) ||
            (cy > 0 && visited[pIdx - width] === 1) ||
            (cy < height - 1 && visited[pIdx + width] === 1)
          );
          if (touchesBg) {
            const alphaFactor = (dist - lowThreshold) / (highThreshold - lowThreshold);
            data[idx + 3] = Math.max(0, Math.min(255, Math.round(alphaFactor * 255)));
          }
        }
      }
    }
  }
}

/**
 * Removes solid dark background from an image buffer and returns a transparent PNG buffer.
 * Uses connected boundary flood-fill to protect internal dark features.
 */
export async function removeDarkBackground(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

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

  const isDarkBg = ((bgR + bgG + bgB) / 3) < 60;
  if (isDarkBg) {
    applyFloodFillCutout(data, width, height, channels, bgR, bgG, bgB);
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
 * Converts raw image buffer into a WhatsApp WebP sticker with metadata.
 * If options.removeBg is true (default), applies boundary-connected flood-fill cutout.
 * If options.removeBg is false, keeps the full photo scene without cutout.
 */
export async function createSticker(imageBuffer, options = {}) {
  const { removeBg = true, ...metadata } = options;
  let webpBuffer;

  if (!removeBg) {
    // Full scene photo sticker (sin recorte)
    webpBuffer = await sharp(imageBuffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } else {
    // Cutout sticker (recortado con flood-fill)
    try {
      // Step 1: Decode to raw RGBA buffer
      const { data, info } = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height, channels } = info;

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

      // Step 3: Remove dark background using boundary-connected flood fill
      const isDarkBg = ((bgR + bgG + bgB) / 3) < 60;
      if (isDarkBg) {
        applyFloodFillCutout(data, width, height, channels, bgR, bgG, bgB);
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
  }

  // Format as WhatsApp WebP sticker with EXIF metadata
  return addStickerExif(webpBuffer, {
    pack: metadata.pack || config.bot.stickerPack,
    author: metadata.author || config.bot.stickerAuthor,
    categories: metadata.categories || ['🔥', '✨', '🎨'],
    ...metadata
  });
}
