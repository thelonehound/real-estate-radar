/**
 * Real Estate Radar — Daily Digest Engine (FREE STACK)
 * Scheduler : GitHub Actions (free)
 * Search    : Serper (free — 2,500 queries/month)
 * AI        : Google Gemini 1.5 Flash (free — 1,500 req/day)
 * Email     : Gmail SMTP via Nodemailer (free)
 *
 * For Zubin Mistry, REA India
 */

const nodemailer = require("nodemailer");

const CONFIG = {
  recipientEmail: "zubin.mistry@housing.com",
  fallbackEmail:  "mrzubinmistry@gmail.com",
  senderEmail:    process.env.GMAIL_USER,
  senderPassword: process.env.GMAIL_APP_PASSWORD,
  geminiApiKey:   process.env.GEMINI_API_KEY,
  serperApiKey:   process.env.SERPER_API_KEY,
};

// ─── SEARCH BUCKETS ──────────────────────────────────────────────────────────
const SEARCH_BUCKETS = [
  { label: "India Residential Market",      queries: ["India residential real estate news today", "housing market India latest updates", "property prices India 2025"] },
  { label: "Indian Developers",             queries: ["DLF Godrej Properties Lodha Prestige news today", "Indian real estate developer launches 2025", "top developer quarterly results India realty"] },
  { label: "Indian Brokers & PropTech",     queries: ["NoBroker news update 2025", "MagicBricks 99acres Housing.com update", "Indian proptech startup news today"] },
  { label: "Tier 1 Cities",                 queries: ["Mumbai real estate news today", "Delhi NCR Gurgaon property market news", "Bengaluru Hyderabad real estate latest"] },
  { label: "Tier 2 Cities",                 queries: ["Pune Ahmedabad Jaipur real estate news", "Tier 2 city property market India 2025", "Indore Surat Lucknow real estate update"] },
  { label: "New Projects & Launches",       queries: ["new residential project launch India today", "luxury housing launch India 2025", "affordable housing project launch India"] },
  { label: "RERA & Regulation",             queries: ["RERA update news India 2025", "real estate regulation India latest", "RERA penalty order ruling news"] },
  { label: "Government Policy & Budget",    queries: ["India government housing policy update 2025", "budget real estate sector India announcement", "PMAY affordable housing scheme update"] },
  { label: "RBI & Interest Rates",          queries: ["RBI repo rate impact housing loan 2025", "home loan interest rate India news", "RBI monetary policy real estate impact"] },
  { label: "Land Acquisition & Zoning",     queries: ["land acquisition news India realty", "FSI change zoning notification India 2025"] },
  { label: "PropTech Funding",              queries: ["India proptech funding investment 2025", "real estate startup funding India today", "proptech venture capital deal India"] },
  { label: "REITs & Capital Markets",       queries: ["India REIT news 2025", "Embassy Mindspace Nexus REIT update", "real estate private equity India news"] },
  { label: "FDI & Institutional Investment",queries: ["FDI real estate India 2025", "institutional investor real estate India news"] },
  { label: "REA Group",                     queries: ["REA Group news quarterly results 2025", "REA Group realestate.com.au update"] },
  { label: "Zillow & US Market",            queries: ["Zillow news quarterly results 2025", "US housing market update today", "Opendoor Redfin news 2025"] },
  { label: "Global Portals",               queries: ["PropertyFinder Dubizzle news 2025", "Rightmove Zoopla UK property news"] },
  { label: "Global Real Estate Trends",     queries: ["global real estate market outlook 2025", "Asia Pacific property market news"] },
  { label: "Macro Headwinds & Tailwinds",   queries: ["real estate sector headwinds tailwinds India 2025", "inflation impact housing market India"] },
  { label: "Construction & Materials",      queries: ["cement steel construction cost India 2025", "infrastructure development impact real estate"] },
  { label: "Rental Market",                 queries: ["rental market India news 2025", "co-living managed rental India update"] },
  { label: "Commercial Real Estate",        queries: ["India office space leasing news 2025", "commercial real estate India update today"] },
  { label: "NoBroker Deep Dive",            queries: ["NoBroker update strategy news 2025", "NoBroker IPO funding growth news"] },
  { label: "MagicBricks & 99Acres",         queries: ["MagicBricks news update 2025", "99acres PropTiger news update 2025"] },
];

