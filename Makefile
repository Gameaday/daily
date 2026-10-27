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

# Run anywhere with the repo (the same thing the systemd timer runs):
# fetch, verify CI is green on origin/main, fast-forward, rebuild containers.
# No SSH, no secrets - the machine running it only makes outbound connections.
deploy:
	python3 deploy/pull.py
