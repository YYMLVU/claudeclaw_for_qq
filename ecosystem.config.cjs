module.exports = {
  apps: [
    {
      name: "claudeclaw-qq",
      script: "bun",
      args: "run src/index.ts qq",
      cwd: "/home/xiao/claudeclaw_for_qq",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        PATH: "/home/xiao/.bun/bin:/home/xiao/.nvm/versions/node/v24.14.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/home/xiao/claudeclaw_for_qq/.claude/claudeclaw/logs/pm2-error.log",
      out_file: "/home/xiao/claudeclaw_for_qq/.claude/claudeclaw/logs/pm2-out.log",
      merge_logs: true,
    },
  ],
};
