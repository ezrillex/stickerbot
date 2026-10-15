import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const IMAGES_LOG_DIR = fileURLToPath(new URL('../logs/images/', import.meta.url));

export function saveRawImageLog(buffer, mode, userPrompt) {
  try {
    if (!fs.existsSync(IMAGES_LOG_DIR)) {
      fs.mkdirSync(IMAGES_LOG_DIR, { recursive: true });
    }

    let ext = 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) ext = 'jpg';
    else if (buffer[0] === 0x89 && buffer[1] === 0x50) ext = 'png';
    else if (buffer[0] === 0x52 && buffer[1] === 0x49) ext = 'webp';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = (userPrompt || 'image')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 30)
      .replace(/^_+|_+$/g, '');

    const finalSlug = slug || 'image';
    const filename = `${timestamp}_${mode}_${finalSlug}.${ext}`;
    const filePath = path.join(IMAGES_LOG_DIR, filename);

    fs.writeFileSync(filePath, buffer);
    console.log(`[Log] Raw image saved: logs/images/${filename}`);
  } catch (err) {
    console.warn('[Log] Could not save raw image log:', err.message);
  }
}
