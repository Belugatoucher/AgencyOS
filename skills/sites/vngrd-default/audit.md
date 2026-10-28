# Audit phase — VNGRD default (v0.1.0, skeleton)

Read-only. Produce a report; change no files and deploy nothing.

Check: broken links, missing/duplicate titles and descriptions, h1 usage, image alt text, JSON-LD validity,
Core Web Vitals from `evidence`, form presence on money pages, NAP consistency (name/address/phone).
Return the outcome JSON with `ok: true`, empty `changes`, and the findings in `summary`.
