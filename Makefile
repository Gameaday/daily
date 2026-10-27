# daily warmup - Pi deployment helpers
# Everything here is a convenience; the underlying commands are plain
# git + docker compose, safe to run by hand.

.PHONY: test up down restart logs deploy

test:
	node checks/games.js
	node tests/run.js
	python3 tests/server_test.py

up:
	docker compose up -d --build

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f --tail=100

# Run ON THE PI: pull the latest main and rebuild/restart both containers.
# Same command the GitHub Actions deploy workflow runs over SSH.
deploy:
	git pull --ff-only
	docker compose up -d --build
	docker image prune -f
