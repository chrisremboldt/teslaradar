# TeslaRadar

Personal live weather radar for **Chris Remboldt**, built for the **Tesla in-car browser**. A dark, glanceable map that centers on wherever the browser says you are, overlays the latest RainViewer radar frame, and points the ownship triangle along a 5-minute averaged GPS track. There is no separate phone profile — every session is the lean in-car path.

Production target: [https://teslaradar.vercel.app](https://teslaradar.vercel.app)

## What it does

- Requests `navigator.geolocation`, shows lat/lon, accuracy, and last-updated time.
- Re-polls location every **4 seconds**. Never starts `watchPosition`. Poll ticks may reuse a ≤3s reading. Tab visibility resume and **Refresh now** still request a fresh lock.
- Persists the last successful GPS fix in `localStorage` (at most once every 20s) so the first paint is not blank while GPS wakes.
- Overlays the **latest** RainViewer radar frame as a georeferenced canvas/`<img>` layer on a free OpenStreetMap raster basemap (darkened in MapLibre). Radar is not painted through MapLibre raster sources — Tesla Chromium’s WebGL/tile cache froze that path. Play is optional. No Mapbox or Carto token.
- Catalog is the past ~2 hours of radar (10-minute steps), refreshed about every 8 minutes while the tab is visible. Default is latest-frame only. Pause/play is in the HUD. The footer playhead shows the current frame time and index; a quieter **Latest** line shows the newest RainViewer past frame’s clock time and relative age.
- The ownship chevron prefers a **5-minute circular-mean GPS track heading**, then `coords.heading` when the track is still thin. Ground speed prefers a fresh `coords.speed` (m/s) for 5/30 min rings; otherwise net displacement over ~24s (not a single 20 m hop). Hysteresis holds moving through a stoplight and ignores parked jitter. Device compass is optional: it still drives the compass badge, and heading-up prefers compass then falls back to track / GPS course.
- Default map mode is **heading-up** from the GPS track. Device orientation sensors are not used (they have crashed Tesla Chromium). If track heading is missing, the map stays north-up and the HUD shows a muted “compass unavailable” note. A control toggles north-up vs heading-up. Optional `?heading=247` simulates a heading for screenshots.
- If location is denied or unavailable, you get a clear error plus labeled **DEMO** maps for Nashville, TN or Traverse City, MI (used only as a fallback, never as a silent substitute for a live fix).
- **Follow me** is on for first paint and cold loads (prefs schema v2). Older `teslaradar:prefs` blobs that stored `followMe: false` from a pan are migrated once — follow is re-enabled, heading-up / animate-radar are kept. Panning or tapping Follow me off still sticks for the rest of that session; a hard refresh recenters. The control reads **Following** vs **Follow me**.

v1 location source is **Chromium browser APIs only**. Tesla Fleet API / OAuth is intentionally not implemented. A comment in the geolocation hook marks that as a future option.

## Location, radar, and compass

| Piece | How it works |
| --- | --- |
| Location | `navigator.geolocation.getCurrentPosition` only. 4s interval + visibility + manual refresh. Never `watchPosition`. Poll ticks accept a reading up to 3s old so track heading and range rings stay live without a full GPS lock each tick. **Refresh now** and visibility resume still use `maximumAge` 0. Coordinates never leave the device. |
| Ownship | Rolling in-memory GPS track (last 5 minutes). Chevron prefers the distance-weighted circular mean of segment bearings, then native `coords.heading`. Speed prefers native `coords.speed`, then net displacement over ~24s. 5- and 30-minute rings are speed × time (SVG above the radar). Parked jitter and a single awful accuracy sample must not invent course or giant rings. |
| Radar | Client fetch of `https://api.rainviewer.com/public/weather-maps.json`. Coordinate-centered images: `{host}{path}/{size}/{z}/{lat}/{lon}/{color}/{options}.png` (512px, Universal Blue scheme `2`, zoom ≤7). Default is the latest frame only (image cache cap 1). Play is optional. Free-tier notes (2026): past frames ~2h / 10 min, rate limit on the order of 100 req/IP/min. |
| Heading | GPS track (and native `coords.heading` when the track is thin). No DeviceOrientation. Optional `?heading=247` simulates a heading for development or screenshots (labeled **Simulated heading**). |
| Map | MapLibre GL + OSM raster tiles (darkened). No Mapbox or Carto token. Follow-me recenters with `jumpTo` at most twice a second (no `easeTo`). 1× pixel ratio, 8-tile / 1-zoom GL cache, no HUD backdrop-filter, 4s location poll. `?tesla=1` is ignored — lean mode is the only path. |

**Radar data by [RainViewer](https://www.rainviewer.com/api.html).** Basemap © OpenStreetMap contributors.

## Privacy

Location is read and stored only in the browser (`localStorage` for the last GPS fix and UI prefs). There is no backend location store and no API routes that receive coordinates. RainViewer and Carto see standard map-tile requests from the client, not a TeslaRadar server.

No environment variables and no Tesla API keys are required or committed.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Allow location when prompted. On a desktop without GPS you will see the DEMO fallback after the browser denies or fails geolocation.

Other scripts:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

No `.env` file is needed for v1.

## Deploy to teslaradar.vercel.app

1. Push this repo to GitHub (already `chrisremboldt/teslaradar` if you are in the original project).
2. In [Vercel](https://vercel.com) → **Add New…** → **Project** → import the Git repository.
3. Set the Vercel **project name** to `teslaradar`. That is what gives you `https://teslaradar.vercel.app` on the hobby/pro URL scheme (the name must be free on that Vercel account/team).
4. Framework preset: **Next.js**. Root directory: repo root. Build command `next build`, output as default.
5. Environment variables: **none**.
6. Deploy the `main` branch for production. Preview deployments will use `*.vercel.app` aliases automatically.

PWA-lite: a web manifest and icons are included so you can Add to Home Screen. This is not a full offline service worker.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS v4 + MapLibre GL. Deployable on Vercel as a standard Next.js app.
