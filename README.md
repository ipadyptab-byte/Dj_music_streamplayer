<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/75b7604b-3509-4a48-beed-c2ebc5890fd3

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Persistence and Auto-Playback Update

This version changes the player so the server is the shared source of truth for Prayer and Advertisement configuration.

- Uploaded Prayer/Advertisement files are permanently assigned to their role on the server.
- Prayer track and daily prayer times are saved server-side and load on every PC/device using the app.
- Advertisement tracks, sequence, interval, and enabled state are saved server-side and load on every PC/device.
- Browser localStorage is only an offline fallback/cache; it no longer overrides newer server settings.
- Search/main tracks automatically continue to another random track when a track ends.
- In prayer, NO advertisement track should ever be played: only the devotional prayer track plays.
- If an advertisement was active when prayer time arrives, it is immediately stopped and cleared; it does NOT resume after prayer.
- When Prayer ends, only the main music/playlist track resumes. The advertisement interval timer begins a fresh cycle of normal music playback before any ad can play.
- Advertisement tracks can never be assigned, selected, or played as prayer audio.
- Server-side uploaded files remain the shared audio source; each PC does not need to upload or select the same file again.

**Important hosting note:** the server must use persistent storage for its `data/` and `uploads/` directories. If the hosting provider uses an ephemeral filesystem, files/settings can still disappear after a redeploy or restart; use a persistent disk/volume or external database/object storage.
