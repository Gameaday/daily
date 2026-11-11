#!/bin/sh
# prewarm the kernel page cache: the whole bundle is read once at boot,
# so every request after that is served out of memory, never off the
# disk (kind to the sd card, and the first hit is as fast as the rest)
find /srv/daily -type f -exec cat {} + >/dev/null 2>&1 || true
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
