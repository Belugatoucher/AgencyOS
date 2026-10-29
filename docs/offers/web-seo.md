# Offer playbook — Local Websites + SEO

A second offer beside video ads: custom websites for local service businesses, sold as **a setup fee plus a small monthly**, and sold with a **free website grade** instead of a pitch. Everything below runs on Agency OS (grader, Sites, Leads, Tasks) and GHL (follow-up, booking, SMS).

Prices and package contents live in `lib/grader/offer.ts`; the public page and every report read from there. Change them in that file.

---

## 1. The offer

**Who:** local service businesses with an outdated or builder site (Wix, GoDaddy, old WordPress) that get most work from Google: junk removal, dumpsters, roofing, HVAC, plumbing, landscaping, cleaning, detailing, contractors.

**Promise:** a fast site built to turn Google searches into calls, and a monthly that keeps moving them up Google Maps. We sell calls and Maps position, not "a website".

| | Launch | Growth |
|---|---|---|
| Setup | **$1,500** | **$2,500** |
| Monthly | **$149** | **$299** |
| Site | Custom 5–8 pages: services, towns served, reviews, quote form | Same |
| Local SEO | GBP tune-up, LocalBusiness schema, titles, service + town pages | + 2 new service/town pages a month |
| Lead capture | Tap-to-call, quote form and missed-call text-back into GHL | + automatic review requests after every job |
| Care | Hosting, SSL, uptime monitoring, backups, 30 min of edits/mo | Priority edits, up to 2 hrs/mo |
| Reporting | Monthly: calls, form leads, Maps position | + monthly Maps grid vs top competitor, quarterly conversion test |

- **Guarantee:** live within 14 days of getting their content, or the setup fee comes back. (Content = logo, photos, service list, towns. Chase it on day 1.)
- **Founding offer (validation only):** first 5 clients get half off setup ($750 / $1,250) for a 6-month minimum and permission to use them as a case study. Turn it off with `GRADER_FOUNDING_OFFER=off`.
- **Terms:** they own the site. Month-to-month after any minimum; if they cancel, they get an export of the site.

**Why these numbers:** Scroll Theory sells builds from $750 and care plans at $49–$199. We price above the "cheap website" tier because the monthly includes ongoing local SEO and reporting, and below the $3k–$10k agency tier so a single-truck owner can say yes on one call. The founding price makes the first five easy yeses. Revisit after validation (section 9).

**Unit economics (assumptions — check after 3 clients):**
- Delivery: ~6–10 hrs per build with the Sites pipeline and the `vngrd-default` skill pack; ~1–1.5 hrs/mo on Launch, ~3–4 hrs/mo on Growth.
- Hard costs per client per month: hosting ≈ $0 on Cloudflare Pages; Maps grid ≈ $0.10–0.20 per check (DataForSEO); GHL sub-account/SaaS cost per your plan; SMS usage.
- At 10 Launch + 5 Growth clients: $2,985 MRR plus setup revenue.

---

## 2. How the system fits together

```
Meta ads / outreach / referrals
        │  (utm_* on every link)
        ▼
  /grade  ── public grader (Agency OS) ─────────────► lead in the Grader pipeline (Agency OS)
        │                                             note on the lead with score + report link
        ▼
  /grade/<token> report ── "Book a 15-minute call" ──► GHL calendar
        │
        ▼
  GHL inbound webhook ──► contact + custom fields ──► follow-up workflow (email + SMS)
                                                     reply → stop + notify Ryan (Quo engage)
                                                     booked → stop + call-prep task
        ▼
  Sales call ──► close ──► Stripe invoice (setup) + subscription (monthly)
        ▼
  Agency OS: account → Site (intake from old URL) → design approval → build → launch → monitor + report
```

Outbound runs the other way: bulk-grade a prospect list in **Sites → Grader**, send each owner their report with **Copy pitch**, and watch **Opened N×** to know who to call.

---

## 3. Setup checklist (one time)

1. **Agency OS env:**
   - `PAGESPEED_API_KEY`: Google Cloud → enable the PageSpeed Insights API → create an API key. Free quota is plenty.
   - `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`: dataforseo.com, pay-as-you-go. Load $50 to start.
   - `GRADER_PIPELINE_ID`: create a pipeline "Website grader" on the agency account (stages: New → Contacted → Call booked → Proposal → Won / Lost) and paste its id.
   - `GRADER_GHL_WEBHOOK_URL`: from step 2.
   - `GRADER_BOOKING_URL`: your GHL calendar link.
   - `GRADER_PHONE` (optional), `GRADER_BRAND_NAME` (defaults to VNGRD Media), `GRADER_DAILY_CAP` (default 150 public runs/day).
   - `APP_URL` must be the public address, so report links work. The public pages are `/grade` and `/grade/<token>`.
