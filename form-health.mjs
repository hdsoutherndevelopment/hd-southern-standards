#!/usr/bin/env node
/**
 * HD Southern Development - form health check.
 *
 * The failure this exists to catch: a contact form stops saving, nothing errors anywhere
 * visible, no notification email is sent (by definition), and the client loses leads for weeks
 * before anyone notices. Nothing else in the stack detects it, because a broken form is silent.
 *
 * Two independent checks per site, both useful on their own:
 *   1. SUBMIT   - actually POST a marked test enquiry and confirm it is accepted AND stored.
 *   2. FRESHNESS - flag a table that used to receive enquiries and has gone unusually quiet.
 *
 * Test rows are marked and deleted afterwards so they never pollute real client leads.
 *
 * Env:
 *   SUPABASE_URL           https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY   service role key. Required for storage verification and cleanup.
 *
 * Usage:
 *   node form-health.mjs                 # all configured sites
 *   node form-health.mjs --only <name>
 *   node form-health.mjs --no-submit     # freshness checks only, sends nothing
 *
 * Exit code 1 if any check fails, so CI can alert.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const noSubmit = args.includes("--no-submit");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const MARKER = "hd-health-check";
const config = JSON.parse(readFileSync(join(__dir, "sites.json"), "utf8"));

const problems = [];
const notes = [];
const fail = (site, msg) => problems.push(`${site}: ${msg}`);
const note = (msg) => notes.push(msg);

function sbHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function latestRows(table, limit = 200) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=created_at,source&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Freshness, judged against the table's OWN normal rhythm rather than a fixed number of days.
 * A local business genuinely goes quiet for a week, so a fixed threshold cries wolf constantly
 * and gets ignored, which is worse than no check at all.
 */
async function checkFreshness(site) {
  const table = site.supabase?.table;
  if (!table) return;

  // Misconfiguration is not an outage. Reporting "your forms are dropping leads" because a
  // key is missing is the fastest way to make these alerts ignored, and an ignored alert is
  // worse than no alert. Say what is actually wrong.
  if (!SUPABASE_URL || !SERVICE_KEY) {
    fail(
      site.name,
      `cannot check ${table}: SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. This is a configuration problem with the checker, not evidence that anything is wrong with the site.`,
    );
    return;
  }

  let rows;
  try {
    rows = await latestRows(table);
  } catch (e) {
    const paused = /paus|not found|503|502/i.test(e.message);
    fail(
      site.name,
      paused
        ? `cannot read ${table} (${e.message}). If the Supabase project is paused, every live enquiry form is dropping leads right now. Check this first.`
        : `cannot read ${table} (${e.message}).`,
    );
    return;
  }

  const real = rows.filter((r) => r.source !== MARKER);
  if (real.length === 0) {
    note(`${site.name}: ${table} has never received a real enquiry. Normal for a new site; worth investigating if it has been live a while.`);
    return;
  }

  const times = real.map((r) => new Date(r.created_at).getTime()).sort((a, b) => b - a);
  const daysSince = (Date.now() - times[0]) / 86400000;

  // Median gap between the last 20 enquiries, as this table's own baseline.
  const gaps = [];
  for (let i = 0; i < Math.min(times.length - 1, 20); i++) {
    gaps.push((times[i] - times[i + 1]) / 86400000);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  if (median && daysSince > Math.max(median * 4, 10)) {
    fail(
      site.name,
      `${table} has had no enquiry for ${daysSince.toFixed(0)} days, against a normal gap of about ${median.toFixed(1)} days. Worth checking the form still works.`,
    );
  } else {
    note(`${site.name}: last enquiry ${daysSince.toFixed(1)} days ago, normal gap about ${median ? median.toFixed(1) : "?"} days. Looks healthy.`);
  }
}

/** Actually submit a test enquiry end to end, then verify it stored, then clean it up. */
async function checkSubmit(site) {
  if (!site.form?.endpoint) {
    note(`${site.name}: no form endpoint configured, submission test skipped (not the same as passing).`);
    return;
  }
  const endpoint = site.form.endpoint.startsWith("http")
    ? site.form.endpoint
    : `${site.url.replace(/\/+$/, "")}${site.form.endpoint}`;

  const stamp = `${MARKER}-${Date.now()}`;
  const payload = { ...(site.form.payload || {}), source: MARKER, message: `Automated health check ${stamp}. Please ignore.` };

  let res;
  try {
    res = await fetch(endpoint, {
      method: site.form.method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    fail(site.name, `form endpoint unreachable: ${e.message}`);
    return;
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    fail(site.name, `form POST returned ${res.status}. Enquiries are very likely being lost. ${body}`);
    return;
  }

  // Accepted is not the same as stored. A 200 from a handler that then failed to write is
  // exactly the silent failure this whole script exists to catch, so verify the row landed.
  const table = site.supabase?.table;
  if (!table || !SERVICE_KEY) {
    note(`${site.name}: form accepted the submission, but storage was not verified (no service key or table configured).`);
    return;
  }

  await new Promise((r) => setTimeout(r, 2500));
  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=id,message&source=eq.${MARKER}&order=created_at.desc&limit=5`;
    const check = await fetch(url, { headers: sbHeaders() });
    const rows = await check.json();
    const found = Array.isArray(rows) && rows.some((r) => (r.message || "").includes(stamp));
    if (!found) {
      fail(site.name, `form accepted the submission but nothing was stored in ${table}. Real enquiries are being lost silently.`);
    } else {
      note(`${site.name}: submission accepted and stored correctly.`);
    }
    // Clean up every marked test row, including any left behind by an earlier failed run.
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?source=eq.${MARKER}`, {
      method: "DELETE",
      headers: sbHeaders({ Prefer: "return=minimal" }),
    });
  } catch (e) {
    fail(site.name, `could not verify storage in ${table}: ${e.message}`);
  }
}

// ---------- run ----------

const sites = config.sites.filter((s) => (only ? s.name === only : true));

if (!sites.length) {
  console.error("No sites configured. Fill in sites.json.");
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Warning: SUPABASE_URL / SUPABASE_SERVICE_KEY not set. Storage checks will be skipped.\n");
}

for (const site of sites) {
  if (site.enabled === false) {
    note(`${site.name}: disabled in sites.json, skipped.`);
    continue;
  }
  await checkFreshness(site);
  if (!noSubmit) await checkSubmit(site);
}

console.log("\nHD Southern form health check\n");
for (const n of notes) console.log(`  - ${n}`);
if (problems.length) {
  console.log("\nPROBLEMS:\n");
  for (const p of problems) console.log(`  x ${p}`);
  console.log("");
  process.exit(1);
}
console.log("\nAll configured checks passed.\n");
