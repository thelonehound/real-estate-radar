/**
 * Real Estate Radar — Daily Digest Engine (FREE STACK)
 * Scheduler : GitHub Actions (free)
 * Search    : Serper (free — 2,500 queries/month)
 * AI        : Groq — Llama 3.3 70B (free, batched to stay under 12k TPM)
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
  groqApiKey:     process.env.GROQ_API_KEY,
  serperApiKey:   process.env.SERPER_API_KEY,
};

// ─── SEARCH BUCKETS (trimmed to 2 queries each to reduce volume) ─────────────
const SEARCH_BUCKETS = [
  { label: "India Residential Market",       queries: ["India residential real estate news today", "housing market India latest 2025"] },
  { label: "Indian Developers",              queries: ["DLF Godrej Lodha Prestige developer news today", "Indian real estate developer quarterly results 2025"] },
  { label: "Indian Brokers & PropTech",      queries: ["NoBroker MagicBricks 99acres news update 2025", "Indian proptech startup news today"] },
  { label: "Tier 1 Cities",                  queries: ["Mumbai Delhi Bengaluru real estate news today", "Hyderabad Chennai property market news 2025"] },
  { label: "Tier 2 Cities",                  queries: ["Pune Ahmedabad Jaipur real estate news 2025", "Indore Surat Lucknow property market update"] },
  { label: "New Projects & Launches",        queries: ["new residential project launch India today", "luxury affordable housing launch India 2025"] },
  { label: "RERA & Regulation",              queries: ["RERA update ruling news India 2025", "real estate regulation India latest"] },
  { label: "Government Policy & Budget",     queries: ["India housing policy budget announcement 2025", "PMAY affordable housing scheme update"] },
  { label: "RBI & Interest Rates",           queries: ["RBI repo rate home loan impact 2025", "home loan interest rate India news"] },
  { label: "PropTech Funding",               queries: ["India proptech real estate startup funding 2025", "proptech venture capital deal India"] },
  { label: "REITs & Capital Markets",        queries: ["India REIT Embassy Mindspace news 2025", "real estate private equity FDI India"] },
  { label: "REA Group & Global Portals",     queries: ["REA Group quarterly results news 2025", "PropertyFinder Rightmove Zoopla Zillow news 2025"] },
  { label: "Global Real Estate Trends",      queries: ["global real estate market outlook 2025", "Asia Pacific property market news"] },
  { label: "Macro & Construction",           queries: ["real estate headwinds tailwinds India 2025", "cement steel construction cost India real estate"] },
  { label: "Rental & Commercial",            queries: ["rental co-living market India news 2025", "India office space commercial real estate 2025"] },
];

// ─── BATCH SPLITS (5 buckets each → ~8-9k tokens per Groq call) ─────────────
const BATCHES = [
  SEARCH_BUCKETS.slice(0, 5),   // Indian market core
  SEARCH_BUCKETS.slice(5, 10),  // Launches, policy, regulation
  SEARCH_BUCKETS.slice(10, 15), // Capital, global, macro
];

// ─── SERPER SEARCH ───────────────────────────────────────────────────────────
async function searchWeb(query) {
  try {
    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: { "X-API-KEY": CONFIG.serperApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 4, gl: "in", hl: "en" }),
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
      await sleep(300);
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

// ─── GROQ CALL (single batch) ────────────────────────────────────────────────
async function callGroq(inputData, today, isFirstBatch) {
  // Trim each article to title + snippet only (no full content) to save tokens
  const trimmed = inputData.map((sec) => ({
    section:  sec.section,
    articles: sec.articles.slice(0, 5).map((a) => ({
      title:   a.title,
      snippet: (a.snippet || "").substring(0, 120), // hard cap per snippet
      source:  a.source,
      url:     a.url,
    })),
  }));

  const prompt = isFirstBatch
    ? `You are a real estate intelligence analyst. Today is ${today}.

Analyze this news data and return ONLY valid JSON, no markdown, no preamble:
${JSON.stringify(trimmed)}

Return this exact structure:
{
  "headline_summary": "2-sentence overview of the most important Indian RE development today",
  "top_stories": [
    {"headline":"...","summary":"2 sentences","why_it_matters":"1 sentence for REA India/Housing.com","source":"...","url":"...","category":"..."}
  ],
  "section_digests": [
    {"section":"...","summary":"1-2 sentences","items":[{"title":"...","summary":"1 sentence","source":"...","url":"..."}]}
  ],
  "market_pulse": {"tailwinds":["..."],"headwinds":["..."]},
  "competitor_watch": [{"company":"...","update":"1 sentence","url":"..."}]
}
Rules: top_stories max 6 items, section items max 2 per section, skip empty sections, preserve URLs exactly.`

    : `You are a real estate intelligence analyst. Today is ${today}.

Analyze this news data and return ONLY valid JSON, no markdown, no preamble:
${JSON.stringify(trimmed)}

Return this exact structure:
{
  "section_digests": [
    {"section":"...","summary":"1-2 sentences","items":[{"title":"...","summary":"1 sentence","source":"...","url":"..."}]}
  ],
  "global_radar": [{"player":"...","update":"1 sentence","url":"..."}],
  "policy_alert": {"has_alert":false,"items":[]}
}
Rules: section items max 2 per section, skip empty sections, preserve URLs exactly. Set has_alert true only for urgent RERA/RBI/budget news.`;

  // Wait 6 seconds between batches to respect TPM limits
  await sleep(65000); // 65s — full TPM window reset between batches

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.groqApiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data  = await res.json();
  const raw   = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.error("JSON parse failed:", clean.substring(0, 300));
    throw new Error("Groq returned invalid JSON");
  }
}

// ─── SYNTHESIZE — 3 BATCHED CALLS ────────────────────────────────────────────
async function synthesizeDigest(rawResults) {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata",
  });

  const toInputData = (buckets) =>
    buckets.map((bucket) => ({
      section:  bucket.label,
      articles: (rawResults[bucket.label] || []).slice(0, 5).map((i) => ({
        title:   i.title,
        snippet: i.snippet,
        source:  i.source,
        url:     i.link,
      })),
    }));

  console.log("  Calling Groq batch 1/3 (Indian market)...");
  const b1 = await callGroq(toInputData(BATCHES[0]), today, true);

  console.log("  Calling Groq batch 2/3 (launches, policy, regulation)...");
  const b2 = await callGroq(toInputData(BATCHES[1]), today, false);

  console.log("  Calling Groq batch 3/3 (capital, global, macro)...");
  const b3 = await callGroq(toInputData(BATCHES[2]), today, false);

  // Merge all three responses into one digest object
  return {
    date:             today,
    headline_summary: b1.headline_summary || "",
    top_stories:      b1.top_stories      || [],
    market_pulse:     b1.market_pulse     || { tailwinds: [], headwinds: [] },
    competitor_watch: b1.competitor_watch || [],
    section_digests:  [
      ...(b1.section_digests || []),
      ...(b2.section_digests || []),
      ...(b3.section_digests || []),
    ],
    global_radar:  b3.global_radar  || [],
    policy_alert:  b2.policy_alert  || b3.policy_alert || { has_alert: false, items: [] },
  };
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
    <tr><td style="padding:16px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
      <span style="display:inline-block;background:${catColor(s.category)};color:#444;font-size:10px;padding:2px 8px;border-radius:10px;margin-bottom:6px;font-family:Arial,sans-serif;">${s.category || "Update"}</span>
      <a href="${s.url}" style="display:block;font-size:15px;font-weight:600;color:#1a1a2e;text-decoration:none;margin-bottom:6px;font-family:Arial,sans-serif;line-height:1.4;">${s.headline}</a>
      <p style="margin:0 0 6px;font-size:13px;color:#444;line-height:1.6;font-family:Arial,sans-serif;">${s.summary}</p>
      <p style="margin:0;font-size:12px;color:#1976D2;font-family:Arial,sans-serif;"><strong>Why it matters:</strong> ${s.why_it_matters}</p>
      <p style="margin:6px 0 0;font-size:11px;color:#999;font-family:Arial,sans-serif;">${s.source}</p>
    </td></tr>`).join("");

  const sectionHTML = (digest.section_digests || []).map((sec) => `
    <tr><td style="padding:12px 16px 8px;border-top:1px solid #eee;">
      <p style="margin:0;font-size:12px;font-weight:700;color:#1a1a2e;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">${sec.section}</p>
      <p style="margin:4px 0 8px;font-size:13px;color:#555;line-height:1.5;font-family:Arial,sans-serif;">${sec.summary}</p>
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
<title>Real Estate Radar</title></head>
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
    <p style="margin:0;font-size:11px;color:#BDBDBD;font-family:Arial,sans-serif;">Real Estate Radar &middot; For Zubin Mistry, REA India &middot; Powered by Groq + Serper</p>
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

  console.log("\nSynthesizing with Groq (3 batches)...");
  const digest = await synthesizeDigest(rawResults);
  console.log(`  Top stories: ${digest.top_stories?.length || 0}`);
  console.log(`  Sections:    ${digest.section_digests?.length || 0}`);

  console.log("\nBuilding & sending email...");
  const html = buildEmailHTML(digest);
  await sendEmail(html, digest);

  console.log("\nDone.");
}

run().catch((err) => { console.error("Fatal:", err); process.exit(1); });