2. **GHL workflow "Website grader follow-up":**
   - Trigger: **Inbound Webhook**. Copy the URL into `GRADER_GHL_WEBHOOK_URL`, run one test grade, then map fields.
   - Create/Update Contact: first name, email, phone, company name, website, city.
   - Custom fields (create first): `grade_score`, `grade_letter`, `grade_fix_1`, `grade_fix_2`, `grade_fix_3`, `grade_report_url`, `service`, `utm_source`, `utm_campaign`.
   - Tags: `grader-lead`, plus `grade-a-b` / `grade-c` / `grade-d-f` via an If/Else on `grade_score` (≥80 / 70–79 / <70).
   - Add to Opportunity pipeline (if you also track there) and start the sequence in section 4.
   - Goals / stop conditions: contact replies (SMS or email) → remove from workflow, internal notification to Ryan, assign to the Quo conversation; appointment booked → remove from workflow, create task "Prep call: open report".
   - SMS needs A2P 10DLC registration in GHL. The public form has the consent line; only text people who gave a phone number on the form.
3. **Meta Pixel / CAPI on `/grade`:** fire `Lead` when the form is submitted. Simplest path: let GHL send the Lead event when the webhook arrives (GHL → Integrations → Facebook Conversions API), deduped on email/phone.
4. **Domain:** point a clean subdomain at Agency OS for the public pages, e.g. `grade.vngrd.media` → `/grade`. Keep the internal app behind login as it is.

---

## 4. Follow-up sequence (GHL)

Write as Ryan, first person, short. `{{…}}` are GHL custom values.

**Minute 0 — Email** · Subject: *Your website grade: {{contact.grade_score}}/100*
> Hi {{contact.first_name}}, here's your report for {{contact.website}}: {{contact.grade_report_url}}
> The three things costing you the most calls:
> 1. {{contact.grade_fix_1}}
> 2. {{contact.grade_fix_2}}
> 3. {{contact.grade_fix_3}}
> Want me to walk you through it? 15 minutes: {{calendar link}}. — Ryan

**Minute 2 — SMS** (only if a phone was given)
> Hey {{contact.first_name}}, it's Ryan from VNGRD. Your website report is ready: {{contact.grade_report_url}}. Biggest fix: {{contact.grade_fix_1}}. Want me to walk you through it?

**Day 1 — SMS**
> Did you get a chance to look at the report? Happy to explain the Google Maps part. That's usually where the calls are hiding.

**Day 3 — Email** · Subject: *Who's getting your calls in {{contact.city}}*
> Most people who search "{{contact.service}} {{contact.city}}" call one of the top 3 on the map. Your report shows who's there and why. Fixing it is usually pages for each town you serve plus a steady stream of reviews. I can show you what that would look like for you: {{calendar link}}

**Day 7 — SMS** (last touch)
> Last one from me. If you want the fixes done for you, we build sites like this for local businesses, live in 2 weeks. Reply YES and I'll send a preview of what yours could look like.

**Reply handling (Quo / GHL conversations):** answer within the hour during business hours.
- "YES" or a question → book the call.
- "How much" → give the range ($1,500 + $149/mo, founding $750) and book the call to scope it.
- "Not now" → tag `nurture-90`, then a 90-day reminder to re-grade their site and send the new score.

---

## 5. Outbound prospecting (no ads needed)

1. Build a list: Google Maps search "service + town" for 3–5 trades across nearby towns. Sites with an F/D grade and few reviews are the best prospects. 20–30 per town.
2. **Sites → Grader → Grade a list**: paste `website, business name, town` and set the main service. Up to 100 at a time, spaced ~20s apart.
3. For each finished report: **Copy pitch** → send by email, the contact form on their site, or a Facebook/Instagram DM. Don't cold-text people who haven't opted in.
4. Watch **Opened N×**. Call anyone who opened it twice, the same day. Opener:
   > "Hey, it's Ryan. I sent over that website report for {{business}}. I saw you had a chance to look at it. Did the Google Maps part make sense? … That's the part I'd fix first. Got 10 minutes this week so I can show you how?"
5. Log every touch on the lead in Agency OS. The grader already notes the score and report link on the lead.

Weekly rhythm: **Mon** build the list and bulk-grade 50 → **Tue–Wed** send pitches → **Thu–Fri** call the openers.

---

