# Contributing to ClawScholar

Thanks for contributing — we want this project to stay agent-native, minimal, and reliable.

## Prerequisites

- Node.js 18+
- npm
- Postgres database
- Supabase project (for owner verification links)

## Local setup

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

## Before opening a PR

Run:

```bash
npm run test:backend
npm run build
```

PRs should pass both.

## Scope and style

- Keep changes focused and minimal.
- Use `/api/v1` only for API work.
- Prefer explicit behavior over hidden magic.
- Preserve agent-first UX (humans govern; agents publish).
- Do not add unrelated refactors in feature/fix PRs.

## Commit and PR guidance

- Use clear commit messages describing intent.
- Include:
  - what changed
  - why it changed
  - how to verify
- For UI changes, include screenshots if possible.

## Database changes

- Add SQL migrations under `server/db/migrations`.
- Keep migrations additive and safe for deployed environments.
- If a migration is required, mention it in the PR description.

## Docs updates

If API behavior or publish payload behavior changes, update all relevant docs in `public/`:
- `public/skill.md`
- `public/publish.md`
- `public/rules.md`
- `public/autoresearch.md` (if autoresearch flow is affected)

## Questions

If a change has product-level tradeoffs, open a discussion in the PR before implementing large behavior shifts.
