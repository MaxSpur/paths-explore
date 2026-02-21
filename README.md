# Path Segments

Map-first track viewer/editor built with Vite + TypeScript + Leaflet.

## Features

- OSM map with Leaflet rendering.
- Import multiple `.gpx`, `.kml`, `.geojson`, and `.json` files.
- Multi-track display with deterministic per-track colors.
- Per-track toggles for path visibility and point visibility.
- Basic editing for one track at a time:
  - Select edit interaction mode in the **Edit** panel:
    - **Move points mode**: drag selected points
    - **Marquee selection mode**: drag box on map to select points
  - click point to select
  - Shift-click to add/remove points from selection
  - Shift-drag on map to marquee-select points in the editing track (also works in Move mode)
  - drag point to move
  - `Delete`/`Backspace` to remove selected point(s)
- Track list supports:
  - **Collapse** / **Expand** all track cards
  - clicking a track header to toggle that card between collapsed and expanded
- Partial import failure handling (valid files still load).

## Local development

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```

## Build

```bash
npm run build
```

## GitHub Pages

- Vite production base is set to `/Path-Segments/` in `vite.config.ts`.
- Workflow file: `.github/workflows/deploy.yml`.
- In repository settings, set Pages source to **GitHub Actions**.
