# Path Segments

Path Segments is a map-first browser tool for inspecting, comparing, recoloring, and editing movement tracks.

Its main job is individual track work: load GPX/KML/GeoJSON/CSV traces, study them on a map, color them by velocity or acceleration, jump to peaks, and correct the geometry point by point.

It also has a secondary bundle workflow for preprocessed large datasets and OD graphs, but that part is still more experimental.

Live app: [maximspur.com/paths-explore](https://www.maximspur.com/paths-explore)

## Demo

> Placeholder: add a short demo GIF here later, ideally showing the main workflow:
> import a GPX track, switch to `Velocity` or `Acceleration`, jump through `Top Peak` / `Next Peak`, and edit a few points on the map.
>
> Suggested asset path when ready: `docs/path-segments-demo.gif`

## What it can do

- Import `.gpx`, `.kml`, `.geojson`, `.json`, `.csv`, `.zip`, and generated `.psbundle.zip` bundles
- Show multiple tracks at once with deterministic colors and explicit draw order
- Switch between several background maps and tune them with a neutral-centered `Lighten / Darken` slider and `Desaturate`
- Color tracks by `Velocity` or `Acceleration` with perceptual colormaps
- Inspect ranked extremes with `Top Peak` and `Next Peak`
- Inspect segment values, coordinates, timing, and distances in `Info` mode
- Edit one track at a time with `Move`, `Marquee`, `Lasso`, and `Info` modes
- Undo and redo point edits, deletions, visibility changes, and track reordering
- Export edited tracks back out as GPX, KML, or GeoJSON-family output
- Persist normal editable tracks locally in the browser across reloads
- Analyze preprocessed OD bundles with interactive colormaps, ranking, histograms, and explicit extraction of selected flows into normal editable tracks

## Quick start

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

Notes:

- The dev server prefers port `5174`, but will automatically fall through to the next free port.
- Imported editable tracks are persisted locally in IndexedDB across reloads.
- Bundle imports are intentionally not persisted and do not enter undo history.

## How to use it

### 1. Load one or more tracks

Drag files anywhere onto the page or use the file picker in the `Import` section.

Supported direct inputs:

- GPX
- KML
- GeoJSON / JSON
- CSV
- ZIP archives containing the file types above

Imported editable tracks are restored from IndexedDB on the next reload, so your current working set comes back automatically unless you delete tracks yourself.

### 2. Organize what you see

Each loaded track gets a sidebar card with the main controls:

- `Visible`: hide or show the whole track
- `Lines`: show or hide the polyline itself
- `Points`: show or hide point markers
- `Edit`: enter or leave editing for that track
- `Focus`: zoom the map to that track
- `Export`: write the current version back out
- `Delete`: remove it from the session

Useful details:

- Reordering track cards changes draw order. Tracks nearer the top render on top of lower ones.
- `Lines` and `Points` let you reduce clutter when comparing several traces. The app keeps at least one of them active so a visible track does not become impossible to locate.
- When a track is being edited, points are shown automatically even if `Points` was off before.

The `Map` section controls the basemap itself. Current background styles are:

- `OSM Standard`
- `CARTO Light`
- `CARTO Positron`
- `CARTO Positron (No Labels)`
- `CARTO Dark`
- `CARTO Voyager`

Use `Lighten / Darken` and `Desaturate` to push the basemap further into the background, or brighten it when a darker background style needs a little more separation. The midpoint of the brightness slider is neutral.

### 3. Analyze a track visually

For normal path work, the important `Analysis` modes are:

- `Off`
- `Velocity`
- `Acceleration`

`Velocity` and `Acceleration` color track segments directly on the map. Typical workflow:

1. Choose `Velocity` or `Acceleration` in the `Analysis` section.
2. Pick a perceptual colormap from the dropdown.
3. Choose `Auto` scale to adapt to the currently visible tracks, or `Fixed` scale when you want stable comparisons across several views or sessions.

The bottom-right analysis panel is the main visual aid for these modes:

- The colored bar shows the current colormap and value range.
- Clicking the colored bar cycles to the next colormap quickly.
- The histogram shows how segment values are distributed across the current visible analysis set.
- Clicking the histogram cycles between `standard`, `precision`, and `hidden`.
- `L/L`, `L/G`, `G/L`, and `G/G` switch the histogram axes between linear and logarithmic scaling.
- `Top Peak` jumps to the strongest currently ranked segment.
- `Next Peak` walks down the ranked list of segments one by one.
- When the histogram is visible, you can drag the panel's top-left corner to resize it.

Peak navigation is especially useful while cleaning a track. If one track is currently in edit mode, the ranking controls operate on that track so you can step through suspicious spikes and correct them directly.

### 4. Inspect specific segments and points

Turn on `Edit` for one track to work on it directly. Only one track is editable at a time.

Edit modes:

- `Move`: drag selected points to new locations
- `Marquee`: drag a rectangle to select points
- `Lasso`: draw a freehand region to select points
- `Info`: click colored segments to inspect them without moving geometry

`Info` mode is often the fastest way to understand a suspicious segment. The popup can show:

- the current velocity or acceleration value
- segment index range
- distance and duration, when timing exists
- both endpoint coordinates
- endpoint timestamps, when available

### 5. Edit geometry

Once points are selected, you can reshape the track directly on the map.

Useful shortcuts:

- `Shift`: add to the current selection
- `Space`: temporarily pan the map while editing
- `Delete` / `Backspace`: delete selected points
- `Escape`: clear the current selection
- `Cmd+Z` / `Ctrl+Z`: undo
- `Shift+Cmd+Z`, `Ctrl+Shift+Z`, or `Ctrl+Y`: redo

Undo and redo cover point moves, deletions, visibility changes, points/lines toggles, and track reordering.

### 6. Export or keep working later

Use `Export` on a track card to write the current geometry back out. The app exports in the same general format family used elsewhere in the toolchain: GPX, KML, or GeoJSON-style output depending on the track.

If you are just pausing work, you usually do not need to export immediately. Normal tracks persist in the browser and reload automatically on the next visit.

### 7. Experimental: bundles and OD mode

`OD` mode and `.psbundle.zip` imports are available, but they are still secondary to the normal track workflow above.

Use them when you already have preprocessed high-volume data and want lightweight rendering, not when you simply want to inspect and edit one or a few tracks. Bundle behavior is intentionally different:

- bundles render in a separate lightweight layer
- bundles are not persisted in IndexedDB
- bundles do not enter undo/redo history
- OD bundles are selected first and only extracted into a normal editable track when you explicitly ask for it

## Experimental parquet and bundle workflow

Raw parquet is not loaded directly in the browser.

Instead:

1. preprocess parquet locally into a `.psbundle.zip`
2. import that bundle into the app

This keeps high-volume rendering lightweight and avoids shipping a heavy parquet reader plus schema inference into the frontend.

### Supported bundle preprocessing modes

- `trajectory_points`
  - row-per-point trajectory parquet
  - grouped by trajectory id
  - optional representative decimation with `trajectory_limit` and `trajectory_sampling_mode`

- `weighted_od_graph`
  - builds centroid-to-centroid OD edges from a parquet trip table
  - supports rich OD metrics such as:
    - `weight`
    - `tripCount`
    - weighted mean duration
    - categorical subtotal/share metrics
    - departure-time subtotal/share metrics

- `geoparquet_overlay`
  - reads point or polygon GeoParquet geometry columns for lightweight overlay visualization

### Install the parquet dependency

```bash
python3 -m pip install pyarrow
```

### Generate a bundle

Example: weighted OD bundle from a local parquet file referenced by the sample config.

```bash
python3 scripts/parquet_to_bundle.py \
  --config configs/emg-weighted-od.bundle.json \
  --output output/emg-weighted-od.psbundle.zip
```

Other useful starting points:

- [configs/trajectory-points.bundle.example.json](configs/trajectory-points.bundle.example.json)
- [configs/weighted-od.bundle.example.json](configs/weighted-od.bundle.example.json)
- [configs/emg-centroids.bundle.json](configs/emg-centroids.bundle.json)
- [configs/emg-overlay.bundle.json](configs/emg-overlay.bundle.json)
- [configs/emg-weighted-od.bundle.json](configs/emg-weighted-od.bundle.json)

### Import the bundle

Load the generated `.psbundle.zip` the same way you would load any other file.

Bundle behavior is intentionally different from normal tracks:

- bundles render in a separate lightweight layer
- they are not persisted in IndexedDB
- they do not enter undo/redo history
- OD bundles are selected first and only extracted when you explicitly ask for it

## Local data and generated files

This repository is intended to stay lightweight.

The following are expected to be local-only and are git-ignored:

- large parquet or GeoJSON source files under `data/`
- generated bundle output under `output/`
- local HTTPS certs under `certs/`
- repo-local Python dependency installs such as `.vendor-py/`

If you want to reproduce bundle examples, place your own source parquet files under `data/` and generate new bundles locally.

## Optional HTTPS for local development

If you want the dev server over HTTPS:

1. create a local certificate, for example with [mkcert](https://github.com/FiloSottile/mkcert)
2. store the files under `certs/`
3. create `.env.development.local`

Example:

```bash
VITE_DEV_HTTPS=true
VITE_DEV_SSL_CERT=certs/localhost.pem
VITE_DEV_SSL_KEY=certs/localhost-key.pem
```

If HTTPS is enabled but the cert paths are missing or invalid, the app falls back to HTTP.

## Development

Useful commands:

```bash
npm run dev
npm test
npm run build
```

The app is a Vite + TypeScript + Leaflet project and is designed to deploy as a static site.

## Deployment

GitHub Pages deployment is handled by `.github/workflows/deploy.yml`.

The current public deployment is available at [maximspur.com/paths-explore](https://www.maximspur.com/paths-explore).

Repository expectations:

- GitHub Pages source should be set to GitHub Actions
- built output comes from `dist/`
- `dist/` itself is not committed

## License

This project is licensed under [Apache-2.0](LICENSE).

## Local-only working files

Some files in a working copy may still exist for local development or agent workflow purposes, but the repository is configured so generated output, local data, local certs, and internal scratch notes are not meant to be part of normal published source history.