// ─── SERPER SEARCH ───────────────────────────────────────────────────────────
async function searchWeb(query) {
  try {
    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: { "X-API-KEY": CONFIG.serperApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 5, gl: "in", hl: "en" }),
    });
    const data = await res.json();
    return (data.news || []).map((item) => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
      source:  item.source,
      date:    item.date,
    }));
  } catch (err) {
    console.error(`Search failed for "${query}":`, err.message);
    return [];
  }
}

async function sweepAllBuckets() {
  console.log(`Starting web sweep across ${SEARCH_BUCKETS.length} buckets...`);
  const results = {};
  for (const bucket of SEARCH_BUCKETS) {
    const bucketResults = [];
    for (const query of bucket.queries) {
      const items = await searchWeb(query);
      bucketResults.push(...items);
      await sleep(350);
    }
    const seen = new Set();
    results[bucket.label] = bucketResults.filter((item) => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });
    console.log(`  ✓ ${bucket.label}: ${results[bucket.label].length} articles`);
  }
  return results;
}

// ─── GEMINI SYNTHESIS ────────────────────────────────────────────────────────
async function synthesizeDigest(rawResults) {
  const inputData = Object.entries(rawResults).map(([label, items]) => ({
    section:  label,
    articles: items.slice(0, 7).map((i) => ({
      title:   i.title,
      snippet: i.snippet,
      source:  i.source,
      date:    i.date,
      url:     i.link,
    })),
  }));

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata",
  });

  const prompt = `You are a senior real estate intelligence analyst preparing a daily briefing for Zubin Mistry, who works in the CEO office at REA India (Housing.com) and is deeply embedded in India's real estate sector strategy.

Today is ${today}.

Here is the raw search data collected from across the web today:
${JSON.stringify(inputData, null, 2)}

Your task: Produce a clean, high-signal daily digest in JSON format.

Return ONLY this JSON structure, nothing else, no markdown fences:
{
  "date": "${today}",
  "headline_summary": "3-sentence overview of the single most important development today across Indian RE",
  "top_stories": [
    {
      "headline": "...",
      "summary": "2-3 sentences",
      "why_it_matters": "1 sentence relevance to REA India / Housing.com",
      "source": "...",
      "url": "...",
      "category": "..."
    }
  ],
  "section_digests": [
    {
      "section": "...",
      "summary": "2-3 sentence synthesis",
      "items": [
        { "title": "...", "summary": "1 sentence", "source": "...", "url": "..." }
      ]
    }
  ],
  "market_pulse": {
    "tailwinds": ["positive macro factors from today's news"],
    "headwinds": ["negative macro factors from today's news"]
  },
  "competitor_watch": [
    { "company": "...", "update": "1-2 sentences", "url": "..." }
  ],
  "global_radar": [
    { "player": "...", "update": "1-2 sentences", "url": "..." }
  ],
  "policy_alert": {
    "has_alert": false,
    "items": []
  }
}

Rules:
- top_stories: 8-12 items, highest signal only
- section_digests: 2-4 items per section, skip sections with no meaningful news
- Preserve all URLs exactly as received
- Return ONLY valid JSON, no preamble, no markdown`;

  // Gemini 1.5 Flash — free tier
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiApiKey}`;

  const res = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.error("JSON parse failed, raw output:", clean.substring(0, 500));
    throw new Error("Gemini returned invalid JSON");
  }
}

// ─── HTML EMAIL BUILDER ──────────────────────────────────────────────────────
function buildEmailHTML(digest) {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata",
  });

  const catColor = (cat = "") => {
    const c = cat.toLowerCase();
    if (c.includes("policy") || c.includes("rera") || c.includes("govt")) return "#E8F5E9";
    if (c.includes("fund") || c.includes("invest") || c.includes("reit")) return "#FFF8E1";
    if (c.includes("global") || c.includes("rea") || c.includes("zillow")) return "#E3F2FD";
    if (c.includes("competitor") || c.includes("broker") || c.includes("proptech")) return "#FCE4EC";
    return "#F3E5F5";
  };

  const topStoriesHTML = (digest.top_stories || []).map((s) => `
    <tr>
      <td style="padding:16px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
        <span style="display:inline-block;background:${catColor(s.category)};color:#444;font-size:10px;padding:2px 8px;border-radius:10px;margin-bottom:6px;font-family:Arial,sans-serif;">${s.category || "Update"}</span>
        <a href="${s.url}" style="display:block;font-size:15px;font-weight:600;color:#1a1a2e;text-decoration:none;margin-bottom:6px;font-family:Arial,sans-serif;line-height:1.4;">${s.headline}</a>
        <p style="margin:0 0 6px;font-size:13px;color:#444;line-height:1.6;font-family:Arial,sans-serif;">${s.summary}</p>
        <p style="margin:0;font-size:12px;color:#1976D2;font-family:Arial,sans-serif;"><strong>Why it matters:</strong> ${s.why_it_matters}</p>
        <p style="margin:6px 0 0;font-size:11px;color:#999;font-family:Arial,sans-serif;">${s.source}</p>
      </td>
    </tr>`).join("");

  const sectionHTML = (digest.section_digests || []).map((sec) => `
    <tr><td style="padding:12px 16px 4px;border-top:1px solid #eee;">
      <p style="margin:0;font-size:12px;font-weight:700;color:#1a1a2e;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">${sec.section}</p>
      <p style="margin:4px 0 10px;font-size:13px;color:#555;line-height:1.5;font-family:Arial,sans-serif;">${sec.summary}</p>
      ${(sec.items || []).map((item) => `
        <p style="margin:0 0 8px;padding-left:12px;border-left:3px solid #E0E0E0;font-family:Arial,sans-serif;">
          <a href="${item.url}" style="font-size:13px;color:#1565C0;text-decoration:none;font-weight:500;">${item.title}</a>
          <span style="display:block;font-size:12px;color:#666;margin-top:2px;">${item.summary}</span>
          <span style="font-size:11px;color:#aaa;">${item.source}</span>
        </p>`).join("")}
    </td></tr>`).join("");

  const tailwindsHTML = (digest.market_pulse?.tailwinds || []).map((t) =>
    `<li style="font-size:13px;color:#2E7D32;margin-bottom:4px;font-family:Arial,sans-serif;">&#8593; ${t}</li>`).join("");

  const headwindsHTML = (digest.market_pulse?.headwinds || []).map((h) =>
    `<li style="font-size:13px;color:#C62828;margin-bottom:4px;font-family:Arial,sans-serif;">&#8595; ${h}</li>`).join("");

  const competitorHTML = (digest.competitor_watch || []).map((c) => `
    <tr><td style="padding:10px 16px;border-bottom:1px solid #f5f5f5;">
      <a href="${c.url}" style="font-size:13px;font-weight:600;color:#1565C0;text-decoration:none;font-family:Arial,sans-serif;">${c.company}</a>
      <p style="margin:3px 0 0;font-size:12px;color:#555;font-family:Arial,sans-serif;">${c.update}</p>
    </td></tr>`).join("");

  const globalHTML = (digest.global_radar || []).map((g) => `
    <tr><td style="padding:10px 16px;border-bottom:1px solid #f5f5f5;">
      <a href="${g.url}" style="font-size:13px;font-weight:600;color:#1565C0;text-decoration:none;font-family:Arial,sans-serif;">${g.player}</a>
      <p style="margin:3px 0 0;font-size:12px;color:#555;font-family:Arial,sans-serif;">${g.update}</p>
    </td></tr>`).join("");

  const policyBanner = digest.policy_alert?.has_alert ? `
    <tr><td style="padding:0 32px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E1;border-left:4px solid #F9A825;border-radius:4px;">
        <tr><td style="padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#E65100;font-family:Arial,sans-serif;">&#9889; POLICY ALERT</p>
          ${(digest.policy_alert.items || []).map((p) => `
            <a href="${p.url}" style="display:block;font-size:13px;font-weight:500;color:#B71C1C;text-decoration:none;margin-bottom:4px;font-family:Arial,sans-serif;">${p.title}</a>
            <p style="margin:0 0 6px;font-size:12px;color:#555;font-family:Arial,sans-serif;">${p.summary}</p>`).join("")}
        </td></tr>
      </table>
    </td></tr>` : "";

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Real Estate Radar — ${today}</title></head>
<body style="margin:0;padding:0;background:#F5F5F5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#F5F5F5">
<tr><td align="center" style="padding:24px 16px;">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:8px;overflow:hidden;">

  <tr><td style="background:#1a1a2e;padding:28px 32px;">
    <p style="margin:0 0 4px;font-size:11px;color:#90CAF9;letter-spacing:1.5px;font-family:Arial,sans-serif;">DAILY INTEL DIGEST</p>
    <h1 style="margin:0 0 4px;font-size:22px;color:#fff;font-weight:700;font-family:Arial,sans-serif;">Real Estate Radar</h1>
    <p style="margin:0;font-size:13px;color:#B0BEC5;font-family:Arial,sans-serif;">${today} &middot; Auto-generated at 8:00 AM IST</p>
  </td></tr>

  <tr><td style="padding:20px 32px 16px;">
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#9E9E9E;letter-spacing:1px;font-family:Arial,sans-serif;">TODAY'S HEADLINE</p>
    <p style="margin:0;font-size:15px;color:#1a1a2e;line-height:1.7;font-family:Arial,sans-serif;">${digest.headline_summary || ""}</p>
  </td></tr>

  ${policyBanner}

  <tr><td style="padding:0 32px 8px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#9E9E9E;letter-spacing:1px;font-family:Arial,sans-serif;">TOP STORIES</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EEE;border-radius:6px;overflow:hidden;">${topStoriesHTML}</table>
  </td></tr>

  <tr><td style="padding:16px 32px 8px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#9E9E9E;letter-spacing:1px;font-family:Arial,sans-serif;">MARKET PULSE</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="padding-right:8px;vertical-align:top;">
        <div style="background:#F1F8E9;border-radius:6px;padding:12px 14px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#2E7D32;font-family:Arial,sans-serif;">TAILWINDS</p>
          <ul style="margin:0;padding-left:16px;">${tailwindsHTML}</ul>
        </div>
      </td>
      <td width="50%" style="padding-left:8px;vertical-align:top;">
        <div style="background:#FFEBEE;border-radius:6px;padding:12px 14px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#C62828;font-family:Arial,sans-serif;">HEADWINDS</p>
          <ul style="margin:0;padding-left:16px;">${headwindsHTML}</ul>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:16px 32px 8px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#9E9E9E;letter-spacing:1px;font-family:Arial,sans-serif;">COMPETITOR WATCH</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EEE;border-radius:6px;overflow:hidden;">${competitorHTML}</table>
  </td></tr>

  <tr><td style="padding:16px 32px 8px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#9E9E9E;letter-spacing:1px;font-family:Arial,sans-serif;">GLOBAL RADAR</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EEE;border-radius:6px;overflow:hidden;">${globalHTML}</table>
  </td></tr>

  <tr><td style="padding:16px 32px 8px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#9E9E9E;letter-spacing:1px;font-family:Arial,sans-serif;">FULL SECTOR SWEEP</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EEE;border-radius:6px;overflow:hidden;">${sectionHTML}</table>
  </td></tr>

  <tr><td style="background:#FAFAFA;border-top:1px solid #EEE;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#BDBDBD;font-family:Arial,sans-serif;">Real Estate Radar &middot; For Zubin Mistry, REA India &middot; Powered by Gemini + Serper</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ─── EMAIL SENDER ─────────────────────────────────────────────────────────────
