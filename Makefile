# daily warmup - Pi deployment helpers
# Everything here is a convenience; the underlying commands are plain
# git + docker compose, safe to run by hand.

.PHONY: test build up down restart logs deploy

# full local gate: the same test layers CI runs, with the knowledge layer
# verified against the committed stores first
test:
	node tools/build-knowledge.mjs
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

# The same thing the systemd timer runs: deploy the newest stable v* tag
# once its validate run is green (fetch, CI check, checkout, rebuild),
# smoke-test the loopback port, roll back on failure. Pushing a tag is
# the deploy act - the Pi never tracks main. No SSH, no secrets - the
# machine running it only makes outbound connections.
deploy:
	python3 deploy/pull.py
