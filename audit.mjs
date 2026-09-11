#!/usr/bin/env node
/**
 * HD Southern Development - build standard auditor.
 *
 * Checks a running site against the rules in the standard. Zero dependencies, Node 18+.
 * Exits 1 if any BLOCKER fails, so it can gate a deploy in CI.
 *
 *   node audit.mjs --url http://localhost:3000
 *   node audit.mjs --url https://example.co.uk --live
 *   node audit.mjs --url http://localhost:3000 --demo
 *
 * Modes:
 *   (default)  demo or pre-launch. Search-engine rules are relaxed.
 *   --demo     expect noindex and robots Disallow. Fails if the site IS indexable.
 *   --live     launched client site. Full strictness, including security headers.
 *
 * What this cannot check, and never claims to: colour contrast, keyboard operation,
 * screen reader behaviour, console errors, Core Web Vitals, and whether the content is true.
 * Those are in the standard as human checks. A green run here is necessary, not sufficient.
 */

const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1];
};
const BASE = (getArg("--url") || "http://localhost:3000").replace(/\/+$/, "");
const IS_DEMO = args.includes("--demo");
const IS_LIVE = args.includes("--live");

const results = [];
const add = (level, ok, name, detail = "") => results.push({ level, ok, name, detail });
const blocker = (ok, name, detail) => add("BLOCKER", ok, name, detail);
const warn = (ok, name, detail) => add("WARN", ok, name, detail);

// ---------- helpers ----------

const stripNoise = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
};

const metaContent = (html, key, kind = "name") => {
  const re = new RegExp(`<meta[^>]*${kind}\\s*=\\s*"${key}"[^>]*>`, "i");
  const m = html.match(re);
  return m ? attr(m[0], "content") : null;
};

async function get(path) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "hd-standards-audit" } });
    return { ok: true, status: res.status, headers: res.headers, body: await res.text(), url: res.url };
  } catch (e) {
    return { ok: false, status: 0, headers: new Headers(), body: "", url, error: String(e) };
  }
}

// Emoji and pictographic symbols commonly misused as icons.
// Deliberately excludes ordinary typography (middot, quotes, dashes, arrows below U+2B00).
// U+FE0F is the emoji variation selector and is a reliable giveaway on its own.
// Verified against a deliberately broken build: an unlisted range means a silent miss,
// which is how a star rating emoji slipped through the first version of this check.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

const PLACEHOLDERS = [
  "REPLACE_", "lorem ipsum", "Lorem Ipsum", "TODO", "FIXME",
  "Coming soon", "coming soon", "Your Business Name", "example.com",
];

// ---------- discover pages ----------

async function discoverPaths() {
  const sm = await get("/sitemap.xml");
  if (sm.ok && sm.status === 200 && sm.body.includes("<loc>")) {
    const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const paths = locs
      .map((l) => {
        try { return new URL(l).pathname || "/"; } catch { return null; }
      })
      .filter(Boolean);
    if (paths.length) return [...new Set(paths)];
  }
  return ["/", "/services", "/about", "/contact", "/privacy", "/terms"];
}

// ---------- site-level checks ----------

