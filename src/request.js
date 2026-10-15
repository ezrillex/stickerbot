import { config } from './config.js';

// Keep the deadline active until the response body has been consumed.
export async function request(url, options, readResponse, timeoutMs = config.bot.aiTimeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`AI request timed out after ${timeoutMs} ms. Please try again.`);
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });

  try {
    const operation = fetch(url, { ...options, signal: controller.signal }).then(readResponse);
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
