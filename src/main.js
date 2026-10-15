try {
  const { handleIncomingMessages } = await import('./index.js');
  const { connectToWhatsApp } = await import('./whatsapp.js');
  console.log('Rolex AI StickerBot — Starting up');
  await connectToWhatsApp(handleIncomingMessages);
} catch (error) {
  console.error(`[Startup] ${error.message}`);
  process.exitCode = 1;
}
