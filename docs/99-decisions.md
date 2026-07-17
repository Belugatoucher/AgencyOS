# 99 — Decisions Log

Append-only. Every judgment call made during implementation gets a row — anything the specs didn't dictate: library picks, schema tweaks, behavior choices, deferred work. Newest first. Claude Code: add an entry in the same commit as the decision; humans: review this file weekly.

Format:

```
## YYYY-MM-DD — Short title
**Context:** what forced a choice (spec silent/conflicting, technical constraint)
**Decision:** what was done
**Alternatives considered:** briefly
**Revisit if:** the condition that would reopen this
```

---

## 2026-07-16 — Log created
**Context:** Spec pack handoff; drift across Claude Code sessions needs a paper trail.
**Decision:** All `// DECISION:` comments in code must have a matching entry here.
**Alternatives considered:** PR descriptions only — rejected, they don't survive squashes.
**Revisit if:** Never.