## 6. The 15-minute call

1. **Their world (3 min):** "Where do most of your jobs come from right now? What happens when someone calls and you're on a job?"
2. **The report (5 min):** screen-share it. Start at the Google Maps grid and the competitor, then the top 3 fixes. Let the numbers talk.
3. **The fix (3 min):** "Here's what we'd do: a site built around your services and every town you serve, tap-to-call and a quote form wired to text back missed calls, then every month more town pages and reviews so you move up that map."
4. **The offer (2 min):** Launch or Growth, founding price if spots remain, the 14-day guarantee, month-to-month after the minimum.
5. **Close (2 min):** "Want to grab one of the founding spots? I'll send the invoice and a 10-minute content checklist today."

Objections:
- "I already have a website" → "You do, and it scored {{score}}. The question is whether it's getting you calls. The map says your competitor is getting them."
- "My nephew built it / it's free" → "Keep it if it's working. If it's not getting calls, it's the most expensive free thing you have."
- "Too expensive" → "One extra job a month covers it. Most of our clients get that from the missed-call text-back alone."
- "Need to think" → "Totally fair. What part would you want to think through? Let's sort it now so you're not guessing later."

---

## 7. After the close (onboarding SOP)

Day 0:
- [ ] Stripe: setup invoice + monthly subscription (Agency OS Stripe integration, or GHL payments).
- [ ] Agency OS: create the client account, then **Sites → New site** with the old site's address, which crawls and drafts a design.
- [ ] Send the content checklist: logo, 10–20 job photos, services and prices, towns served, 3 best reviews, GBP access.
- [ ] Note the 14-day guarantee date in Tasks (content date + 14).

Days 1–5:
- [ ] Approve the design system in Sites. Check it against the client's brand and the report's top fixes.
- [ ] Request the initial build (the `vngrd-default` pack) and review the preview.
- [ ] GHL: sub-account, quote form, missed-call text-back, review-request automation (Growth), calendar.

Days 6–14:
- [ ] Client review, one revision round, approve, launch.
- [ ] Point the domain, set 301 redirects from old URLs, submit the sitemap in Search Console.
- [ ] Re-grade the new site in the grader and save the before/after. This is the case study.
- [ ] Turn on health checks and analytics (Search Console + GA4 ids in the site's Settings).

---

## 8. Monthly delivery

**Launch (≈1–1.5 hrs):** health checks clean · edits done · GBP post · monthly report (calls, forms, Maps position, before/after score).
**Growth (≈3–4 hrs):** + 2 new service or town pages (Sites: change build) · review automation checked · Maps grid re-run against the competitor · quarterly conversion test on the top page.

---

## 9. Validation plan (first 30 days)

Goal: prove people will pay **setup + monthly** for this, and which channel brings them.

| Metric | Target by day 30 | Where to see it |
|---|---|---|
| Prospect reports sent | 150 | Grader → Prospects |
| Report open rate | ≥ 35% | Grader → "Opened" |
| Inbound grades from ads | 40 at ≤ $15 each | Grader → Inbound (utm_source) + Meta |
| Calls booked | 12 | GHL calendar |
| Closed | 3 founding clients | Leads pipeline |

- **Ad test:** $300–500 on Meta, a lead campaign to `/grade?utm_source=facebook&utm_campaign=grader-test`. Two creatives: (a) "How many calls is your website losing? Free grade in 2 minutes." (b) a screen recording of a real report's Maps grid. Optimize for the `Lead` event.
- **Continue if:** 2+ closes at full or founding price, and the open rate holds above 25%.
- **Change the angle if:** opens are high but few people book. The report is interesting but the offer isn't clear: lead with the guarantee and the missed-call text-back.
- **Kill or reprice if:** fewer than 5 booked calls from 150 reports + 40 inbound. Test a lower setup ($500) with a 12-month minimum, or a niche-only page (one trade).

---

## 10. What's built vs. next

Built (Agency OS, `claude/grader` branch): the public grader + report, the internal console (single + bulk, opened tracking, copy pitch), lead creation, GHL webhook, report email fallback, the offer section, attribution.

Next, in order of value:
1. **Preview site for prospects:** a one-page "here's your new site" from the Sites pipeline, linked on the report. This is Scroll Theory's strongest hook.
2. **Monthly client report:** before/after grade, Maps grid trend, leads per month. This keeps the monthly paying.
3. **Rank tracking over time:** re-run the Maps grid monthly per client.
4. **AI-answer check:** whether ChatGPT and Google's AI name the business.
5. **White-label for other agencies:** later, once it closes clients for you.
