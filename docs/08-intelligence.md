# 08 — Intelligence (Hooks DB, Research, Winning Creatives, Client Brain)

## Purpose

A compounding knowledge layer: every hook you swipe, every creative that performed, every piece of research, and everything you know about each client — indexed and retrievable by a content AI that drafts like someone who has worked the account for a year. This is the module that makes the platform worth more every month you use it.

## Four stores, one retrieval layer

### 1. Hooks database
Swipe file with structure. Each hook: text, format (`question | callout | stat | story_open | contrarian | pain | curiosity | social_proof`), platform, niche tags, source (competitor ad, our ad, organic post), and outcome data when known. Global by default; hooks can be flagged `account_id` when client-specific. Capture paths: manual add, paste-a-URL (fetch + extract), bulk CSV, and "save from anywhere" via a PWA share target on your phone — see an ad, share it to Agency OS, tag it in 10 seconds.

### 2. Winning creatives
Links Assets to numbers. A creative record = asset ref(s) + platform + client + metrics (`hook_rate, hold_rate, ctr, cpm, cpa, roas, spend`) + a written `learning` ("UGC talking-head beat motion graphics 3:1 for this offer"). Metrics ingest: CSV import from Meta/TikTok exports day one; GHL-reported post metrics where available; direct ad-platform APIs are a later adapter. `winning` is computed, not vibes: top quartile on the primary KPI for that account with min spend threshold.

### 3. Research library
Market research, competitor teardowns, audience/VoC material (review dumps, survey answers, community threads), strategy docs. Upload or paste; everything gets chunked and embedded. Tag by account, vertical, and kind (`competitor | audience | voc | trend | strategy`). VoC is gold for the content AI — customer language beats copywriter language.

### 4. Client Brain
One structured profile per account, editable like a doc but stored as fields:
`offer, icp, positioning, voice (do/don't + sample lines), objections, proof_points, compliance_nos, goals_current_quarter, learnings[]`.
Learnings append automatically: when a creative is marked winning/losing with a `learning`, and when meeting notes contain strategy decisions, the system proposes a Brain update (human approves — the Brain never self-edits silently).

## Retrieval (RAG)

- `pgvector` extension; embed chunks of research docs, hooks, creative learnings, meeting summaries, and the Brain itself. Embeddings via a small local model (`bge-small` on the worker — keeps client data off third parties) or a hosted embedder if you accept that tradeoff.
- Retrieval scope per query: this account's material first, then global library (hooks, cross-client learnings with client names stripped), weighted by recency and performance.
- Everything retrieved is cited: the AI's drafts show which hooks/research chunks it leaned on, tap to open the source.

## Content AI

A per-account chat surface ("Ask the Brain") plus a generator wired into the Scheduler composer and a briefs generator for creative production.

Capabilities:
- **Draft** — posts, scripts, ad copy variants using `prompts/client-brain.md`: retrieved hooks + VoC language + Brain profile go into context.
- **Brief** — turn "we need 3 UGC ads for the spring offer" into shot-level creative briefs referencing winning patterns (feeds your script-writer workflow).
- **Answer** — "what objections come up for this client?", "which hook formats work for supplement brands?" with citations.
- **Audit** — paste a draft, get it checked against the Brain's voice/compliance rules (brand-review pattern).

Guardrails: no fabricated stats or claims (proof_points are the only claims source), compliance_nos are hard blocks injected into every system prompt for that account, and cross-client retrieval never exposes one client's name or numbers to another's output.

## Objects

```
hooks             — text, format, platform, niche_tags[], source, source_url?, account_id?,
                    metrics jsonb?, embedding vector
creatives         — account_id, asset_ids[], platform, metrics jsonb, spend_cents,
                    is_winning bool (computed), learning text, embedding vector
research_docs     — account_id?, kind, title, file_id?, raw_text
research_chunks   — doc_id, chunk_text, embedding vector
client_brains     — account_id (unique), structured fields above, updated_by, version history
brain_suggestions — proposed Brain edits from meetings/creatives, status pending|accepted|rejected
ai_threads        — per-account chat history for Ask the Brain
```

## Routes

```
POST   /api/hooks                    (+ /import, + PWA share-target endpoint)
GET    /api/hooks?format=&platform=&niche=&q=        (semantic + filter search)
POST   /api/creatives                (+ /import-metrics CSV)
POST   /api/research                 upload/paste → chunk + embed job
GET    /api/brain/:accountId         (+ PATCH, + /suggestions)
POST   /api/brain/:accountId/chat    streaming; tools: search_hooks, search_research,
                                     search_creatives, get_brain
POST   /api/brain/:accountId/brief
```

## Build checklist

- [ ] pgvector + embedding worker (local bge-small)
- [ ] Hooks CRUD + import + PWA share target + semantic search
- [ ] Creatives + CSV metrics import + winning computation
- [ ] Research upload → chunk → embed pipeline
- [ ] Client Brain editor + versioning + suggestion queue
- [ ] Ask the Brain chat (streaming, tool-use retrieval, citations)
- [ ] Composer + brief integrations
