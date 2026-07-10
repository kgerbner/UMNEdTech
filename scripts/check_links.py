#!/usr/bin/env python3
"""Site-wide link checker and repairer.

Modes:
  --internal   Check internal links/anchors and that every data entry cites a
               source. No network needed. Exits non-zero on problems.
  --external   Check every external URL on the site. Repairs conservatively:
                 * permanent redirects (301/308) ending at a real page are
                   rewritten to the final URL;
                 * URLs that are definitively gone (404/410) on two
                   consecutive runs are replaced with their most recent
                   Wayback Machine snapshot, when one exists;
                 * bot blocks / transient errors (403, 429, 5xx, timeouts)
                   are reported but never rewritten.
               State lives in data/linkcheck.json; rewrites are logged to
               data/changelog.json. Designed for the weekly GitHub Action.

Uses only the Python standard library.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

HTML_FILES = sorted(ROOT.glob("*.html"))
JSON_FILES = [DATA / n for n in
              ("faq.json", "policies.json", "contracts.json", "history.json", "compare.json")]

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
TIMEOUT = 25

URL_RE = re.compile(r'https?://[^\s"\'<>\\]+')
HREF_RE = re.compile(r'href="([^"]+)"')

# UMN Libraries' archive systems ask that automated traffic stay away (their
# bot protection rejects us regardless). Out of respect, never probe these —
# their links are recorded as "skipped" and never rewritten.
NO_PROBE_DOMAINS = (
    "conservancy.umn.edu",
    "umedia.lib.umn.edu",
    "archives.lib.umn.edu",
    "gallery.lib.umn.edu",
    "www.lib.umn.edu",
)


def is_no_probe(url):
    host = urllib.parse.urlparse(url).hostname or ""
    return any(host == d or host.endswith("." + d) for d in NO_PROBE_DOMAINS)


def load_json(path, default):
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return default


def save_json(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def collect_external_urls():
    """Every external URL in the site's HTML and content JSON."""
    urls = set()
    for path in list(HTML_FILES) + JSON_FILES:
        text = path.read_text()
        for m in URL_RE.finditer(text):
            url = m.group(0)
            # JSON escaping: URLs never legitimately contain backslashes here.
            url = url.split("\\")[0]
            url = url.rstrip(".,’”")
            # Trim a trailing ")" only when it is unbalanced — Wikipedia URLs
            # like .../Gopher_(protocol) legitimately end with one.
            while url.endswith(")") and url.count(")") > url.count("("):
                url = url[:-1]
            urls.add(url)
    return sorted(urls)


# ---------------------------------------------------------------------------
# Internal checks
# ---------------------------------------------------------------------------

def known_ids():
    """Anchor ids available on each data-rendered page."""
    ids = {}
    ids["policies.html"] = {p["id"] for p in load_json(DATA / "policies.json", {}).get("policies", [])}
    ids["policies.html"].add("changes")
    ids["contracts.html"] = {c["id"] for c in load_json(DATA / "contracts.json", {}).get("contracts", [])}
    ids["faq.html"] = {q["id"] for q in load_json(DATA / "faq.json", {}).get("questions", [])}
    ids["compare.html"] = {s["id"] for s in load_json(DATA / "compare.json", {}).get("schools", [])}
    return ids


def check_internal():
    problems = []
    page_names = {p.name for p in HTML_FILES}
    data_ids = known_ids()

    # 1) hrefs in HTML point to existing pages/anchors
    for path in HTML_FILES:
        text = path.read_text()
        static_ids = set(re.findall(r'id="([^"]+)"', text))
        for href in HREF_RE.findall(text):
            if href.startswith(("http://", "https://", "mailto:")):
                continue
            target, _, frag = href.partition("#")
            target = target.split("?")[0]
            if target and target not in page_names and not (ROOT / target).exists():
                problems.append(f"{path.name}: broken internal link -> {href}")
                continue
            page = target or path.name
            if frag:
                ok = (frag in data_ids.get(page, set())) or \
                     (page == path.name and frag in static_ids) or \
                     (page in page_names and f'id="{frag}"' in (ROOT / page).read_text()) or \
                     page == "history.html"  # event anchors are derived from data
                if not ok:
                    problems.append(f"{path.name}: anchor not found -> {href}")

    # 2) related_page values in faq.json resolve
    for q in load_json(DATA / "faq.json", {}).get("questions", []):
        rp = q.get("related_page") or ""
        if not rp:
            continue
        target, _, frag = rp.partition("#")
        if target not in page_names:
            problems.append(f"faq.json[{q['id']}]: related_page page missing -> {rp}")
        elif frag and frag not in data_ids.get(target, set()) and \
                f'id="{frag}"' not in (ROOT / target).read_text():
            problems.append(f"faq.json[{q['id']}]: related_page anchor missing -> {rp}")

    # 3) every factual entry cites at least one source
    for p in load_json(DATA / "policies.json", {}).get("policies", []):
        if not p.get("url"):
            problems.append(f"policies.json[{p['id']}]: no source url")
    for c in load_json(DATA / "contracts.json", {}).get("contracts", []):
        if not c.get("sources"):
            problems.append(f"contracts.json[{c['id']}]: no sources")
    for e in load_json(DATA / "history.json", {}).get("timeline", []):
        if not e.get("sources"):
            problems.append(f"history.json[{e['year']} {e['title'][:30]}]: no sources")
    for s in load_json(DATA / "compare.json", {}).get("schools", []):
        if not s.get("sources"):
            problems.append(f"compare.json[{s['id']}]: no sources")
    for q in load_json(DATA / "faq.json", {}).get("questions", []):
        if not q.get("sources") and not q.get("related_page"):
            problems.append(f"faq.json[{q['id']}]: no sources and no related_page")

    return problems


