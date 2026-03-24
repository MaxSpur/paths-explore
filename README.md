# Path Segments

Map-first GPX/KML/GeoJSON/CSV viewer and editor built with Vite + TypeScript + Leaflet.

## Core capabilities

- Render OpenStreetMap tiles with Leaflet.
- Import multiple files at once: `.gpx`, `.kml`, `.geojson`, `.json`, `.csv` (including BT-Q1000XT-style CSV), and `.zip` archives containing supported path files.
- Import generated `.psbundle.zip` bundle archives for high-volume trajectory/overlay rendering.
- Drag-and-drop import works anywhere on the page.
- Partial import resilience: one bad file does not block valid files.
- Import camera focus targets only the newly imported track(s), not all previously loaded tracks.
- IndexedDB persistence for loaded/edited tracks across reloads.
- Export each track in its original format family (GPX/KML/GeoJSON/CSV).

## Track and sidebar UX

- Deterministic per-track coloring.
- Per-track pills: `Visible`, `Lines`, `Points`, `Edit`.
- Per-track actions: `Focus`, `Export`, `Delete`.
- Track card collapse/expand per track + global `Collapse`/`Expand`.
- Track draw-order controls (up/down), reflected in map overlap order.
- Sidebar sections are collapsible/reorderable and persisted in localStorage.
- Map section includes basemap style presets plus darken/desaturate sliders for the base tiles.

## Editing

- One active editing track at a time.
- Edit modes: `Move`, `Marquee`, `Lasso`, `Info`.
- Multi-select points with Shift behaviors.
- Move selected points by dragging; connected segments update live while dragging.
- Delete selected points with `Delete`/`Backspace`.
- After manual delete, selection advances to the next point on that track (or previous if last point was deleted).
- `Escape` clears selection.
- Hold `Space` to temporarily pan while in any edit mode.

## Undo/redo

- Undo/redo is global for track mutations and point edits, including:
  - point move/delete
  - track add/remove
  - track visibility and geometry display toggles
  - track reordering
- Shortcuts:
  - Undo: `Cmd+Z` / `Ctrl+Z`
  - Redo: `Shift+Cmd+Z`, `Ctrl+Shift+Z`, or `Ctrl+Y`
- Analysis panel settings are persisted, but not part of undo history.
- Off-screen undo/redo navigation:
  - if an undo/redo change is already visible in the current map view, camera does not move
  - if the changed geometry is outside the current view, the map auto-focuses that changed area

## Analysis modes and legend

- Analysis modes: `Off`, `Velocity`, `Acceleration`, `OD`.
- Velocity/acceleration scale modes: `Auto` (visible tracks) or `Fixed`.
- OD mode colors weighted OD edges with the same perceptual colormap system used for track metrics.
- CSV colormap auto-discovery from `src/colormaps/*.csv`.
- `Info` mode can open segment popups with metric/distance/duration/point details.
- Peak popups are anchored to the selected segment endpoint (not midpoint) and use a translucent panel to reduce path occlusion.
- Legend supports:
  - histogram mode cycle (`standard`, `precision`, `hidden`)
  - axis scaling combinations (`L/L`, `L/G`, `G/L`, `G/G`)
  - ranked navigation for track metrics with `Top Peak` and `Next Peak`
  - ranked navigation for OD mode with `Top Flow`, `Next Flow`, and `Extract Selected`
  - when editing is active, peak ranking/filtering is scoped to the editing track
  - peak navigation auto-selects the ranked endpoint for immediate move/delete
  - after peak-driven delete, rank continuity is preserved and map refocus/selection is reapplied with a short delay
  - corner resize when histogram is visible

## Local development

```bash
npm install
npm run dev
```

Defaults:

- Dev server host: `0.0.0.0` (`--host` no longer required).
- Preferred dev port: `5174`.
- If that port is busy, Vite now auto-selects the next free port (set `VITE_STRICT_PORT=true` to force fail-fast behavior).

## Parquet bundle workflow

Phase 1 keeps raw parquet decoding outside the browser. The app imports generated `.psbundle.zip` archives, not raw `.parquet` files.

### 1. Install the Python parquet dependency

```bash
python3 -m pip install pyarrow
```

### 2. Create a bundle config

The converter accepts a JSON config with explicit schema mappings.

