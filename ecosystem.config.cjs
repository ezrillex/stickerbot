module.exports = {
  apps: [
    {
      name: 'stickerbot',
      script: 'src/index.js',
      // CRITICAL: Baileys only allows 1 instance. Do NOT use cluster mode.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      time: true,
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
