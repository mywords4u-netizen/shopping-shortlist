# Shopping Shortlist

A Cloudflare Worker for Leo and his wife's shared shopping list: one web page where they rank items they want (price, where to get it, notes), and drag a "buying line" so everything above it is what they will buy, with a running total. All data is in one KV namespace. Anyone with the link can view and edit; no accounts.

## Layout

- `src/index.js` routes `/health`, `/list/<URL_KEY>` (the page) and `/api/<URL_KEY>/…`.
  - `list.js`: reads and writes the list in KV, validates and cleans every item, applies batches of operations.
  - `http.js`: response helpers. `pages/app.html`: the whole page with inline CSS and JS, bundled as a string.
- `worker.js` is **generated** by `build.mjs` (esbuild) and is what Cloudflare deploys (`wrangler.jsonc` `main`). Never edit it by hand.
- `test/` uses Node's built-in test runner with an in-memory KV. The tests import the built `worker.js`.

## Commands

- `npm run build`: rebuild `worker.js` from `src/`.
- `npm test`: build, then run all tests.

## Rules

- After changing anything in `src/`, run `npm run build` and commit `worker.js` with it. CI fails PRs where `worker.js` doesn't match `src/`.
- Deploys happen automatically from `main` through Cloudflare Workers Builds. Merging to `main` changes the live page, so work on a branch and open a PR.
- Line endings are LF (`.gitattributes`).
- KV key `list` holds `{ rev, items }`. `rev` goes up by one on every write; the page polls with `?rev=` and gets `{ unchanged: true }` when nothing changed. Items are `{ id, name, price, qty, store, url, notes, rank, created }`; the buying line is the single item `{ id: "cutline", kind: "line", rank }`. Items above the line (lower `rank`) are the ones to buy. Don't rename fields or change their shape without a migration.
- The `URL_KEY` secret is the only access control. Never log it or put it in code or tests.
