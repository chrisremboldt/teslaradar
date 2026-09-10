# TeslaRadar

Personal live weather radar for **Chris Remboldt**. A phone-first, dark, glanceable map that centers on wherever the browser says you are, overlays animated RainViewer radar, and follows device heading when Chromium exposes a compass.

Production target: [https://teslaradar.vercel.app](https://teslaradar.vercel.app)

## What it does

- Requests `navigator.geolocation`, shows lat/lon, accuracy, and last-updated time.
- Re-polls location every **5 minutes**, and again on tab visibility resume or **Refresh now**.
- Persists the last successful GPS fix in `localStorage` so the first paint is not blank while GPS wakes.
- Overlays animated RainViewer radar as a georeferenced canvas/`<img>` layer on a free OpenStreetMap raster basemap (darkened in MapLibre). Radar is not painted through MapLibre raster sources — Tesla Chromium’s WebGL/tile cache froze that path. No Mapbox or Carto token.
- Plays the past ~2 hours of radar (10-minute steps). Pause/play is in the HUD. The footer playhead shows the current frame time and index; a quieter **Latest** line shows the newest RainViewer past frame’s clock time and relative age (data freshness, not the animation playhead).
- Default map mode is **heading-up** (rotate with the device compass). Uses Device Orientation / `AbsoluteOrientationSensor` / `deviceorientationabsolute` when available. iOS needs a tap on **Enable compass**. If heading is missing, the map falls back to north-up and the HUD shows a muted “compass unavailable” note — the app still works. A control toggles north-up vs heading-up.
- If location is denied or unavailable, you get a clear error plus labeled **DEMO** maps for Nashville, TN or Traverse City, MI (used only as a fallback, never as a silent substitute for a live fix).
- **Follow me** is on for first paint and cold loads (prefs schema v2). Older `teslaradar:prefs` blobs that stored `followMe: false` from a pan are migrated once — follow is re-enabled, heading-up / animate-radar are kept. Panning or tapping Follow me off still sticks for the rest of that session; a hard refresh recenters. The control reads **Following** vs **Follow me**.

v1 location source is **Chromium browser APIs only**. Tesla Fleet API / OAuth is intentionally not implemented. A comment in the geolocation hook marks that as a future option.

## Location, radar, and compass

| Piece | How it works |
| --- | --- |
| Location | `navigator.geolocation.getCurrentPosition` in the browser. 5-minute interval + visibility + manual refresh. Coordinates never leave the device. |
| Radar | Client fetch of `https://api.rainviewer.com/public/weather-maps.json`. Coordinate-centered images: `{host}{path}/{size}/{z}/{lat}/{lon}/{color}/{options}.png` (512px, Universal Blue scheme `2`, zoom ≤7) preloaded and swapped on a canvas overlay. Free-tier notes (2026): past frames ~2h / 10 min, rate limit on the order of 100 req/IP/min. |
| Compass | Sensor / orientation events. Optional `?heading=247` simulates a heading for development or screenshots (labeled **Simulated heading**). |
| Map | MapLibre GL + OSM raster tiles (darkened). No Mapbox or Carto token. Follow-me recenters. Default is heading-up (map rotates with compass); north-up is a toggle. Falls back to north-up if heading is missing. |

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
