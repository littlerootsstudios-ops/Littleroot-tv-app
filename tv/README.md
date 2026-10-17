# LittleRoots TV apps

The TV app is one web app (`src/littleroots-tv.html`). It is delivered three ways:

| Where | How | Updates |
|---|---|---|
| **LG (webOS)** | Installed package `com.littleroots.tv_<version>_all.ipk`, built by `bash tools/package-lg.sh` (or the *Build LG TV app* workflow). Runs from the TV, reads the library from the backend. | Videos and categories update instantly. Design changes need a new package (raise `version` in `tv/webos/appinfo.json`). |
| **Hisense (VIDAA)** | Hosted web app: VIDAA opens `https://littleroots-api.littlerootsstudios.workers.dev/?tvapp=1` | Everything updates instantly. |
| **Any TV browser / phone** | `https://littleroots-api.littlerootsstudios.workers.dev/` | Instantly. |

In the installed apps (`file://` or `?tvapp=1`), pressing Back twice on Home leaves the app.

- `tv/webos/` - LG app info, icons (80, 130 px) and splash (1920x1080).
- `tv/store/` - store images: LG 400x400 icon, VIDAA 480x480 / 480x270 icons, 1920x1080 and 1280x720 banners.
- Remake the images with `node tools/make-tv-assets.mjs`.
