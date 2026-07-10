/* Page rendering: loads JSON data files and renders the policies, contracts,
 * history, comparison, and changelog views. No dependencies. */

(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function loadJson(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function verifiedBadge(status) {
    if (status === "verified") return '<span class="badge badge-verified">✓ human verified</span>';
    if (status === "partially-verified") return '<span class="badge badge-unverified">partially verified</span>';
    return '<span class="badge badge-unverified">unverified — treat with caution</span>';
  }

  function sourceLinks(sources) {
    if (!sources || !sources.length) return "";
    return '<div class="sources"><strong>Sources:</strong> ' +
      sources.map(function (s) {
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + " ↗</a>";
      }).join(" ") + "</div>";
  }

  /* After async rendering, the browser's initial anchor scroll has already
   * failed (the target didn't exist yet) — redo it and flag the target. */
  function scrollToHash() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    const el = document.getElementById(hash);
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView();
    el.classList.add("hash-target");
    setTimeout(function () { el.classList.remove("hash-target"); }, 2600);
  }

  /* ---------- Filterable entry lists (policies & contracts) ---------- */

  function setupFilters(toolbar, items, getCat, render) {
    const cats = Array.from(new Set(items.map(getCat))).sort();
    let active = "All";

    function draw() {
      toolbar.innerHTML = ["All"].concat(cats).map(function (c) {
        return '<button class="filter-btn' + (c === active ? " active" : "") +
          '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("");
      render(active === "All" ? items : items.filter(function (i) { return getCat(i) === active; }));
    }

    toolbar.addEventListener("click", function (e) {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      active = btn.getAttribute("data-cat");
      draw();
    });

    draw();
  }

  /* ---------- Policies page ---------- */

  async function renderPolicies() {
    const list = document.getElementById("policy-list");
    if (!list) return;

    const [data, status, changelog] = await Promise.all([
      loadJson("data/policies.json"),
      loadJson("data/status.json"),
      loadJson("data/changelog.json")
    ]);

    // Status bar: when the automated checker last ran.
    const bar = document.getElementById("status-bar");
    if (bar && status) {
      bar.innerHTML =
        '<span><span class="status-dot"></span><strong>Automated monitoring active.</strong></span>' +
        "<span>Last checked: " + esc(fmtDate(status.last_checked) || "not yet run") + "</span>" +
        "<span>Watching " + esc(status.watch_count || 0) + " official pages</span>" +
        (status.last_change_detected
          ? "<span>Last change detected: " + esc(fmtDate(status.last_change_detected)) + "</span>"
          : "<span>No changes detected since monitoring began</span>");
    }

    if (!data || !data.policies || !data.policies.length) {
      list.innerHTML = '<p class="loading">Policy data has not been loaded yet.</p>';
      return;
    }

    const recentIds = new Set(((changelog && changelog.entries) || [])
      .filter(function (e) { return (Date.now() - new Date(e.date)) < 30 * 864e5; })
      .map(function (e) { return e.policy_id; }));

    function render(items) {
      list.innerHTML = items.map(function (p) {
        return '<article class="entry" id="' + esc(p.id) + '">' +
          '<div class="entry-head">' +
          "<h3>" + (p.url
            ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + " ↗</a>"
            : esc(p.title)) + "</h3>" +
          '<span class="badge badge-cat">' + esc(p.category) + "</span>" +
          verifiedBadge(p.status) +
          (recentIds.has(p.id) ? '<span class="badge badge-new">recently changed</span>' : "") +
          (p.audience && p.audience.length
            ? '<span class="meta">For: ' + esc(p.audience.join(", ")) + "</span>" : "") +
          (p.last_updated ? '<span class="meta">Updated: ' + esc(p.last_updated) + "</span>" : "") +
          "</div>" +
          '<p class="summary">' + esc(p.summary) + "</p>" +
          (p.key_points && p.key_points.length
            ? '<ul class="key-points">' + p.key_points.map(function (k) {
                return "<li>" + esc(k) + "</li>";
              }).join("") + "</ul>"
            : "") +
          (p.url ? '<div class="sources"><strong>Source:</strong> <a href="' + esc(p.url) +
            '" target="_blank" rel="noopener">' + esc(p.source_org || p.url) + " ↗</a></div>" : "") +
          "</article>";
      }).join("");
    }

    const catToolbar = document.getElementById("policy-filters");
    const audToolbar = document.getElementById("policy-audience-filters");
    if (catToolbar && audToolbar) {
      const cats = Array.from(new Set(data.policies.map(function (p) { return p.category; }))).sort();
      const auds = ["faculty", "students", "staff", "community"];
      let activeCat = "All";
      let activeAud = "All";

      // Deep links like policies.html?audience=students preselect a filter.
      const param = (new URLSearchParams(window.location.search).get("audience") || "").toLowerCase();
      if (auds.indexOf(param) !== -1) activeAud = param;

      function apply() {
        render(data.policies.filter(function (p) {
          return (activeCat === "All" || p.category === activeCat) &&
                 (activeAud === "All" || (p.audience || []).indexOf(activeAud) !== -1);
        }));
      }

      function drawBar(toolbar, label, values, active, pretty) {
        toolbar.innerHTML = '<span class="toolbar-label">' + label + "</span>" +
          ["All"].concat(values).map(function (v) {
            return '<button class="filter-btn' + (v === active ? " active" : "") +
              '" data-val="' + esc(v) + '">' + esc(pretty ? pretty(v) : v) + "</button>";
          }).join("");
      }

      function drawBoth() {
        drawBar(catToolbar, "Topic:", cats, activeCat, null);
        drawBar(audToolbar, "For:", auds, activeAud, function (v) {
          return v === "All" ? "Everyone" : v.charAt(0).toUpperCase() + v.slice(1);
        });
        apply();
      }

      catToolbar.addEventListener("click", function (e) {
        const btn = e.target.closest(".filter-btn");
        if (!btn) return;
        activeCat = btn.getAttribute("data-val");
        drawBoth();
      });
      audToolbar.addEventListener("click", function (e) {
        const btn = e.target.closest(".filter-btn");
        if (!btn) return;
        activeAud = btn.getAttribute("data-val");
        drawBoth();
      });

      drawBoth();
    } else {
      render(data.policies);
    }
    scrollToHash();

    // Changelog of detected changes.
    const cl = document.getElementById("changelog");
    if (cl) {
      const entries = (changelog && changelog.entries) || [];
      cl.innerHTML = entries.length
        ? entries.slice(0, 25).map(function (e) {
            return '<li><span class="cl-date">' + esc((e.date || "").slice(0, 10)) + "</span>" +
              "<span>" + esc(e.description) +
              (e.url ? ' — <a href="' + esc(e.url) + '" target="_blank" rel="noopener">view page ↗</a>' : "") +
              "</span></li>";
          }).join("")
        : '<li><span class="cl-date">—</span><span>No policy changes detected yet. ' +
          "The weekly checker records anything it finds here.</span></li>";
    }
  }

  /* ---------- Contracts page ---------- */

  async function renderContracts() {
    const list = document.getElementById("contract-list");
    if (!list) return;
    const data = await loadJson("data/contracts.json");
    if (!data || !data.contracts || !data.contracts.length) {
      list.innerHTML = '<p class="loading">Contract data has not been loaded yet.</p>';
      return;
    }

    function render(items) {
      list.innerHTML = items.map(function (c) {
        return '<article class="entry" id="' + esc(c.id) + '">' +
          '<div class="entry-head">' +
          "<h3>" + esc(c.vendor) + " — " + esc(c.product) + "</h3>" +
          '<span class="badge badge-cat">' + esc(c.category) + "</span>" +
          verifiedBadge(c.status) +
          (c.since ? '<span class="meta">In use since: ' + esc(c.since) + "</span>" : "") +
          "</div>" +
          '<p class="summary">' + esc(c.summary) + "</p>" +
          "<p><strong>What we know about data handling:</strong> " + esc(c.data_notes) + "</p>" +
          sourceLinks(c.sources) +
          "</article>";
      }).join("");
    }

    const toolbar = document.getElementById("contract-filters");
    if (toolbar) {
      setupFilters(toolbar, data.contracts, function (c) { return c.category; }, render);
    } else {
      render(data.contracts);
    }
    scrollToHash();
  }

  /* ---------- FAQ page ---------- */

  async function renderFaq() {
    const list = document.getElementById("faq-list");
    if (!list) return;
    const data = await loadJson("data/faq.json");
    if (!data || !data.questions || !data.questions.length) {
      list.innerHTML = '<p class="loading">Questions have not been loaded yet.</p>';
      return;
    }
    list.innerHTML = data.questions.map(function (q) {
      return '<article class="entry" id="' + esc(q.id) + '">' +
        "<h3>" + esc(q.question) + "</h3>" +
        '<p class="summary">' + esc(q.answer) + "</p>" +
        sourceLinks(q.sources) +
        (q.related_page
          ? '<p style="margin:0.6rem 0 0;font-size:0.9rem"><a href="' + esc(q.related_page) +
            '">More on this topic →</a></p>'
          : "") +
        "</article>";
    }).join("");
    scrollToHash();
  }

  /* ---------- History page ---------- */

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/).filter(function (t) { return t.length > 1; })
      .slice(0, 5).join("-");
  }

  async function renderHistory() {
    const container = document.getElementById("timeline-container");
    if (!container) return;
    const data = await loadJson("data/history.json");
    if (!data || !data.timeline || !data.timeline.length) {
      container.innerHTML = '<p class="loading">Timeline data has not been loaded yet.</p>';
      return;
    }

    const events = data.timeline.slice().sort(function (a, b) { return a.year - b.year; });
    const eras = [];
    events.forEach(function (e) {
      let era = eras[eras.length - 1];
      if (!era || era.name !== e.era) {
        era = { name: e.era, events: [] };
        eras.push(era);
      }
      era.events.push(e);
    });

    const jumpNav = '<nav class="jump-nav" aria-label="Jump to era">' +
      eras.map(function (era) {
        return '<a href="#era-' + slug(era.name) + '">' + esc(era.name) + "</a>";
      }).join("") + "</nav>";

    container.innerHTML = jumpNav + eras.map(function (era) {
      return '<h2 class="era-label" id="era-' + slug(era.name) + '">' + esc(era.name) + "</h2>" +
        '<ol class="timeline">' + era.events.map(function (e) {
          return '<li id="y' + e.year + "-" + slug(e.title) + '">' +
            '<span class="tl-year">' + esc(e.date_detail || e.year) + "</span> " +
            (e.status !== "verified" ? verifiedBadge(e.status) : "") +
            "<h3>" + esc(e.title) + "</h3>" +
            "<p>" + esc(e.description) + "</p>" +
            (e.significance ? '<p class="tl-significance">' + esc(e.significance) + "</p>" : "") +
            (e.sources && e.sources.length
              ? '<div class="tl-sources">' + e.sources.map(function (s) {
                  return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + " ↗</a>";
                }).join(" ") + "</div>"
              : "") +
            "</li>";
        }).join("") + "</ol>";
    }).join("");
    scrollToHash();
  }

  /* ---------- Comparison page ---------- */

  async function renderCompare() {
    const tbody = document.getElementById("compare-body");
    if (!tbody) return;
    const data = await loadJson("data/compare.json");
    if (!data || !data.schools || !data.schools.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading">Comparison data has not been loaded yet.</td></tr>';
      return;
    }

    let schools = data.schools.slice();
    // UMN first by default, then alphabetical.
    schools.sort(function (a, b) {
      const aU = /minnesota/i.test(a.school) ? 0 : 1;
      const bU = /minnesota/i.test(b.school) ? 0 : 1;
      return aU - bU || a.school.localeCompare(b.school);
    });

    function cellSources(s) {
      return (s.sources || []).slice(0, 2).map(function (src) {
        return '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.title) + " ↗</a>";
      }).join("<br>");
    }

    function render(rows) {
      tbody.innerHTML = rows.map(function (s) {
        const isUmn = /minnesota/i.test(s.school) && !/michigan|m state/i.test(s.school);
        return '<tr id="' + esc(s.id) + '"' + (isUmn ? ' class="is-umn"' : "") + ">" +
          '<td class="school-name">' + esc(s.school) +
          '<span class="conf">' + esc(s.conference) + "</span></td>" +
          "<td>" + esc(s.lms) + "</td>" +
          "<td>" + esc(s.ai_guidance) +
          (s.ai_guidance_url
            ? ' <a href="' + esc(s.ai_guidance_url) + '" target="_blank" rel="noopener">↗</a>' : "") +
          "</td>" +
          "<td>" + esc(s.enterprise_ai_tools) + "</td>" +
          "<td>" + esc(s.notable) + "</td>" +
          "<td>" + cellSources(s) + "</td>" +
          "</tr>";
      }).join("");
    }

    render(schools);
    scrollToHash();

    // Column sorting with a visible indicator of the current sort.
    const keys = ["school", "lms", "ai_guidance", "enterprise_ai_tools", "notable", null];
    const headers = document.querySelectorAll("table.compare th");
    let sortKey = null, dir = 1;

    function updateArrows() {
      headers.forEach(function (th, i) {
        const arrow = th.querySelector(".sort-arrow");
        if (!arrow) return;
        if (keys[i] === sortKey) {
          arrow.textContent = dir > 0 ? "▲" : "▼";
          th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
        } else {
          arrow.textContent = "⇅";
          th.removeAttribute("aria-sort");
        }
      });
    }

    headers.forEach(function (th, i) {
      if (!keys[i]) return;
      th.addEventListener("click", function () {
        dir = (sortKey === keys[i]) ? -dir : 1;
        sortKey = keys[i];
        schools.sort(function (a, b) {
          return String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")) * dir;
        });
        render(schools);
        updateArrows();
      });
    });

    const notes = document.getElementById("compare-notes");
    if (notes && data.patterns) {
      notes.innerHTML = "<p>" + esc(data.patterns) + "</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderPolicies();
    renderContracts();
    renderHistory();
    renderCompare();
    renderFaq();
  });
})();
