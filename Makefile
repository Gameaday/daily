# daily warmup - convenience targets; the underlying commands are plain
# node, python and docker compose, safe to run by hand.

.PHONY: test build up update down restart logs

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

# start (or restart into) the stack: pulls the published images
up:
	docker compose up -d

# pick up the newest published release
update:
	docker compose pull
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f --tail=100
