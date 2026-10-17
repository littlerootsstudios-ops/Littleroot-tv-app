# LittleRoots backend + Admin page

Runs on Cloudflare Workers (free plan). It holds the video library, serves the catalog to the TV and phone apps,
and powers the Admin page at `/admin`. Videos are stored in Cloudflare R2 (free up to 10 GB) and converted for
TVs and phones by a free GitHub Actions workflow (`.github/workflows/convert.yml`).

```
Admin page ──upload──▶ R2 inbox ──▶ GitHub Actions converter (FFmpeg) ──▶ R2 streaming files
     ▲                                          │
     └──────── "Ready" ◀── report back ─────────┘
TV / phone apps ◀── /api/catalog ── this backend
```

## Try it on a computer
```bash
cd api
npm install
npx wrangler d1 migrations apply littleroots --local   # creates the database with the 30 videos
printf 'CONVERTER_SECRET="local-test-secret"\nMOCK_EXTERNAL="1"\nMEDIA_PUBLIC_URL="http://localhost:8787/media"\n' > .dev.vars
npx wrangler dev                                        # open http://localhost:8787/admin
npm test                                                # in a second terminal
```
Locally, uploads and conversion are simulated (`MOCK_EXTERNAL = "1"`).

## Going live (one time, about 30 minutes)
1. **Cloudflare account** (free): sign up at dash.cloudflare.com and note your **Account ID** (right side of the dashboard).
2. In a terminal: `cd api && npx wrangler login`
3. **Database:** `npx wrangler d1 create littleroots` → paste the `database_id` it prints into `wrangler.toml`,
   then `npm run db:remote` to create the tables and load the videos.
4. **Storage:** `npx wrangler r2 bucket create littleroots-media`. In the dashboard, open the bucket →
   Settings → **Public access** → connect a custom domain (e.g. `media.littleroots.tv`) or enable the r2.dev address.
   Add the CORS rule from `tools/README-video-hosting.md`, with `"PUT"` added to `AllowedMethods` (needed for uploads from the Admin page).
5. **Storage keys:** R2 → Manage API tokens → create a token with *Object Read & Write* on `littleroots-media`.
6. **Converter key:** on GitHub, Settings → Developer settings → Fine-grained tokens → new token with access to
   `Littleroot-tv-app` and **Actions: Read and write**.
7. Edit `wrangler.toml`: `PUBLIC_URL` (your Worker address, e.g. `https://littleroots-api.<you>.workers.dev`),
   `MEDIA_PUBLIC_URL` (the bucket's public address), `R2_ACCOUNT_ID`, and set `MOCK_EXTERNAL = "0"`.
8. Secrets for the backend:
   ```bash
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put CONVERTER_SECRET      # make up a long random password
   ```
9. Secrets for the converter: GitHub repo → Settings → Secrets and variables → Actions → add
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (`littleroots-media`) and the same `CONVERTER_SECRET`.
10. `npm run deploy`, then open `<PUBLIC_URL>/admin` and choose **Create your admin account** with an email listed in `ADMIN_EMAILS`.

## What it costs
- Cloudflare Workers, D1 and R2: free tiers (100,000 requests/day, 10 GB storage, no charge for viewers downloading video).
- GitHub Actions: free (unlimited on a public repo; 2,000 minutes/month on a private one, about 300+ conversions).

## API (for the TV and phone apps)
- `GET /api/catalog` → categories and published videos. Each video's `source` is `{type:"hls", url}` or `{type:"youtube", id}`.
- Admin endpoints live under `/api/admin/*` and need an admin sign-in.

Subscriptions are not switched on. The database keeps a `free` flag on every video so a subscribers-only option can be added later.
