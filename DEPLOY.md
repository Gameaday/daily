# Deploy playbook

One recipe for every HistoryLabs site: a Caddy container serves the baked
site from the page cache behind Traefik, with hardened compose and deploys
by image tag. This file is duplicated across the site repos; this copy is
the reference. daily adds the scores service, but the serving recipe is
identical everywhere.

## The recipe

- One web container per site, `restart: unless-stopped`. daily adds scores
  on the internal network only, never published to the host.
- `read_only: true` with tmpfs for the only writable paths (`/config` and
  `/data` here; the archive volume for scores).
- `cap_drop: [ALL]`, plus `NET_BIND_SERVICE` only where the listener is
  below 1024 (Caddy on :80 here; historylabs listens on :8000 and needs
  nothing re-added).
- `no-new-privileges`, `mem_limit`, `pids_limit`, and json-file log
  rotation (10 MB x 3 files) so months of logs never fill the SD card.
- A HEALTHCHECK in the image, and a start script that prewarms the page
  cache, so the first hit after a redeploy is as fast as the rest.
- Cache policy: pages always revalidate, assets ride a long edge TTL with
  stale-while-revalidate; the optional Cloudflare purge step runs on
  release when `CF_ZONE_ID` and `CF_API_TOKEN` secrets are set.

## Deploy

```bash
docker compose pull && docker compose up -d --wait
curl -fsI http://localhost:8081/ | head -1   # expect 200
```

`--wait` holds the deploy until the healthcheck passes, so Traefik never
routes to a booting container. Redeploying mid-day is safe: scores warm
starts from the archive and the day never resets.

## Roll back

Pin the image in `.env` (`TAG=v1.2.3` or `TAG=sha-<short-sha>`) and run
`docker compose up -d`. Remove the pin to follow `latest` again.

## Edge (Traefik) side

- Give each backend a health check so a restarting container gets no traffic:

```yaml
http:
  services:
    daily:
      loadBalancer:
        healthCheck:
          path: /
          interval: 10s
        servers:
          - url: "http://<pi-ip>:8081"
```

- Attach a retry middleware (2 attempts) to the site routers: it absorbs
  the few-second recreate window during deploys, so visitors see no errors.
- Keep compression at the origin (Caddy does zstd + gzip); do not compress
  again at the edge.
- HTTP/3 at the edge is a free win for mobile clients; origins stay plain
  HTTP.

## Host basics (each Pi)

- zram swap, or none: never swap on the SD card.
- `/etc/docker/daemon.json`: `{"live-restore": true, "log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}`
- journald: `Storage=volatile` (or a small cap) in `/etc/systemd/journald.conf`.

## Recovery (SD card death)

1. Flash 64-bit Raspberry Pi OS Lite and install Docker.
2. Restore this compose file, `.env`, and the archive volume
   (`/opt/data/daily/archive`) from backup.
3. `docker compose up -d --wait`, then point Traefik at the Pi.

Everything else needed lives in git and GHCR, so recovery is minutes, not
hours.

## Future

If a native or Rust static server ever replaces Caddy, the recipe is
server-agnostic: swap the image and its config, keep the compose
hardening, the prewarm, and the healthcheck exactly as they are.
