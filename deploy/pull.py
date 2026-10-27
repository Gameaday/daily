#!/usr/bin/env python3
"""Pull-based update for the Pi: fetch, verify CI is green, fast-forward, rebuild.

The Pi asks GitHub what's new; GitHub can never ask the Pi for anything.
No inbound SSH, no private keys stored anywhere, no GitHub secrets - the
only outbound connections are `git fetch` and one GitHub API read.

Safe to run every few minutes (the shipped systemd timer does exactly that):

- nothing to do when HEAD already matches origin/main
- refuses a dirty working tree (untracked files like .env are fine);
  never merges, never rebases, never force-anything - ff-only
- updates ONLY to commits whose CI run finished green, matching that
  exact head sha. A red run, a still-running run, or an unreachable API
  means: keep serving the last known-good version, try again next cycle
- `docker compose up -d --build` keeps the old containers running if a
  rebuild fails, so a bad commit can't take the site down

Env (all optional):
  DAILY_REQUIRE_CI=0   update even when the API is unreachable (default: wait)
  GITHUB_TOKEN=<t>     read-only token, ONLY needed if the repo is private

Run by hand:  python3 deploy/pull.py      (or `make deploy`)
Exit codes:   0 = up to date / deployed / waiting, 1 = needs attention
"""
import json
import os
import subprocess
import sys
import urllib.request

REPO = "Gameaday/daily"
RUNS_URL = ("https://api.github.com/repos/%s/actions/runs?branch=main&per_page=10" % REPO)


def die(msg):
    print("pull.py: " + msg, file=sys.stderr)
    sys.exit(1)


def sh(*args):
    """Run a command; die loudly on failure. Returns stdout without the newline."""
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        die("command failed: " + " ".join(args) + "\n" + r.stderr.strip())
    return r.stdout.strip()


def ci_state(sha):
    """'green' | 'red' | 'running' | 'unknown' for the commit we would deploy."""
    req = urllib.request.Request(RUNS_URL, headers={"Accept": "application/vnd.github+json"})
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", "token " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            runs = json.load(resp).get("workflow_runs", [])
    except Exception as e:
        print("CI status unreachable (%s)" % e)
        if os.environ.get("DAILY_REQUIRE_CI", "1") != "1":
            return "green"
        return "unknown"
    for run in runs:
        if run.get("head_sha") == sha and run.get("head_branch") == "main":
            if run.get("status") != "completed":
                return "running"
            return "green" if run.get("conclusion") == "success" else "red"
    return "unknown"  # run not registered yet, or pruned by retention


def main():
    root = sh("git", "rev-parse", "--show-toplevel")
    os.chdir(root)
    if sh("git", "status", "--porcelain", "--untracked-files=no"):
        die("working tree is dirty - commit or stash local changes first")
    sh("git", "fetch", "--quiet", "origin", "main")

    local = sh("git", "rev-parse", "HEAD")
    remote = sh("git", "rev-parse", "origin/main")
    if local == remote:
        print("up to date at %s" % local[:7])
        return 0

    state = ci_state(remote)
    if state == "running":
        print("CI still running for %s - waiting for the next cycle" % remote[:7])
        return 0
    if state != "green":
        print("not updating to %s (CI %s) - serving the last known-good version"
              % (remote[:7], state))
        return 1

    sh("git", "pull", "--ff-only", "--quiet", "origin", "main")
    sh("docker", "compose", "up", "-d", "--build")
    sh("docker", "image", "prune", "-f")
    print("updated %s -> %s" % (local[:7], remote[:7]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
