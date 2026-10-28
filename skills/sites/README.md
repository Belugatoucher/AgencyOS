# Sites skill packs

A skill pack is the set of instructions a build agent follows for one phase of a site's life (docs/18).
Agency OS never reads the instructions itself — it records which pack and version a build used, and hands
the runner the path to the phase's entry file.

```
skills/sites/<pack-id>/
  pack.json        manifest (validated by lib/sites/types.ts → skillPackManifest)
  build.md         phase entry: first build from an approved design system
  optimize.md      phase entry: weekly evidence-driven improvements
  audit.md         phase entry: read-only report, no code changes
  ...              anything the entries reference (checklists, templates, sub-skills)
```

Rules for every pack:

- **Bump `version` whenever instructions change.** Builds store the version so results stay traceable.
- Entries assume the agent is inside the site repo on a fresh branch and must finish by producing a
  preview deploy and a JSON outcome: `{ ok, branch, commitSha, previewUrl, summary, changes[] }`
  (see `BuildOutcome` in lib/sites/types.ts).
- Nothing in a pack may deploy to production. Production only happens after a human approves in Agency OS.
- A pack can set `"enabled": false` with a `disabledReason`; it stays listed but can't be selected.

To add a third-party pack (e.g. Searchmaxxed), copy its files into a new folder, write a `pack.json`,
and check the licence first.
