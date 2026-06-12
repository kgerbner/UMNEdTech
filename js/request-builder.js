/* Interactive request-letter builder for records-request.html.
 * Rewrites the template letter live as the user picks a vendor, document
 * types, and a start year. No dependencies. */

(function () {
  "use strict";

  // Legal names and RFP subject phrasing per vendor. The Honorlock RFP year
  // is documented (2024); others use a generic subject the requester can edit.
  const VENDORS = [
    { id: "honorlock", label: "Honorlock (exam proctoring)", legal: "Honorlock, Inc.", rfp: "online exam proctoring services in 2024", since: 2024 },
    { id: "instructure", label: "Instructure (Canvas LMS)", legal: "Instructure, Inc. (Canvas learning management system)", rfp: "a learning management system", since: 2017 },
    { id: "google", label: "Google (Workspace / Gemini)", legal: "Google LLC (Google Workspace for Education and Gemini)", rfp: "email, collaboration, or generative AI services", since: 2020 },
    { id: "microsoft", label: "Microsoft (M365 / Copilot)", legal: "Microsoft Corporation (Microsoft 365 and Copilot)", rfp: "productivity software or generative AI services", since: 2020 },
    { id: "zoom", label: "Zoom", legal: "Zoom Video Communications, Inc.", rfp: "video conferencing services", since: 2019 },
    { id: "kaltura", label: "Kaltura (MediaSpace)", legal: "Kaltura, Inc. (MediaSpace media platform)", rfp: "media management services in 2021-2022", since: 2022 },
    { id: "turnitin", label: "Turnitin", legal: "Turnitin, LLC", rfp: "plagiarism or similarity detection services", since: 2015 },
    { id: "proctorio", label: "Proctorio (used 2017–2025)", legal: "Proctorio, Inc.", rfp: "online exam proctoring services in 2017", since: 2017 },
    { id: "qualtrics", label: "Qualtrics", legal: "Qualtrics, LLC", rfp: "survey platform services", since: 2015 },
    { id: "oracle", label: "Oracle (PeopleSoft)", legal: "Oracle America, Inc. (PeopleSoft)", rfp: "enterprise resource planning software licensing and maintenance", since: 2020 },
    { id: "salesforce", label: "Salesforce (CRM)", legal: "Salesforce, Inc. (CRM, Marketing Cloud, and Experience Cloud)", rfp: "constituent relationship management services", since: 2023 },
    { id: "unizin", label: "Unizin (consortium)", legal: "Unizin, Ltd.", rfp: "consortium membership and learning platform procurement", since: 2014 },
    { id: "coursera", label: "Coursera", legal: "Coursera, Inc.", rfp: "online course platform services", since: 2013 },
    { id: "custom", label: "Another vendor…", legal: "", rfp: "[describe the goods or services]", since: 2020 }
  ];

  function buildLetter(opts) {
    const items = [];

    let docs = "The current executed contract, master services agreement, or\n" +
      "   similar agreement between the University of Minnesota and\n" +
      "   " + opts.legal + ", including all amendments, renewals,\n" +
      "   statements of work, and order forms";
    const extras = [];
    if (opts.pricing) extras.push("pricing schedules");
    if (opts.addenda) extras.push("any data protection, privacy, or security addenda or exhibits");
    if (extras.length) docs += ",\n   together with " + extras.join(" and ");
    docs += ", for agreements in effect\n   at any time from January 1, " + opts.year + " to the present.";
    items.push(docs);

    if (opts.rfp) {
      items.push("The request for proposals (RFP) issued by the University for\n" +
        "   " + opts.rfpSubject + ", the winning vendor's\n" +
        "   proposal, and evaluation or scoring records, which became public\n" +
        "   data upon completion of the evaluation process under Minn. Stat.\n" +
        "   § 13.591, subd. 3(b).");
    }

    const numbered = items.map(function (text, i) { return (i + 1) + ". " + text; }).join("\n\n");

    return "To the Data Access and Privacy Office, University of Minnesota:\n\n" +
      "Pursuant to the Minnesota Government Data Practices Act, Minn. Stat.\n" +
      "ch. 13, I request access to and electronic copies (PDF preferred) of\n" +
      "the following public government data:\n\n" +
      numbered + "\n\n" +
      "Because I am requesting electronic copies of existing electronic\n" +
      "records, I anticipate minimal or no copy costs; please notify me\n" +
      "before incurring any charges. I note that under Minn. Stat. § 13.03,\n" +
      "subd. 3(c), no fee may be charged for separating public from\n" +
      "not-public data.\n\n" +
      "If any portion of these records is withheld or redacted, please cite\n" +
      "the specific statutory basis for each redaction as required by Minn.\n" +
      "Stat. § 13.03, subd. 3(f). I note that under Minn. Stat. § 13.37 the\n" +
      "burden of establishing trade-secret status rests on the claiming\n" +
      "party, and that the Minnesota Data Practices Office advises that\n" +
      "government contracts are generally public data.\n\n" +
      "Please confirm receipt of this request and respond in an appropriate\n" +
      "and prompt manner as required by Minn. Stat. § 13.03, subd. 2.\n\n" +
      "Thank you.";
  }

  function init() {
    const form = document.getElementById("request-builder");
    const output = document.getElementById("request-template");
    if (!form || !output) return;

    const vendorSel = document.getElementById("rb-vendor");
    const customWrap = document.getElementById("rb-custom-wrap");
    const customInput = document.getElementById("rb-custom");
    const yearInput = document.getElementById("rb-year");
    const addenda = document.getElementById("rb-addenda");
    const pricing = document.getElementById("rb-pricing");
    const rfp = document.getElementById("rb-rfp");
    const copyBtn = document.getElementById("rb-copy");

    VENDORS.forEach(function (v) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.label;
      vendorSel.appendChild(opt);
    });

    function current() {
      return VENDORS.find(function (v) { return v.id === vendorSel.value; }) || VENDORS[0];
    }

    function update(resetYear) {
      const v = current();
      customWrap.hidden = v.id !== "custom";
      if (resetYear) yearInput.value = v.since;
      const legal = v.id === "custom"
        ? (customInput.value.trim() || "[Vendor legal name (product)]")
        : v.legal;
      output.textContent = buildLetter({
        legal: legal,
        year: yearInput.value || "2020",
        addenda: addenda.checked,
        pricing: pricing.checked,
        rfp: rfp.checked,
        rfpSubject: v.rfp
      });
    }

    vendorSel.addEventListener("change", function () { update(true); });
    [customInput, yearInput].forEach(function (el) {
      el.addEventListener("input", function () { update(false); });
    });
    [addenda, pricing, rfp].forEach(function (el) {
      el.addEventListener("change", function () { update(false); });
    });

    copyBtn.addEventListener("click", function () {
      const text = output.textContent;
      function done(ok) {
        copyBtn.textContent = ok ? "Copied ✓" : "Copy failed — select the text manually";
        setTimeout(function () { copyBtn.textContent = "Copy request to clipboard"; }, 2500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        const range = document.createRange();
        range.selectNodeContents(output);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done(document.execCommand && document.execCommand("copy"));
        sel.removeAllRanges();
      }
    });

    update(true);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
