# LittleRoots video hosting on Cloudflare R2 (free tier)

## 1. Convert your videos
```bash
chmod +x convert-to-hls.sh
./convert-to-hls.sh "Noah's Ark.mp4"        # -> output/noahs-ark/
./convert-to-hls.sh videos/*.mp4            # converts a whole folder
```
Keep your original files in Google Drive as the master backup.

## 2. Create the R2 bucket (one time)
1. Sign up at dash.cloudflare.com (free) -> **R2 Object Storage** -> enable R2.
   Cloudflare asks for a card to turn on R2, but you're not charged while inside the free tier.
2. **Create bucket** -> name it `littleroots-videos`.
3. Bucket -> **Settings** -> **Public access**:
   - For testing: enable the **r2.dev** public URL.
   - For launch: connect a custom domain such as `videos.littleroots.tv` (r2.dev is rate-limited and meant for testing).
4. Bucket -> **Settings** -> **CORS policy**, paste:
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```
TV and mobile apps need this to be allowed to read the videos.

## 3. Upload
Easiest for folders: **rclone** (free).
1. In Cloudflare: R2 -> **Manage API tokens** -> create a token with *Object Read & Write* on the bucket. Note the Access Key ID, Secret, and your Account ID.
2. Install rclone (rclone.org/downloads), run `rclone config`, choose **s3** -> provider **Cloudflare**, paste the keys, endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Name the remote `r2`.
3. Upload:
```bash
rclone copy output/ r2:littleroots-videos/ --progress
```

## 4. Add to the app catalog
Each video's stream link is:
```
https://<your-public-url>/<slug>/master.m3u8
https://<your-public-url>/<slug>/thumbnail.jpg
```
In the TV app, set `VIDEO_BASE_URL` to your public URL and add an entry to `CATALOG`
with the slug, title, row and duration.

## Staying free
- By default the script makes 720p + 480p: about 160 MB per 5-minute video, so ~60 videos fit in the free 10 GB.
- `INCLUDE_1080=1 ./convert-to-hls.sh video.mp4` adds 1080p (about 350 MB per 5 minutes, ~28 videos in 10 GB).
  720p looks good on TVs for animation, so save 1080p for later or for paid storage.
- Downloads (egress) are free; a 5-minute view is ~50 file reads against 10 million free per month.
