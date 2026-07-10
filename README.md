# UMN Ed Tech Transparency Project

An independent, unofficial website that helps faculty, students, staff, and community members
understand the University of Minnesota's policies on AI and technology, its contracts with
educational technology companies, and how UMN compares with peer universities.

**Not produced or endorsed by the University of Minnesota.**

## Features

- **Searchable Q&A** — a homepage search bar answers plain-language questions
  ("Can I use ChatGPT on my homework?") with answers that link directly to official policies,
  contracts, and other verified sources. Search runs entirely in the browser; no backend needed.
- **Policies** (`policies.html`) — plain-language summaries of UMN's AI and technology policies,
  filterable by category, every entry linking its official source. **Updated automatically:**
  a weekly GitHub Action checks the official pages for changes and logs them.
- **Contracts** (`contracts.html`) — UMN's ed tech vendor relationships (Canvas, Google,
  Microsoft, Zoom, Honorlock, Qualtrics, Oracle, Salesforce…) with what is publicly known about
  data handling, and explicit notes where terms are *not* public.
- **History** (`history.html`) — a sourced timeline from ERA and the UNIVAC 1103 through the
  Gopher protocol, MECC and The Oregon Trail, Moodle→Canvas, the pandemic, and the AI era.
- **Compare** (`compare.html`) — all 18 Big Ten universities plus Stanford, MIT, UC Berkeley,
  Harvard, UT Austin, and Arizona State: LMS, AI guidance, campus AI tools, and notable programs.

## Architecture

Plain HTML/CSS/JavaScript, no build step, no dependencies. All content lives in JSON files
under `data/`:

| File | Contents |
|---|---|
| `data/faq.json` | Curated Q&A entries powering search |
| `data/policies.json` | Policy summaries |
| `data/contracts.json` | Vendor relationships |
| `data/history.json` | Timeline events |
| `data/compare.json` | Peer-university comparison |
| `data/watchlist.json` | Official URLs monitored weekly |
| `data/changelog.json` | Detected policy-page changes (machine-written) |
| `data/status.json` | Last-checked timestamp (machine-written) |
| `data/snapshots/` | Content hashes of watched pages (machine-written) |
| `data/staging/` | Raw research intermediates (not used by the site) |

To edit content, edit the JSON — the pages render from it at load time.

## Weekly policy monitoring

`.github/workflows/policy-check.yml` runs every Monday (and on demand via *Run workflow*).
It executes `scripts/check_policies.py`, which fetches each watchlist URL, normalizes the page
to text, hashes it, and compares against the stored snapshot. Changes are appended to
`data/changelog.json` (shown on the Policies page) and committed back to the repository.
The first run records baselines; subsequent runs detect changes.

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Pages fetch JSON, so use a local server rather than opening files directly.)

## Deployment (GitHub Pages)

1. In the repository settings, set **Pages → Source → GitHub Actions**.
2. Merge to `main`. `.github/workflows/deploy-pages.yml` deploys the site.

## Human verification workflow

The ✓ "human verified" badge is reserved for claims a human has double-checked against the
linked source. Everything produced by AI-assisted research starts as `partially-verified`,
no matter how well corroborated. To promote an entry after you have personally confirmed it:

1. Open the entry in its data file (`data/policies.json`, `data/contracts.json`,
   `data/history.json`, or `data/compare.json`) and change `"status": "partially-verified"`
   to `"status": "verified"`.
2. For the spending table (static HTML in `contracts.html#spending-record`), change the row's
   badge from `badge-unverified` / "partially verified" to `badge-verified` / "✓ human verified".
3. Commit with a message noting what you checked (e.g., `Human-verified: Salesforce docket
   figure against March 2023 PDF`) — the git history is the public review log.

## Verification methodology

See `about.html`. In short: every claim links a source; entries are badged by verification level;
contract dollar figures come from public Board of Regents docket summaries and news reporting,
not the contracts themselves (which UMN does not publish — they are requestable under the
Minnesota Government Data Practices Act).
