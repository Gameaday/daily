#!/usr/bin/env python3
"""Tag-gated, pull-based deploys for the Pi: releases go live by tag.

The Pi asks GitHub what's new; GitHub can never ask the Pi for anything.
No inbound SSH, no private keys stored anywhere, no GitHub secrets - the
only outbound connections are git fetch, one GitHub API read, and one
loopback HTTP smoke test.

How releases work now:

- every push to main still runs CI (validate.yml), but the Pi no longer
  tracks main. It deploys ONLY the newest v* git tag, and only once the
  validate run for that exact tag commit finished green
- pushing a tag is the deploy act: git tag v1.0.0 && git push --tags
- a red or still-running validate run means: keep serving the last
  known-good version, try again next cycle
- after rebuilding, a loopback smoke test (GET /api/health and GET /) must
  pass; on any failure the Pi checks out and rebuilds the previous tag,
  so a bad release can't take the site down
- refuses a dirty working tree; never merges, never force-anything

Env (all optional):
  DAILY_REQUIRE_CI=0     update even when the API is unreachable (default: wait)
  DAILY_BASE_URL=<url>   smoke-test base (default: http://127.0.0.1:8080)
  GITHUB_TOKEN=<t>       read-only token, ONLY needed if the repo is private

Run by hand:  python3 deploy/pull.py      (or `make deploy`)
Exit codes:   0 = up to date / deployed / waiting, 1 = needs attention
"""
import json
import os
import subprocess
import sys
import urllib.request

REPO = "Gameaday/daily"
RUNS_URL = ("https://api.github.com/repos/%s/actions/runs?per_page=20" % REPO)
BASE_URL = os.environ.get("DAILY_BASE_URL", "http://127.0.0.1:8080")


def die(msg):
    print("pull.py: " + msg, file=sys.stderr)
    sys.exit(1)


def sh(*args):
    """Run a command; die loudly on failure. Returns stdout without the newline."""
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        die("command failed: " + " ".join(args) + "\n" + r.stderr.strip())
    return r.stdout.strip()


def run(*args):
    """Run a command; return its exit code instead of dying. For rebuilds."""
    return subprocess.run(args, capture_output=True, text=True).returncode


def latest_tag():
    """The newest v* tag and its commit, or (None, None) when none exist."""
    tags = sh("git", "tag", "--list", "v*", "--sort=-v:refname").split()
    if not tags:
        return None, None
    tag = tags[0]
    return tag, sh("git", "rev-list", "-n", "1", tag)


def ci_state(sha):
    """'green' | 'red' | 'running' | 'unknown' for the commit we would deploy.

    Only runs of the validate workflow count: the release workflow also
    matches head_sha, but it must not let the Pi move before validate
    has finished on the same commit."""
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
        if run.get("head_sha") == sha and run.get("name") == "validate":
            if run.get("status") != "completed":
                return "running"
            return "green" if run.get("conclusion") == "success" else "red"
    return "unknown"  # run not registered yet, or pruned by retention


def smoke():
    """True when the freshly rebuilt site answers on the loopback interface."""
    for path, want in [("/api/health", "ok"), ("/", "")]:
        try:
            with urllib.request.urlopen(BASE_URL + path, timeout=15) as resp:
                body = resp.read().decode("utf-8", "replace")
                if resp.status != 200 or (want and want not in body):
                    print("smoke test failed for %s (status %s)" % (path, resp.status))
                    return False
        except Exception as e:
            print("smoke test failed for %s (%s)" % (path, e))
            return False
    return True


def rebuild():
    """Rebuild the containers. Returns True on success (old ones keep
    running if the build breaks, which is the safety net)."""
    if run("docker", "compose", "up", "-d", "--build") != 0:
        return False
    run("docker", "image", "prune", "-f")
    return True


def main():
    root = sh("git", "rev-parse", "--show-toplevel")
    os.chdir(root)
    if sh("git", "status", "--porcelain", "--untracked-files=no"):
        die("working tree is dirty - commit or stash local changes first")
    sh("git", "fetch", "--quiet", "--tags", "origin")

    tag, target = latest_tag()
    if tag is None:
        print("no release tags yet - serving the last known-good version")
        return 1

    local = sh("git", "rev-parse", "HEAD")
    if local == target:
        print("up to date at %s (%s)" % (tag, local[:7]))
        return 0

    state = ci_state(target)
    if state == "running":
        print("validate still running for %s - waiting for the next cycle" % tag)
        return 0
    if state != "green":
        print("not deploying %s (CI %s) - serving the last known-good version"
              % (tag, state))
        return 1

    print("deploying %s (%s)" % (tag, target[:7]))
    sh("git", "checkout", "--quiet", "--detach", target)
    if not rebuild():
        print("rebuild failed on %s - rolling back to %s" % (tag, local[:7]))
        sh("git", "checkout", "--quiet", local)
        rebuild()
        return 1
    if not smoke():
        print("smoke test failed on %s - rolling back to %s" % (tag, local[:7]))
        sh("git", "checkout", "--quiet", local)
        rebuild()
        return 1
    print("deployed %s: %s -> %s" % (tag, local[:7], target[:7]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