async function sendEmail(html, digest) {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Kolkata",
  });
  const subject = `RE Radar · ${today} · ${(digest.top_stories?.[0]?.headline || "Today's Roundup").substring(0, 65)}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: CONFIG.senderEmail, pass: CONFIG.senderPassword },
  });

  for (const to of [CONFIG.recipientEmail, CONFIG.fallbackEmail]) {
    try {
      await transporter.sendMail({ from: `Real Estate Radar <${CONFIG.senderEmail}>`, to, subject, html });
      console.log(`Email sent to ${to}`);
      return;
    } catch (err) {
      console.error(`Failed to send to ${to}: ${err.message}. Trying next...`);
    }
  }
  throw new Error("All email recipients failed.");
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log("=".repeat(60));
  console.log(`Real Estate Radar — ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  const rawResults = await sweepAllBuckets();
  const total = Object.values(rawResults).reduce((s, a) => s + a.length, 0);
  console.log(`\nTotal articles collected: ${total}`);

  console.log("\nSynthesizing with Gemini...");
  const digest = await synthesizeDigest(rawResults);
  console.log(`  Top stories: ${digest.top_stories?.length || 0}`);
  console.log(`  Sections:    ${digest.section_digests?.length || 0}`);

  console.log("\nBuilding & sending email...");
  const html = buildEmailHTML(digest);
  await sendEmail(html, digest);

  console.log("\nDone.");
}

run().catch((err) => { console.error("Fatal:", err); process.exit(1); });
