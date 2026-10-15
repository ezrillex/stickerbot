export function getUtilityMessage(type, isGroup, status, prefix = '!sticker') {
  if (type === 'status') {
    return `📊 *Rolex AI Status*\n\n` +
      `• *Fecha (UTC):* ${status.date}\n` +
      `• *Usados:* ${status.used} / ${status.limit}\n` +
      `• *Disponibles:* ${status.remaining}\n` +
      `• *Reinicia:* 00:00 UTC`;
  }
  const customCommand = prefix !== '!sticker' ? `\n• *${prefix} <desc>* — Genera sticker de ilustración\n` : '';
  if (isGroup) {
    return `👋 *Rolex AI StickerBot*\n\n` +
      customCommand + `Mencióname o responde a mis mensajes con:\n` +
      `• *@bot /sticker <desc>* o *sticker: <desc>* — Genera sticker de ilustración\n` +
      `• *@bot /meme <desc>* o *meme: <desc>* — Genera foto meme cursed\n` +
      `• *@bot (en foto o respondiendo a foto)* sin texto — Convierte a sticker directo (sin gastar cuota IA)\n` +
      `• *@bot <instrucción> (respondiendo a foto)* — Edita foto en modo sticker (ej: \`@bot hazlo llorando\`)\n` +
      `• *@bot /meme* o *meme:* (con foto) — Transforma foto a modo meme\n` +
      `• *@bot /sticker* o *sticker:* (con foto) — Transforma foto a modo sticker\n\n` +
      `• *Uso hoy:* ${status.used}/${status.limit} generaciones IA (Reinicia a las 00:00 UTC)`;
  }
  return `👋 *Rolex AI StickerBot*\n\n` +
    customCommand + `*¿Cómo usarlo en chat privado?*\n\n` +
    `✨ *Creación con IA:*\n` +
    `• *Escribe cualquier texto* — Genera sticker automáticamente (ej: \`un gato astronauta\`)\n` +
    `• */meme <desc>* o *meme: <desc>* — Forzar foto meme realista / cursed\n` +
    `• *!sticker <desc>* o *sticker: <desc>* — Forzar modo ilustración sticker\n\n` +
    `📸 *Edición de fotos con IA:*\n` +
    `• *Foto + texto* (o respondiendo a una foto) — Edita la foto con IA (ej: \`hazlo llorando\`, \`ponelo enojado\`)\n` +
    `• *Foto + /meme* o *meme:* o *modo meme* — Transforma a foto meme cursed\n` +
    `• *Foto + /sticker* o *sticker:* o *modo sticker* — Transforma a sticker ilustrado\n\n` +
    `⚡ *Conversión directa (Sin IA / Ilimitado):*\n` +
    `• *Envía cualquier foto sin texto* — Se convierte a sticker al instante sin consumir cuota diaria\n\n` +
    `📊 *Estado:* ${status.used}/${status.limit} generaciones IA hoy (Reinicia 00:00 UTC)`;
}
