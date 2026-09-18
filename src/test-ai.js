import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enhancePrompt } from './gemini.js';
import { generateImage } from './imageGen.js';
import { createSticker } from './sticker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '..', 'temp');

async function runTest() {
  console.log('==============================================');
  console.log('     Rolex AI StickerBot — Pipeline Test      ');
  console.log('==============================================\n');

  const testPrompt = 'a cute golden retriever wearing sunglasses and a hoodie';
  console.log(`[Test] Input prompt: "${testPrompt}"\n`);

  try {
    // 1. Gemini enhancement
    console.log('[1/3] Testing Gemini Flash Lite via Cloudflare AI Gateway...');
    const enhancedPrompt = await enhancePrompt(testPrompt);
    console.log(`[1/3] SUCCESS! Enhanced prompt:\n      "${enhancedPrompt}"\n`);

    // 2. FLUX image generation
    console.log('[2/3] Testing FLUX 2 Klein 4B via Cloudflare Workers AI...');
    const imageBuffer = await generateImage(enhancedPrompt);
    console.log(`[2/3] SUCCESS! Generated image size: ${imageBuffer.length} bytes\n`);

    // 3. Cutout & WebP sticker creation
    console.log('[3/3] Testing background removal and WebP sticker formatting...');
    const stickerBuffer = await createSticker(imageBuffer);
    console.log(`[3/3] SUCCESS! Sticker size: ${stickerBuffer.length} bytes\n`);

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const rawPath = path.join(TEMP_DIR, 'test_raw.jpg');
    const stickerPath = path.join(TEMP_DIR, 'test_sticker.webp');

    fs.writeFileSync(rawPath, imageBuffer);
    fs.writeFileSync(stickerPath, stickerBuffer);

    console.log('==============================================');
    console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
    console.log(`- Saved raw image:     ${rawPath}`);
    console.log(`- Saved final sticker: ${stickerPath}`);
    console.log('==============================================');
  } catch (err) {
    console.error('\n❌ TEST FAILED with error:');
    console.error(err);
    process.exit(1);
  }
}

runTest();
