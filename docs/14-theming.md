# 14 — Theming & Design Schema

## Purpose

One token system, two layers: the **agency theme** skins the whole app to your brand; a **portal theme per account** makes each client's portal feel like it was built for them — their logo, their colors, pulled from onboarding automatically.

## Token schema

Stored as JSON, rendered as CSS variables. Everything visual reads tokens; no hardcoded colors in components (enforced in CLAUDE.md style rules).

```jsonc
{
  "colors": {
    "primary": "#...", "primaryFg": "#...",
    "accent": "#...",
    "bg": "#...", "surface": "#...", "border": "#...",
    "fg": "#...", "fgMuted": "#...",
    "success": "#...", "warning": "#...", "danger": "#..."
  },
  "typography": {
    "fontDisplay": "Inter", "fontBody": "Inter",   // Google Fonts name or uploaded font asset id
    "scale": "default | compact | relaxed"
  },
  "shape": { "radius": "sm | md | lg | full", "density": "cozy | comfortable" },
  "assets": {
    "logo": "asset_id", "logoDark": "asset_id?",
    "favicon": "asset_id?", "loginBg": "asset_id?", "emailHeader": "asset_id?"
  },
  "voice": { "portalGreeting": "custom welcome line?", "signoff": "email signoff?" }
}
```

## Two layers

**Agency theme** (`org_settings.theme`): applied app-wide — login, internal UI, default emails, PDFs (Reports pull tokens for the branded template). Editable in Settings → Appearance with live preview; dark mode variant auto-derived, overridable.

**Portal theme** (`accounts.brand.theme`): applied only to that account's portal, share-link pages (review links, collections, intake form), digest emails, and their report PDFs. Falls back to agency theme per token, so a half-filled theme still looks coherent.

## Personalization from onboarding (the magic)

When the intake drop-box receives a logo:

1. `media` worker extracts a palette (node-vibrant): dominant, accent, and light/dark-safe variants.
2. Contrast check (WCAG AA against `bg`/`surface`); auto-adjust lightness until passing — never ship an unreadable portal.
3. A **theme proposal** lands in the onboarding review screen: portal preview rendered live with their logo + extracted colors + their company name in the greeting. Member tweaks, accepts → portal is branded before the client ever logs in.
4. Brand-guideline PDFs uploaded at intake get parsed for stated hex codes (regex `#[0-9a-f]{6}` + context); found codes override extraction and are labeled "from brand guide."

First-login experience: their logo, their colors, "Welcome, {first name} — here's where {agency} keeps everything for {company}." That moment is the pitch for why this beats Frame.io links and email threads.

## Implementation notes

- Server component reads the resolved theme (portal: account → agency fallback merge) → inline `<style>:root{--color-primary:...}</style>` — zero flash, no client JS needed.
- Fonts: Google Fonts by name, or uploaded font files (from Brand Kit) served from R2 with `font-display: swap`.
- Emails: same tokens compiled into inline styles at send time (react-email templates).
- Custom portal domains (v1.5): CNAME + Caddy on-demand TLS; theme keyed off hostname.

## Build checklist

- [ ] Token schema + resolver (merge portal→agency→default) + CSS var injection
- [ ] Settings → Appearance editor with live preview + dark variant
- [ ] Palette extraction + contrast guard + theme proposal in onboarding review
- [ ] Themed emails + share-link pages + intake form
- [ ] Report PDF template reads tokens (with Reports, v1.5)
