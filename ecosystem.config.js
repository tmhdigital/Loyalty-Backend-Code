// ============================================================================
// ecosystem.config.js  —  REPLACE the whole file with this.
// ----------------------------------------------------------------------------
// WHY THIS CHANGED
//   In PM2 cluster mode, the `env` / `env_production` blocks REPLACE the
//   variables PM2 hands to each worker. The old file only listed NODE_ENV
//   there, so PM2 was building each worker's process.env from that block —
//   and REDIS_URL (injected by `docker run --env-file .env.production`) was
//   NOT being propagated into the workers.
//
//   Result: inside a worker, process.env.REDIS_URL was undefined, so the
//   cache gate `Boolean(process.env.REDIS_URL) && pubClient.isReady` was
//   false and every cache call silently no-op'd — even though Redis itself
//   was reachable (a standalone `node -e` connected fine, because that was a
//   fresh process that DID inherit the container env).
//
//   THE FIX: don't let PM2 define the environment at all. The container's
//   --env-file already provides everything. We (a) drop the NODE_ENV-only
//   env blocks and (b) start WITHOUT `--env production` so PM2 simply
//   inherits the full ambient process.env — REDIS_URL included.
//
//   NODE_ENV=production is already set by the container (you pass it in
//   .env.production / -e NODE_ENV=production), so nothing is lost.
// ============================================================================

module.exports = {
  apps: [
    {
      name: 'mlitech_backend',
      script: 'dist/server.js',
      instances: 2,          // 2 vCPU droplet -> 2 workers
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',

      // NO env / env_production blocks.
      // PM2 will inherit the container's full environment (REDIS_URL,
      // DATABASE_URL, NODE_ENV, everything from --env-file) for every worker.
    },
  ],
};