# ---------------------------------------------------------------------------
# External checks
# ---------------------------------------------------------------------------

class RedirectRecorder(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        self.permanent = False

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if code in (301, 308):
            self.permanent = True
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def probe(url):
    """Return (status, final_url, permanent_redirect)."""
    recorder = RedirectRecorder()
    opener = urllib.request.build_opener(recorder)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                               "Accept": "text/html,application/pdf,*/*"})
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            resp.read(2048)
            return resp.status, resp.geturl(), recorder.permanent
    except urllib.error.HTTPError as e:
        return e.code, url, recorder.permanent
    except Exception as e:  # noqa: BLE001 - DNS failures, timeouts, TLS errors
        return 0, url, False


def wayback_snapshot(url):
    api = "https://archive.org/wayback/available?url=" + urllib.parse.quote(url, safe="")
    try:
        req = urllib.request.Request(api, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.load(resp)
        snap = (data.get("archived_snapshots") or {}).get("closest") or {}
        if snap.get("available"):
            return snap.get("url")
    except Exception:  # noqa: BLE001
        pass
    return None


def rewrite_everywhere(old, new):
    changed = []
    for path in list(HTML_FILES) + JSON_FILES:
        text = path.read_text()
        if old in text:
            path.write_text(text.replace(old, new))
            changed.append(path.name)
    return changed


def check_external():
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    state = load_json(DATA / "linkcheck.json", {"results": {}})
    changelog = load_json(DATA / "changelog.json", {"entries": []})
    urls = collect_external_urls()
    skipped = [u for u in urls if is_no_probe(u)]
    urls = [u for u in urls if not is_no_probe(u)]

    print(f"Checking {len(urls)} external URLs "
          f"({len(skipped)} archive URLs skipped by crawling policy)…\n")
    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = dict(zip(urls, pool.map(probe, urls)))

    ok = repaired = suspect = dead = 0
    for url in urls:
        status, final, permanent = outcomes[url]
        prev = state["results"].get(url, {})
        entry = {"status": status, "last_checked": now}

        if 200 <= status < 400:
            entry["ok"] = True
            entry["consecutive_failures"] = 0
            ok += 1
            # Permanent redirect to a concrete page: adopt the new URL,
            # unless it collapses to a site root (a soft-404 pattern).
            final_path = urllib.parse.urlparse(final).path
            if permanent and final.split("#")[0] != url and final_path not in ("", "/"):
                changed = rewrite_everywhere(url, final)
                if changed:
                    repaired += 1
                    changelog["entries"].insert(0, {
                        "date": now, "policy_id": "link-fix",
                        "description": f"Link updated to its new permanent address: {url} -> {final}",
                        "url": final,
                    })
                    print(f"MOVED  {url}\n       -> {final} ({', '.join(changed)})")
        elif status in (404, 410):
            fails = prev.get("consecutive_failures", 0) + 1
            entry["ok"] = False
            entry["consecutive_failures"] = fails
            dead += 1
            if fails >= 2:
                snap = wayback_snapshot(url)
                if snap:
                    changed = rewrite_everywhere(url, snap)
                    if changed:
                        repaired += 1
                        entry["replaced_with"] = snap
                        changelog["entries"].insert(0, {
                            "date": now, "policy_id": "link-fix",
                            "description": f"Dead link replaced with its archived copy: {url}",
                            "url": snap,
                        })
                        print(f"DEAD   {url}\n       -> archived copy ({', '.join(changed)})")
                else:
                    print(f"DEAD   {url} (no archive available — needs manual replacement)")
            else:
                print(f"DEAD?  {url} (HTTP {status}; will repair next run if still dead)")
        else:
            # 403/429/5xx/timeouts: often bot protection, never auto-rewrite.
            entry["ok"] = False
            entry["consecutive_failures"] = prev.get("consecutive_failures", 0) + 1
            suspect += 1
            print(f"BLOCK? {url} (HTTP {status or 'no response'} — possibly bot-blocked, left as is)")

        state["results"][url] = entry

    for url in skipped:
        state["results"][url] = {
            "status": "skipped",
            "ok": None,
            "last_checked": now,
            "note": "not probed — UMN Libraries archive systems ask automated traffic to stay away",
        }

    state["last_run"] = now
    state["totals"] = {"checked": len(urls), "ok": ok, "repaired": repaired,
                       "dead": dead, "unreachable": suspect, "skipped": len(skipped)}
    # Drop state for URLs no longer present on the site (including ones this
    # run just rewrote), so the report reflects only current links.
    current = set(collect_external_urls())
    state["results"] = {u: r for u, r in state["results"].items() if u in current}
    save_json(DATA / "linkcheck.json", state)
    save_json(DATA / "changelog.json", changelog)
    print(f"\nDone: {len(urls)} checked, {ok} ok, {repaired} repaired, "
          f"{dead} dead, {suspect} unreachable/bot-blocked")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--internal", action="store_true")
    ap.add_argument("--external", action="store_true")
    args = ap.parse_args()

    if args.internal or not args.external:
        problems = check_internal()
        if problems:
            print(f"{len(problems)} internal problem(s):")
            for p in problems:
                print(" -", p)
            if not args.external:
                sys.exit(1)
        else:
            print("Internal links, anchors, and source coverage: all OK")

    if args.external:
        check_external()


if __name__ == "__main__":
    main()
