# daily warmup - Pi deployment helpers
# Everything here is a convenience; the underlying commands are plain
# git + docker compose, safe to run by hand.

.PHONY: test build up down restart logs deploy

# full local gate: same three layers CI runs, with the committed puzzle
# stores verified against the client banks first (run.js checks the
# committed picks against the games)
test:
	node tools/export-puzzles.mjs
	node checks/games.js
	node tests/run.js
	python3 tests/server_test.py

# build the offline + online site bundles into dist/
build:
	node tools/build-bundles.mjs

up:
	docker compose up -d --build

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f --tail=100

# Run anywhere with the repo (the same thing the systemd timer runs):
# fetch, verify CI is green on origin/main, fast-forward, rebuild containers.
# The rebuild is what ships new site content - the site is baked into the
# images, and a failed rebuild leaves the old containers running.
# No SSH, no secrets - the machine running it only makes outbound connections.
deploy:
	python3 deploy/pull.py