- `trajectory_points` inputs expect row-per-point parquet with explicit `trajectory_id_column`, `lat_column`, `lng_column`, and optional ordering/time/metadata fields.
- `trajectory_points` can also cap bundle density with `trajectory_limit` and `trajectory_sampling_mode`.
- `weighted_od_graph` inputs aggregate centroid-to-centroid OD edges from a parquet trip table and emit weighted straight-line bundle trajectories.
- `geoparquet_overlay` inputs read point/polygon WKB geometry columns from GeoParquet sources.

`trajectory_sampling_mode: "decimate"` is the recommended default when you want a representative sample instead of the first `N` grouped trajectories.

Example config for the geometric sample parquet in `./data`:

- [configs/emg-centroids.bundle.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/emg-centroids.bundle.json)
- [configs/emg-overlay.bundle.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/emg-overlay.bundle.json)
- [configs/emg-weighted-od.bundle.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/emg-weighted-od.bundle.json)
- [configs/trajectory-points.bundle.example.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/trajectory-points.bundle.example.json)
- [configs/weighted-od.bundle.example.json](/Users/MadMax/Developer/Websites/Path-Segments/configs/weighted-od.bundle.example.json)

### 3. Generate a runtime bundle

For a fast first-pass visualization of the sample data, generate the centroid-only bundle:

```bash
python3 scripts/parquet_to_bundle.py \
  --config configs/emg-centroids.bundle.json \
  --output output/emg-centroids.psbundle.zip
```

The full point+polygon overlay sample is still available, but it is much heavier:

```bash
python3 scripts/parquet_to_bundle.py \
  --config configs/emg-overlay.bundle.json \
  --output output/emg-overlay.psbundle.zip
```

For row-per-point trajectory parquet, start from the trajectory example config and adjust the column names:

```bash
python3 scripts/parquet_to_bundle.py \
  --config configs/trajectory-points.bundle.example.json \
  --output output/trajectory-sample.psbundle.zip
```

For the current EMG trip table, generate weighted straight-line OD edges from centroid lookup plus `poids_jour`:

```bash
python3 scripts/parquet_to_bundle.py \
  --config configs/emg-weighted-od.bundle.json \
  --output output/emg-weighted-od.psbundle.zip
```

### 4. Import the bundle in the app

Load the generated `.psbundle.zip` file through the normal import control or drag-and-drop.

- Bundles render in a separate lightweight map layer.
- Bundle state is not persisted in IndexedDB and does not enter undo/redo history.
- In OD mode, clicking a weighted OD edge selects and highlights it in the analysis panel instead of extracting it.
- Weighted OD extraction is explicit through the analysis panel `Extract Selected` button.
- Outside OD mode, ordinary path bundles can still be clicked to promote a bundled trajectory into the normal editable track flow.

Notes:

- The current `data/emg-base-des-deplacements.parquet` sample is directly visualizable as GeoParquet overlays.
- The current `data/emg-base-des-deplacements.parquet` sample can also be converted into weighted centroid-to-centroid OD lines with `weighted_od_graph`.
- `configs/emg-centroids.bundle.json` is the recommended first-pass sample because it stays lightweight; `configs/emg-overlay.bundle.json` also includes polygons and produces a much larger bundle.
- `data/emg-base-des-deplacements-2.geojson` is a row-by-row GeoJSON export of the same EMG trip table, not a compact zone lookup, so the parquet remains the recommended OD preprocessing source.
- The current `data/date_heure_1h_micro.parquet` sample appears to be an aggregated OD/time table without geometry columns, so phase 1 does not render it directly on the map without an external geometry join.

### Run over HTTPS locally

You can copy `.env.example` to `.env.development.local` and adjust values.

1. Generate a local certificate/key pair (recommended: [mkcert](https://github.com/FiloSottile/mkcert)).
2. Store files in the repo, for example `certs/localhost.pem` and `certs/localhost-key.pem`.
3. Add a `.env.development.local` file:

```bash
VITE_DEV_HTTPS=true
VITE_DEV_SSL_CERT=certs/localhost.pem
VITE_DEV_SSL_KEY=certs/localhost-key.pem
```

4. Start dev server:

```bash
npm run dev
```

If `VITE_DEV_HTTPS=true` is set but cert paths are missing/invalid, config falls back to HTTP and logs a warning.

## Testing and build

```bash
npm test
npm run build
```

## GitHub Pages deployment

- Workflow: `.github/workflows/deploy.yml` (push to `master` or `main`, plus manual dispatch).
- Vite base is relative (`./`) for repo rename/custom-domain safety.
- In repository settings, set Pages source to **GitHub Actions**.
- Commit source files only; CI builds and publishes `dist`.
- `dist/` is intentionally git-ignored.
