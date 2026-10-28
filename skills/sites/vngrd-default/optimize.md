# Optimize phase — VNGRD default (v0.1.0, skeleton)

> Skeleton. The weekly loop: evidence in, small reviewed changes out.

Inputs: `evidence` (last 28 days of Search Console / GA4 / GHL lead counts, latest health checks), `brief`.

1. Pick **at most three** changes, each tied to a number in `evidence` (e.g. a page with high impressions and
   low CTR → rewrite its title/description; a query ranking 8–15 with no dedicated page → add a section).
2. Make the changes on the branch. Don't touch design tokens or navigation without a brief that asks.
3. In the summary, list each change with the evidence that motivated it and what metric should move.
4. Preview deploy + outcome JSON. A human approves before anything goes live.

## TODO
- Thresholds for "worth changing" per metric
- Content-gap detection from GSC queries
