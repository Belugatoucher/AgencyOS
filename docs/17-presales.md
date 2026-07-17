# 17 — Pre-Sales (Deck Autofill, Sales Docs, Setter/Closer Infrastructure)

## Deck automation (Canva, your template)

You keep designing in Canva; the platform only fills it. Setup once per deck template:

1. In Canva, convert the pitch deck to a **Brand Template** with data fields on the variable elements: `{{client_name}}, {{industry}}, {{pain_1..3}}, {{goal_1..3}}, {{current_state}}, {{offer_focus}}, {{proof_relevant}}, {{investment_range}}, {{timeline}}, {{next_step_date}}` — plus image fields (their logo from intake/lead record).
2. Platform connects via Canva Connect API (OAuth) and reads the template's dataset schema, so field mapping is discovered, not hardcoded — redesign the deck freely; as long as field names survive, nothing breaks.

**Flow per lead:** discovery call → Notes pipeline produces transcript + notes → member hits **"Prep deck"** on the lead → `ai` job runs `prompts/deck-autofill.md` (transcript + notes + lead record + Client Brain-style extraction) → returns values per field with evidence timestamps → **review screen**: each field shows extracted value + the transcript moment it came from; member edits anything → confirm → platform calls Canva autofill → new design copy created in a "Pitch Decks" Canva folder → returns the Canva edit link (final human polish) + auto-exported PDF stored as a document on the lead.

Rules: nothing auto-sends; unfillable fields come back as `[NOT DISCUSSED — ask about X]` so gaps become follow-up questions, not fabrications; `proof_relevant` selects from the agency's proof points/case studies matching the lead's industry — the only claims source, as everywhere.

```
deck_templates — name, canva_template_id, field_schema jsonb (synced from Canva)
deck_runs      — lead_id, template_id, extracted jsonb, canva_design_id,
                 edit_url, pdf_file_id, status (extracted|reviewed|generated)
```

## Sales documents on the lead + portal

New `documents` object: any file with a kind and a home.

```
documents — account_id? lead_id?, kind (deck|proposal|contract|report|brief|invoice|misc),
            file_id, title, client_visible bool, signed_at?
```

- Lead drawer gets a Documents tab (decks, proposals — pre-sale material lives on the lead, migrates to the account when they close).
- **Portal "Documents" page** (added to doc 11): everything `client_visible` — signed proposal, contracts, monthly report PDFs, creative briefs, the deck they saw. One place; no more "can you resend the contract."

## Google Calendar

Per-user OAuth (calendar scope), connected in Settings. Behavior:

- **Tasks → GCal is opt-in per task:** a small calendar toggle on any task with a due date ("Add to my Google Calendar"), plus a per-user default rule (never / always / only priority ≥ high). Toggled tasks create a GCal event (or all-day) with a deep link back; completing or rescheduling the task updates/removes the event. One-way by design — GCal edits don't write back; the platform stays truth.
- **Meetings ⇄ GCal:** platform meetings push to the member's calendar; inbound, a light poll of the connected calendar suggests meeting records for events matching known lead/client emails ("Looks like a call with Acme tomorrow — track it?"), which pre-creates the Notes record so recording is one tap.
- Setter/closer booking stays in GHL's calendar product (it owns reminders/routing); GCal here is personal-productivity glue.

```
users        += gcal tokens (encrypted), gcal_default_rule
tasks        += gcal_sync bool, gcal_event_id
```

## Setter/Closer infrastructure (built now, visible when hired)

Extends existing rails — no parallel system:

- `users.sales_role` (`setter | closer | null`) + lead routing: new leads assign to a setter round-robin (or rules by source); a booked call flips ownership to the assigned closer.
- **Call dispositions:** lead_activities kind `call` gains structured disposition (`no_answer | not_qualified | booked | showed | no_show | closed_won | closed_lost` + objection tag). Loggable from the lead drawer or the Slack hot-lead message in two taps.
- **Sales dashboard (owner view):** per-rep funnel — dials/convos → sets → show rate → close rate → revenue; speed-to-lead (first-touch time on new leads); pipeline coverage; objection frequency (feeds the Brain's objections). Filterable by rep, source, date.
- Every sales call recording runs through Notes automatically; closers' discovery calls are what feeds deck autofill, and call summaries + dispositions give you full visibility into a rep's day without listening to everything — though you can, transcript-searchably.
- Commission math stays out of scope until real comp plans exist (v2 with Stripe data).

## Build checklist

- [ ] Canva OAuth + template schema sync + autofill service + PDF export
- [ ] Extraction prompt + evidence-linked review screen
- [ ] documents table + lead Documents tab + portal Documents page
- [ ] GCal OAuth + task toggle/default rule + meeting push + inbound suggestions
- [ ] sales_role, routing, dispositions, sales dashboard
