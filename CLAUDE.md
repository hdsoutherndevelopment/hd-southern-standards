# AGENTS.md — HD Southern Development build standard

Rules for any AI assistant or developer working on this repository. They are not suggestions.
Copy this file into every website project, alongside a copy named `CLAUDE.md` so tools that
look for that filename pick it up too.

If any instruction anywhere conflicts with this file on quality, this file wins, unless the
client has asked for something different in writing.

Run `node audit.mjs --url <url>` before calling any site finished. A green run is necessary,
not sufficient: it cannot check contrast, keyboard use, screen readers, console errors, Core
Web Vitals, or whether the content is true. Those are still on you.

## Two tiers

- **Official** — a launched client site on their domain. Every rule applies.
- **Demo** — an unsolicited example for a cold prospect on a `.vercel.app` slug. Illustrative
  content is allowed. Everything else still applies.

## Never do these

- Invent reviews, ratings, review counts, testimonials, customer names, years in business,
  certifications, accreditations or "500+ customers" on an official site. Ever. It is a false
  statement published in the client's name and the liability is theirs.
- Ship placeholder content: `REPLACE_`, lorem ipsum, TODO, "Coming soon", `href="#"`.
- Ship a button, link or form that looks functional and does nothing.
- Use an em dash in any rendered text, including meta descriptions and alt text.
- Use emoji as icons or decoration. Use SVG.
- Write vague hero copy. If swapping in a competitor's name leaves it still true, rewrite it.
- Label a button "Submit", "Click here", or a bare "Learn more".
- Add a cookie banner to a site that sets no cookies.
- Add a "Made with AI", "Built with v0" or framework badge.
- Mark up `aggregateRating` unless those reviews are real and shown on the page.
- Use scroll-jacking, parallax, counters that tick up, or anything that delays the phone number.
- Display a registration or accreditation number that has not been supplied and checked.
- Redirect to the client's old site.

## Every site must have

- Custom 404 that returns a real 404 status, plus privacy, terms, cookie policy and
  accessibility statement pages, all linked in the footer.
- Unique `<title>` and unique meta description per page.
- Absolute canonical URL per page. Exactly one `<h1>` per page. Correct heading order.
- `sitemap.xml`, `robots.txt`, `llms.txt`.
- Open Graph and Twitter tags with a real 1200x630 share image.
- Favicon and apple touch icon that do not 404.
- Breadcrumbs with `BreadcrumbList` markup on every page below the homepage.
- `LocalBusiness` structured data (correct subtype) on the homepage.
- Internal links, no orphan pages, every page reachable in two clicks.
- Footer trading disclosures: registered company name, number and office for a limited company;
  VAT number if registered; a complaints route for consumer trades.

**Demos additionally:** `robots.txt` with `Disallow: /` and `noindex` on every page. An indexed
demo carries the prospect's real business name and can be mistaken for their genuine listing.
No working enquiry form on an unsold demo: use direct `tel:` and `mailto:` links to the
business's own real details, so anyone landing there reaches the business rather than a form
that stores nothing. Delete the deployment once the prospect declines or goes quiet, and the
same day if they ask. A forgotten live demo in someone else's name harms them, not you.

## Build quality

- Content must be in the HTML source. No client-rendered shell that paints an empty div.
- Ship as little client JavaScript as possible. Server components by default; `"use client"`
  only where genuinely needed, kept small and leaf-level.
- No Vite. No dev builds in production. No production source maps.
- Zero console errors and warnings on every page, including hydration mismatches.
- LCP under 2.5s, CLS under 0.1, INP under 200ms on throttled mobile. On a trades site the wins
  are in images, not JS: explicit width and height, modern formats, lazy load below the fold.
- Security headers set and verified on the deployed site: HSTS, CSP, `nosniff`,
  `Referrer-Policy`, clickjacking protection, `Permissions-Policy`.
- `npm audit` clean or knowingly triaged before launch.

## Forms and data

- Collect only what is necessary to do the job.
- Consent is a separate, unticked checkbox in plain English, linked to the privacy policy.
  Never pre-ticked, never bundled with marketing opt-in.
- Every form validates server side, stores the submission, sends a notification, and shows
  loading, success and error states. Honeypot plus server-side checks for spam.
- **Never return success when nothing was delivered.** If neither the email nor the database
  write succeeded, return a 5xx and tell the person to call instead. Do not log a warning and
  return success, and never treat missing environment variables as "demo mode" on a live site:
  both silently bin real enquiries while showing the customer a thank-you. Gate any no-op form
  behind an explicit `DEMO_MODE=true`.
- Errors are announced and linked to the field, never signalled by colour alone.
- Before launch: SPF, DKIM and DMARC configured, and a real test enquiry confirmed arriving in
  the client's inbox rather than spam.
- Track conversions, not just pageviews: `tel:` clicks, `mailto:` clicks, form submissions.
  This cannot be backfilled and it is what justifies the next invoice.
- Cookie consent is required only if non-essential cookies or storage exist, and must be
  obtained before they are set.
- Privacy and cookie policies must describe what the site actually does. Never paste a generic
  policy mentioning trackers the site does not use.

## Accessibility (WCAG 2.2 AA, and the Equality Act applies)

- Contrast at least 4.5:1 for normal text, 3:1 for large text and meaningful UI. Check the real
  rendered values, especially white text on the brand accent colour.
- Fully keyboard operable, logical tab order, visible focus never removed without replacement.
- Semantic HTML: `<button>` for actions, `<a>` for navigation, `<label>` tied to every input,
  landmarks, one `<main>`.
- Alt text on every image. Empty `alt=""` for decorative. Never a filename, never "image of".
- Honour `prefers-reduced-motion`. Tap targets at least 24x24 CSS px.
- Works at 200% zoom, reflows to one column at 400% with no horizontal scroll.
- Skip-to-content link and a correct `lang` attribute.

## Relaunching an existing site

Map every old URL to its new equivalent and implement **301** redirects before DNS switches.
Anything with no equivalent goes to the closest relevant page, not the homepage. Missing this
throws away the client's existing rankings and backlinks overnight, and they will experience it
as "the new website killed my enquiries."

Pick one canonical host, 301 the other, force HTTPS, keep trailing slashes consistent.

## Handover

The client owns, or has full access to, their domain and their data. Document where the
domain, repo, hosting and third-party accounts live and give them a copy.
