// pm2 process definition for Nuvault.
//
// Runs the Express API server, which also serves the built React client
// (client/dist) on a single port. pm2 keeps it alive: it auto-restarts
// the process if it crashes, and `pm2 resurrect` brings it back after a
// reboot/login (see start-nuvault.bat in the Windows Startup folder).
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 restart nuvault   (after an update + client rebuild)
module.exports = {
  apps: [
    {
      name: 'nuvault',
      cwd: __dirname + '/server',
      script: 'server.js',
      // Restart on crash, with a small backoff; cap rapid restart loops.
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