async function siteChecks() {
  const robots = await get("/robots.txt");
  blocker(robots.status === 200, "robots.txt served", `status ${robots.status}`);
  const rb = robots.body || "";

  if (IS_DEMO) {
    blocker(/Disallow:\s*\/\s*$/im.test(rb.trim()) || /Disallow:\s*\/$/m.test(rb),
      "demo robots.txt disallows crawling",
      "a demo carrying the prospect's name must not be indexable");
  } else if (IS_LIVE) {
    blocker(/Sitemap:\s*https?:\/\//i.test(rb), "robots.txt references sitemap with an absolute URL");
    blocker(!/Disallow:\s*\/\s*$/m.test(rb), "live site is not blocking all crawlers");
  }

  const sitemap = await get("/sitemap.xml");
  blocker(sitemap.status === 200 && sitemap.body.includes("<urlset"), "sitemap.xml served and valid",
    `status ${sitemap.status}`);

  const llms = await get("/llms.txt");
  blocker(llms.status === 200 && llms.body.trim().length > 40, "llms.txt served with real content",
    `status ${llms.status}`);

  // A custom 404 must both LOOK custom and return a real 404 status.
  const nf = await get(`/this-page-does-not-exist-${Date.now()}`);
  blocker(nf.status === 404, "unknown URL returns HTTP 404", `got ${nf.status}`);
  const nfText = stripNoise(nf.body).replace(/<[^>]+>/g, " ");
  blocker(/404|not found|moved/i.test(nfText) && nf.body.includes("<a"),
    "404 page is custom and offers navigation");

  if (IS_LIVE) {
    const home = await get("/");
    const h = home.headers;
    blocker(BASE.startsWith("https://"), "site served over HTTPS");
    blocker(!!h.get("strict-transport-security"), "HSTS header set");
    blocker(h.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
    blocker(!!h.get("referrer-policy"), "Referrer-Policy set");
    warn(!!h.get("content-security-policy"), "Content-Security-Policy set");
    warn(!!(h.get("x-frame-options") || (h.get("content-security-policy") || "").includes("frame-ancestors")),
      "clickjacking protection set");
    warn(!!h.get("permissions-policy"), "Permissions-Policy set");
  }
}

// ---------- page-level checks ----------

async function pageChecks(paths) {
  const titles = new Map();
  const descs = new Map();

  for (const path of paths) {
    const res = await get(path);
    const label = path;
    if (res.status !== 200) {
      blocker(false, `${label} returns 200`, `got ${res.status}`);
      continue;
    }
    const html = res.body;
    const clean = stripNoise(html);
    const text = clean.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    // Title
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
    blocker(title.trim().length > 0, `${label} has a <title>`);
    if (title) {
      if (titles.has(title)) blocker(false, `${label} title is unique`, `duplicate of ${titles.get(title)}`);
      else titles.set(title, label);
    }

    // Meta description
    const desc = metaContent(html, "description") || "";
    blocker(desc.trim().length > 0, `${label} has a meta description`);
    warn(desc.length >= 70 && desc.length <= 165, `${label} meta description length sensible`, `${desc.length} chars`);
    if (desc) {
      if (descs.has(desc)) blocker(false, `${label} meta description is unique`, `duplicate of ${descs.get(desc)}`);
      else descs.set(desc, label);
    }

    // Canonical
    const canonTag = (html.match(/<link[^>]*rel\s*=\s*"canonical"[^>]*>/i) || [])[0];
    const canon = canonTag ? attr(canonTag, "href") : null;
    blocker(!!canon, `${label} has a canonical link`);
    if (canon) blocker(/^https?:\/\//.test(canon), `${label} canonical is absolute`, canon);

    // Exactly one H1
    const h1s = (clean.match(/<h1[\s>]/gi) || []).length;
    blocker(h1s === 1, `${label} has exactly one <h1>`, `found ${h1s}`);

    // lang
    blocker(/<html[^>]*\slang\s*=\s*"[a-z]{2}/i.test(html), `${label} has a lang attribute`);

    // Indexability
    const robotsMeta = (metaContent(html, "robots") || "").toLowerCase();
    if (IS_DEMO) {
      blocker(robotsMeta.includes("noindex"), `${label} is noindex (demo)`);
    } else if (IS_LIVE) {
      blocker(!robotsMeta.includes("noindex"), `${label} is indexable (live site)`, robotsMeta);
    }

    // Copy rules
    const emDash = text.includes("\u2014");
    blocker(!emDash, `${label} contains no em dashes`,
      emDash ? (text.match(/.{0,40}\u2014.{0,40}/) || [""])[0].trim() : "");
    const emoji = text.match(EMOJI);
    blocker(!emoji, `${label} contains no emoji`, emoji ? `found ${emoji[0]}` : "");

    // Placeholder content
    const hit = PLACEHOLDERS.find((p) => html.includes(p));
    blocker(!hit, `${label} has no placeholder content`, hit || "");

    // Dead links
    const deadHref = /<a[^>]*href\s*=\s*"#"[^>]*>/i.test(clean);
    blocker(!deadHref, `${label} has no href="#" dead links`);

    // Images have alt (alt="" is valid for decorative)
    const imgs = clean.match(/<img[^>]*>/gi) || [];
    const noAlt = imgs.filter((t) => !/\salt\s*=/i.test(t));
    blocker(noAlt.length === 0, `${label} all <img> have an alt attribute`, `${noAlt.length} missing`);

    // Source maps must not be referenced in production
    blocker(!/sourceMappingURL/i.test(html), `${label} references no source maps`);

    // Home page only
    if (path === "/") {
      blocker(!!metaContent(html, "og:image", "property"), "home page has an og:image");
      blocker(/<link[^>]*rel\s*=\s*"(icon|shortcut icon)"/i.test(html), "home page declares a favicon");
      blocker(/"@type"\s*:\s*"[A-Za-z]*(LocalBusiness|Salon|Repair|Plumber|Restaurant|Store|Service)/i.test(html),
        "home page has LocalBusiness structured data");
    }
    if (path !== "/") {
      warn(/"@type"\s*:\s*"BreadcrumbList"/i.test(html), `${label} has BreadcrumbList structured data`);
    }
  }
}

// ---------- run ----------

const paths = await discoverPaths();
await siteChecks();
await pageChecks(paths);

const blockers = results.filter((r) => r.level === "BLOCKER" && !r.ok);
const warns = results.filter((r) => r.level === "WARN" && !r.ok);
const passed = results.filter((r) => r.ok).length;

const mode = IS_LIVE ? "live" : IS_DEMO ? "demo" : "pre-launch";
console.log(`\nHD Southern build standard audit  (${mode})  ${BASE}`);
console.log(`Pages checked: ${paths.length}\n`);

if (blockers.length) {
  console.log("FAILED (blocking):");
  for (const r of blockers) console.log(`  x ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  console.log("");
}
if (warns.length) {
  console.log("Warnings (not blocking):");
  for (const r of warns) console.log(`  ! ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  console.log("");
}
console.log(`${passed} passed, ${blockers.length} blocking failures, ${warns.length} warnings`);
console.log(
  "\nNot covered by this script and still required: colour contrast, keyboard pass,\n" +
  "screen reader pass, console errors, Core Web Vitals, image rights, and whether the\n" +
  "content is actually true. See the standard, section 16.\n",
);

process.exit(blockers.length ? 1 : 0);
