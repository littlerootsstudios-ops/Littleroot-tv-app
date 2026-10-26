# LittleRoots TV (main app)

| Folder | What it is |
|---|---|
| `src/littleroots-tv.html` | The TV and phone app (source). It loads its library from the backend; built automatically into `api/public/index.html` and served at the backend's address |
| `index.html` | TV-safe build of the app for GitHub Pages (same app, loads the same library) |
| `api/` | Backend + Admin page: video library, uploads, catalog for the apps. See `api/README.md` |
| `.github/workflows/deploy.yml` | Publishes the backend, TV app and Admin page to Cloudflare on every push |
| `.github/workflows/convert.yml` | Free video converter (runs on GitHub after each Admin upload) |
| `tools/` | Conversion script, TV-safe build, seed generator |
| `brand/` | Logo and sound logo |

Prototype of the LittleRoots streaming app for smart TVs (LG webOS, Hisense VIDAA), phones and browsers.

- `index.html`: the whole app. Videos from the LittleRoots YouTube channel play inside the app's own player.
- `tools/convert-to-hls.sh`: turns video files into streaming format for Cloudflare R2.
- `tools/README-video-hosting.md`: how to host your own videos on Cloudflare R2.
- `brand/littleroots-logo.svg`: the logo.

## Adding videos
Open `index.html`, find `CATALOG`, and add an entry with the YouTube video ID (`yt`), title, world, age range and description.

## TV-safe build
Edit `src/littleroots-tv.html`, then rebuild `index.html` so it also runs on older smart-TV browsers (LG webOS 5+):

```bash
npm i @babel/core@7.24.7 @babel/preset-env@7.24.7
node tools/build-tv.mjs src/littleroots-tv.html index.html ./node_modules
```
The build adds the full page header, converts newer JavaScript to an older form, and adds layout fallbacks for older TV browsers.

## Live addresses
- TV app: https://littlerootsstudios.com/
- Admin page: https://littlerootsstudios.com/admin/
