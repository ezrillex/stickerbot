import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import sharp from 'sharp';

export async function downloadBaileysMedia(mediaMessage, type = 'image', {
  download = downloadContentFromMessage,
  timeoutMs = 25000,
  maxBytes = 20 * 1024 * 1024
} = {}) {
  let stream;
  let timedOut = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Tiempo de espera agotado al descargar de WhatsApp'));
      stream?.destroy?.();
    }, timeoutMs);
  });

  try {
    const downloadPromise = (async () => {
      stream = await download(mediaMessage, type);
      if (timedOut) {
        stream.destroy?.();
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('La imagen supera el tamaño máximo de descarga.');
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks, size);
      if (!buffer.length) throw new Error('La imagen descargada está vacía o no se pudo leer.');
      return buffer;
    })();
    return await Promise.race([downloadPromise, timeout]);
  } catch (error) {
    stream?.destroy?.();
    throw new Error(`No se pudo descargar la imagen original (${error.message}). Si es una foto antigua, por favor reenvíala.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function preprocessReferenceImage(inputBuffer) {
  return sharp(inputBuffer)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}
