/* Client-side search over the curated Q&A index and all document data.
 * No dependencies. Builds an in-memory index from the JSON data files and
 * scores results by weighted token overlap, with a synonym map so plain
 * questions ("can I use chatgpt") reach the right documents. */

(function () {
  "use strict";

  const SYNONYMS = {
    chatgpt: ["ai", "generative", "openai"],
    copilot: ["ai", "generative", "microsoft"],
    gemini: ["ai", "generative", "google"],
    claude: ["ai", "generative", "anthropic"],
    ai: ["artificial", "intelligence", "generative"],
    cheating: ["academic", "integrity", "misconduct", "conduct"],
    plagiarism: ["academic", "integrity", "misconduct"],
    canvas: ["lms", "instructure", "course"],
    gmail: ["google", "email", "workspace"],
    email: ["google", "gmail", "workspace"],
    zoom: ["video", "remote", "meeting"],
    proctoring: ["proctorio", "exam", "surveillance", "monitoring", "assessment"],
    proctorio: ["proctoring", "exam", "surveillance"],
    privacy: ["data", "ferpa", "security"],
    ferpa: ["privacy", "student", "records", "data"],
    grades: ["ferpa", "records", "student"],
    contract: ["vendor", "agreement", "procurement"],
    vendor: ["contract", "company", "agreement"],
    teacher: ["faculty", "instructor"],
    professor: ["faculty", "instructor"],
    instructor: ["faculty", "teaching"],
    syllabus: ["course", "instructor", "policy"],
    gopher: ["internet", "protocol", "history"],
    homework: ["coursework", "assignment", "student"],
    exam: ["assessment", "test", "proctoring"],
    surveillance: ["proctoring", "monitoring", "privacy"],
    turnitin: ["plagiarism", "detection", "integrity"],
    detection: ["turnitin", "ai", "integrity"],
    denied: ["deny", "denial", "withheld", "redacted", "refuse"],
    deny: ["denied", "denial", "withheld"],
    foia: ["records", "request", "public", "data", "practices"],
    records: ["request", "public", "data"]
  };

  const STOP = new Set(["the", "a", "an", "is", "are", "was", "were", "do",
    "does", "did", "can", "i", "my", "me", "we", "our", "you", "your", "of",
    "to", "in", "on", "for", "at", "by", "with", "about", "what", "when",
    "how", "who", "where", "why", "and", "or", "it", "its", "be", "have",
    "has", "umn", "university", "minnesota", "u", "use", "using", "there",
    "allowed", "allow", "policy", "policies"]);

  // "allowed"/"policy" are stopped above because they appear in nearly every
  // entry; keep them as weak terms instead so they still break ties.
  const WEAK = new Set(["allowed", "allow", "policy", "policies", "use", "using"]);

  function tokenize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter(function (t) { return t.length > 1; });
  }

  function expandQuery(tokens) {
    const strong = [];
    const weak = [];
    tokens.forEach(function (t) {
      if (WEAK.has(t)) { weak.push(t); return; }
      if (STOP.has(t)) return;
      strong.push(t);
      (SYNONYMS[t] || []).forEach(function (s) { weak.push(s); });
    });
    return { strong: strong, weak: weak };
  }

  let DOCS = null;

  async function fetchJson(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function buildIndex() {
    if (DOCS) return DOCS;
    const base = document.body.getAttribute("data-base") || ".";
    const [faq, policies, contracts, history, compare] = await Promise.all([
      fetchJson(base + "/data/faq.json"),
      fetchJson(base + "/data/policies.json"),
      fetchJson(base + "/data/contracts.json"),
      fetchJson(base + "/data/history.json"),
      fetchJson(base + "/data/compare.json")
    ]);

    const docs = [];

    ((faq && faq.questions) || []).forEach(function (q) {
      docs.push({
        type: "Question & Answer",
        title: q.question,
        body: q.answer,
        keywords: (q.keywords || []).join(" "),
        href: q.related_page || null,
        sources: q.sources || [],
        boost: 2 // curated answers outrank raw documents
      });
    });

    ((policies && policies.policies) || []).forEach(function (p) {
      docs.push({
        type: "UMN Policy / Guidance",
        title: p.title,
        body: (p.summary || "") + " " + (p.key_points || []).join(" "),
        keywords: (p.category || "") + " " + (p.audience || []).join(" "),
        href: "policies.html#" + p.id,
        sources: p.url ? [{ title: p.source_org || "Official source", url: p.url }] : [],
        boost: 1
      });
    });

    ((contracts && contracts.contracts) || []).forEach(function (c) {
      docs.push({
        type: "Vendor Contract",
        title: c.vendor + " — " + c.product,
        body: (c.summary || "") + " " + (c.data_notes || ""),
        keywords: c.category || "",
        href: "contracts.html#" + c.id,
        sources: c.sources || [],
        boost: 1
      });
    });

    ((history && history.timeline) || []).forEach(function (e) {
      docs.push({
        type: "History",
        title: e.year + " — " + e.title,
        body: (e.description || "") + " " + (e.significance || ""),
        keywords: e.era || "",
        href: "history.html#y" + e.year + "-" + slug(e.title),
        sources: e.sources || [],
        boost: 0.8
      });
    });

    ((compare && compare.schools) || []).forEach(function (s) {
      docs.push({
        type: "School Comparison",
        title: s.school,
        body: (s.ai_guidance || "") + " " + (s.notable || "") + " " + (s.enterprise_ai_tools || "") + " LMS: " + (s.lms || ""),
        keywords: s.conference || "",
        href: "compare.html#" + s.id,
        sources: s.sources || [],
        boost: 0.7
      });
    });

    docs.forEach(function (d) {
      d.titleTokens = tokenize(d.title);
      d.keywordTokens = tokenize(d.keywords);
      d.bodyTokens = tokenize(d.body);
    });

    DOCS = docs;
    return docs;
  }

  function slug(text) {
    return tokenize(text).slice(0, 5).join("-");
  }

  function countHits(tokens, term) {
    let n = 0;
    for (let i = 0; i < tokens.length; i++) if (tokens[i] === term) n++;
    return n;
  }

  function scoreDoc(doc, q) {
    let score = 0;
    let strongMatched = 0;
    q.strong.forEach(function (term) {
      const inTitle = countHits(doc.titleTokens, term);
      const inKw = countHits(doc.keywordTokens, term);
      const inBody = countHits(doc.bodyTokens, term);
      if (inTitle + inKw + inBody > 0) strongMatched++;
      score += inTitle * 6 + inKw * 4 + Math.min(inBody, 3);
    });
    q.weak.forEach(function (term) {
      score += countHits(doc.titleTokens, term) * 2 +
               countHits(doc.keywordTokens, term) * 1.5 +
               (countHits(doc.bodyTokens, term) > 0 ? 0.5 : 0);
    });
    if (q.strong.length > 1 && strongMatched === q.strong.length) score *= 1.5;
    if (q.strong.length > 0 && strongMatched === 0) return 0;
    return score * doc.boost;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderResults(container, results, query) {
    if (!results.length) {
      container.innerHTML =
        '<div class="result-empty">No matches for &ldquo;' + escapeHtml(query) +
        '&rdquo;. Try other words (e.g. &ldquo;AI coursework&rdquo;, &ldquo;Canvas data&rdquo;, ' +
        '&ldquo;proctoring&rdquo;), or browse the <a href="policies.html">policy index</a>.</div>';
      container.hidden = false;
      return;
    }
    container.innerHTML = results.map(function (r) {
      const d = r.doc;
      const titleHtml = d.href
        ? '<a href="' + escapeHtml(d.href) + '">' + escapeHtml(d.title) + "</a>"
        : escapeHtml(d.title);
      const snippet = d.body.length > 220 ? d.body.slice(0, 217) + "…" : d.body;
      const sources = (d.sources || []).slice(0, 3).map(function (s) {
        return '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' +
          escapeHtml(s.title) + " ↗</a>";
      }).join("");
      return '<div class="result">' +
        '<span class="r-type">' + escapeHtml(d.type) + "</span>" +
        "<h4>" + titleHtml + "</h4>" +
        "<p>" + escapeHtml(snippet) + "</p>" +
        (sources ? '<div class="r-sources">' + sources + "</div>" : "") +
        "</div>";
    }).join("");
    container.hidden = false;
  }

  function initSearch() {
    const input = document.querySelector("[data-search-input]");
    const resultsBox = document.querySelector("[data-search-results]");
    if (!input || !resultsBox) return;

    let timer = null;

    async function run() {
      const query = input.value.trim();
      if (query.length < 2) { resultsBox.hidden = true; return; }
      const docs = await buildIndex();
      const q = expandQuery(tokenize(query));
      if (!q.strong.length && !q.weak.length) { resultsBox.hidden = true; return; }
      const scored = docs
        .map(function (d) { return { doc: d, score: scoreDoc(d, q) }; })
        .filter(function (r) { return r.score > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 8);
      renderResults(resultsBox, scored, query);
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(run, 140);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(timer);
        const query = input.value.trim();
        if (query.length) {
          window.location.href = "search.html?q=" + encodeURIComponent(query);
        }
      }
    });
    input.addEventListener("focus", function () {
      if (input.value.trim().length >= 2) run();
    });
    document.addEventListener("click", function (e) {
      if (!resultsBox.contains(e.target) && e.target !== input) resultsBox.hidden = true;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") resultsBox.hidden = true;
    });

    // Example-question buttons fill the search box.
    document.querySelectorAll("[data-example-q]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        input.value = btn.getAttribute("data-example-q");
        input.focus();
        run();
      });
    });

    buildIndex(); // warm the index in the background
  }

  /* Full-page results on search.html (?q=...). */
  function initSearchPage() {
    const input = document.querySelector("[data-search-page-input]");
    const container = document.querySelector("[data-search-page-results]");
    if (!input || !container) return;
    const countEl = document.getElementById("search-count");
    let timer = null;

    async function run(updateUrl) {
      const query = input.value.trim();
      if (query.length < 2) return;
      const docs = await buildIndex();
      const q = expandQuery(tokenize(query));
      const scored = docs
        .map(function (d) { return { doc: d, score: scoreDoc(d, q) }; })
        .filter(function (r) { return r.score > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 30);
      renderResults(container, scored, query);
      if (countEl) {
        countEl.textContent = scored.length
          ? scored.length + (scored.length === 1 ? " result" : " results") +
            " for “" + query + "”"
          : "";
      }
      if (updateUrl) {
        history.replaceState(null, "", "search.html?q=" + encodeURIComponent(query));
      }
      document.title = "Search: " + query + " — UMN Ed Tech Transparency Project";
    }

    const initial = (new URLSearchParams(window.location.search).get("q") || "").trim();
    if (initial) {
      input.value = initial;
      run(false);
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { run(true); }, 160);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(timer);
        run(true);
      }
    });
    input.focus();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initSearch();
    initSearchPage();
  });
})();
