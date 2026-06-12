#!/usr/bin/env python3
"""Weekly policy-change checker.

Fetches every page in data/watchlist.json, normalizes it to text, and compares
a content hash against the stored snapshot in data/snapshots/. Detected changes
are appended to data/changelog.json, and data/status.json gets a fresh
"last_checked" timestamp either way. Designed to run in GitHub Actions on a
weekly cron; the workflow commits whatever this script changes.

Uses only the Python standard library.
"""

import hashlib
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SNAPSHOTS = DATA / "snapshots"

# Some university WAFs (e.g. president.umn.edu) reject "compatible;" bot UAs,
# so identify as a regular browser.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
TIMEOUT = 30


def fetch_text(url):
    """Fetch a URL and reduce it to normalized visible text."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read()
    try:
        body = raw.decode("utf-8")
    except UnicodeDecodeError:
        body = raw.decode("latin-1", errors="replace")

    # Strip scripts/styles, then all tags, then collapse whitespace, so that
    # markup-only changes (asset hashes, nonces) don't register as changes.
    body = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", body)
    body = re.sub(r"(?is)<!--.*?-->", " ", body)
    body = re.sub(r"(?s)<[^>]+>", " ", body)
    body = html.unescape(body)
    body = re.sub(r"\s+", " ", body).strip()
    return body


def load_json(path, default):
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return default


def save_json(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    watchlist = load_json(DATA / "watchlist.json", {"watch_urls": []})["watch_urls"]
    changelog = load_json(DATA / "changelog.json", {"entries": []})
    status = load_json(DATA / "status.json", {})
    SNAPSHOTS.mkdir(exist_ok=True)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    changes = 0
    errors = 0

    for item in watchlist:
        wid, url, label = item["id"], item["url"], item.get("label", item["url"])
        snap_path = SNAPSHOTS / f"{wid}.txt"
        try:
            text = fetch_text(url)
        except Exception as exc:  # noqa: BLE001 - log and continue to next page
            print(f"ERROR  {wid}: {exc}", file=sys.stderr)
            errors += 1
            continue

        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        previous = snap_path.read_text().strip() if snap_path.exists() else None

        if previous is None:
            snap_path.write_text(digest + "\n")
            print(f"INIT   {wid}: baseline recorded")
        elif previous != digest:
            snap_path.write_text(digest + "\n")
            changelog["entries"].insert(0, {
                "date": now,
                "policy_id": wid,
                "description": f"Change detected on: {label}",
                "url": url,
            })
            status["last_change_detected"] = now
            changes += 1
            print(f"CHANGE {wid}: content changed")
        else:
            print(f"OK     {wid}: unchanged")

    status["last_checked"] = now
    status["watch_count"] = len(watchlist)
    save_json(DATA / "status.json", status)
    save_json(DATA / "changelog.json", changelog)

    print(f"\nDone: {len(watchlist)} watched, {changes} changed, {errors} errors")
    # Non-zero exit only on total failure, so partial outages don't kill the run.
    if errors == len(watchlist) and watchlist:
        sys.exit(1)


if __name__ == "__main__":
    main()
