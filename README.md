# Path Segments

Path Segments is a map-first tool for inspecting, editing, and comparing movement tracks in the browser.

It is built for two related workflows:

- everyday track work with GPX, KML, GeoJSON, and CSV files
- large preprocessed bundle work, where many trajectories or OD flows need to be rendered quickly without turning the app into a full GIS stack

Live app: [maximspur.com/paths-explore](https://www.maximspur.com/paths-explore)

## What it can do

- Import `.gpx`, `.kml`, `.geojson`, `.json`, `.csv`, `.zip`, and generated `.psbundle.zip` bundles
- Show multiple tracks at once with deterministic colors and explicit draw order
- Edit one track at a time with `Move`, `Marquee`, `Lasso`, and `Info` modes
- Undo and redo point edits, deletions, visibility changes, and track reordering
- Export edited tracks back out as GPX, KML, or GeoJSON-family output
- Analyze tracks by `Velocity` or `Acceleration` with interactive color scales and ranked peak navigation
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

### 1. Load tracks

You can drag files anywhere onto the page or use the import control in the sidebar.

Supported direct inputs:

- GPX
- KML
- GeoJSON / JSON
- CSV
- ZIP archives containing those file types

Once loaded, each track gets its own card with:

- `Visible`
- `Lines`
- `Points`
- `Edit`
- `Focus`
- `Export`
- `Delete`

Tracks can be reordered in the sidebar, and that order controls which tracks render on top.

### 2. Edit geometry

Only one track is editable at a time.

Available edit modes:

- `Move`: drag selected points
- `Marquee`: drag a box to select points
- `Lasso`: freehand point selection
- `Info`: inspect segment values and point details

Useful shortcuts:

- `Shift`: add to the current selection
- `Space`: temporarily pan the map while editing
- `Delete` / `Backspace`: delete selected points
- `Escape`: clear the current selection
- `Cmd+Z` / `Ctrl+Z`: undo
- `Shift+Cmd+Z`, `Ctrl+Shift+Z`, or `Ctrl+Y`: redo

### 3. Use analysis modes

The `Analysis` section supports four modes:

- `Off`
- `Velocity`
- `Acceleration`
- `OD`

For track-based modes:

- choose a colormap
- use `Auto` or `Fixed` scale
- inspect ranked peaks with `Top Peak` and `Next Peak`

For OD mode:

- choose `Color / Rank by`
- choose `Draw on top by`
- optionally use `Link Metrics` and `Link Variant/Value` to keep the two selector stacks synchronized
- inspect ranked flows with `Top Flow` and `Next Flow`
- extract the selected OD edge into the normal editable track workflow with `Extract Selected`

The bottom-right analysis panel is shared across modes and includes the current color scale, histogram, and ranking controls.

## Parquet and bundle workflow

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

- [configs/trajectory-points.bundle.example.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/trajectory-points.bundle.example.json)
- [configs/weighted-od.bundle.example.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/weighted-od.bundle.example.json)
- [configs/emg-centroids.bundle.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/emg-centroids.bundle.json)
- [configs/emg-overlay.bundle.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/emg-overlay.bundle.json)
- [configs/emg-weighted-od.bundle.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/emg-weighted-od.bundle.json)

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

This project is licensed under [Apache-2.0](/Users/MadMax/Developer/Websites/Path-Segments/LICENSE).

## Local-only working files

Some files in a working copy may still exist for local development or agent workflow purposes, but the repository is configured so generated output, local data, local certs, and internal scratch notes are not meant to be part of normal published source history.
