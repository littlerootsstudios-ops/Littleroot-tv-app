# LittleRoots TV apps

The TV app is one web app (`src/littleroots-tv.html`). It is delivered three ways:

| Where | How | Updates |
|---|---|---|
| **LG (webOS)** | Installed package `com.littleroots.tv_<version>_all.ipk`, built by `bash tools/package-lg.sh` (or the *Build LG TV app* workflow). It opens the live app with `?tvapp=1&platform=webos` (YouTube only plays embedded videos for apps that come from a web address). | Everything updates instantly. Rebuild only for a new icon/name (raise `version` in `tv/webos/appinfo.json`). |
| **Android phones, tablets, Android TV / Google TV** | `android/` - a small native app that shows the live app full screen (`?tvapp=1&platform=android`, plus `&touch=1` on phones). Built by the *Build Android app* workflow; the APK is saved on the `apk` branch. | Everything updates instantly. |
| **Hisense (VIDAA)** | Hosted web app: VIDAA opens `https://littleroots-api.littlerootsstudios.workers.dev/?tvapp=1` | Everything updates instantly. |
| **Any TV browser / phone** | `https://littleroots-api.littlerootsstudios.workers.dev/` | Instantly. |

In the installed apps (`?tvapp=1`), pressing Back twice on Home leaves the app (on phones, anywhere on the home screen).

- `tv/webos/` - LG app info, icons (80, 130 px) and splash (1920x1080).
- `tv/store/` - store images: LG 400x400 icon, VIDAA 480x480 / 480x270 icons, 1920x1080 and 1280x720 banners.
- Remake the images with `node tools/make-tv-assets.mjs`.
