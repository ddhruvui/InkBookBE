# InkBook server

Express 5 + Mongoose API for InkBook. It stores the notebook in MongoDB Atlas, images on
ImageKit, and calls Google Gemini for scan conversion and chapter summaries. Design
decisions and data shapes are in [`../SPEC.md`](../SPEC.md).

## Run locally

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # node --watch, port 5001 by default
```

`npm start` runs without the file watcher. On start it logs the port and the database it opened.

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | yes | Atlas connection string; may contain the `<db_password>` placeholder |
| `MONGO_PASSWORD` | if the URI has `<db_password>` | substituted into `MONGO_URI` |
| `MONGO_DB_NAME` | no | database name; defaults to `InkBookTest` locally, `InkBook` on Vercel |
| `PORT` | no | default `5001` |
| `GEMINI_API_KEY` | for AI | without it `/api/ai/*` returns 503 |
| `GEMINI_MODEL` | no | default `gemini-2.5-flash` |
| `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` | for uploads | without them `/api/uploads` returns 503 |

### Prod database guard

`InkBook` is the prod database. Only the Vercel deployment (where `VERCEL` is set) may open it.
Any local process — the server or a script — exits with an error if it would connect to
`InkBook` (any letter case), and there is no override. Work against `InkBookTest` locally.

## API

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /api/health` | — | `{ ok: true }` |
| `GET /api/state` | — | `{ subjects, important, version }` |
| `PUT /api/state` | `{ subjects, important, baseVersion }` | `{ ok, savedAt, version }`; 409 on a stale `baseVersion` or an empty payload over existing data |
| `POST /api/uploads` | multipart `file` (image, ≤ 10 MB) | `201 { url }` (ImageKit URL) |
| `POST /api/ai/convert-scan` | multipart `file` | `{ title, body, formula, tip, diagram, transcript, scanUrl }` |
| `POST /api/ai/summarize-chapter` | `{ chapterName, topics: [{ name, text }] }` | `{ topics: [{ name, points }] }` |

Errors are JSON `{ error }`. JSON bodies are capped at 25 MB because each save sends the whole notebook.

## Code map

- `src/index.js` — app setup, error handler, prod-DB guard, connect + listen
- `src/db.js` — URI/password resolution, database-name selection, prod guard
- `src/model.js` — the single `InkBook` collection model (`kind`-discriminated docs)
- `src/routes.js` — state, uploads, health routes; save versioning
- `src/upload.js` — multer in-memory image upload
- `src/imagekit.js` — ImageKit upload + garbage collection of unreferenced images
- `src/ai.js` — Gemini routes and server-side SVG sanitizing

## Scripts

All scripts read `server/.env`.

**Refresh the test database from prod** (reads prod, never writes to it):

```bash
node scripts/copy-db.js
```

```bash
node scripts/copy-db.js --replace
```

```bash
node scripts/copy-db.js --from InkBook --to InkBookTest
```

It copies `InkBook` → `InkBookTest`. Without `--replace` it won't touch a non-empty target.
It refuses to write into `InkBook` or to copy a database onto itself, and skips the ImageKit
`image-index` doc so a local save can't delete prod images.

**Reset the test database to demo data** — wipes the database `MONGO_DB_NAME` points to
(default `InkBookTest`) and seeds a small notebook that uses every block type. Refuses the prod
database, and refuses a non-empty target without `--replace`:

```bash
node scripts/seed-test-db.js --replace
```

**One-time v1 → v2 migration** — converts the old single-document notebook into a v2 subject
(one "Notes" chapter, one text block per note) in the database `MONGO_DB_NAME` points to.
Add `--purge` to delete the v1 document after verifying the copy.

```bash
node scripts/migrate-v1.js
```

## Deploy

Deployed on Vercel. Set the same environment variables in the Vercel project; `MONGO_DB_NAME`
can be left unset there (it defaults to `InkBook`). Point the client's `VITE_API_URL` at the
deployment URL.
