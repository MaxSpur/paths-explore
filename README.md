# Path Segments

Map-first GPX/KML/GeoJSON/CSV viewer and editor built with Vite + TypeScript + Leaflet.

## Core capabilities

- Render OpenStreetMap tiles with Leaflet.
- Import multiple files at once: `.gpx`, `.kml`, `.geojson`, `.json`, `.csv` (including BT-Q1000XT-style CSV).
- Drag-and-drop import works anywhere on the page.
- Partial import resilience: one bad file does not block valid files.
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
- Velocity panel settings are persisted, but not part of undo history.
- Off-screen undo/redo navigation:
  - if an undo/redo change is already visible in the current map view, camera does not move
  - if the changed geometry is outside the current view, the map auto-focuses that changed area

## Segment coloring and legend

- Segment coloring modes: `Velocity` and `Acceleration`.
- Scale modes: `Auto` (visible tracks) or `Fixed`.
- CSV colormap auto-discovery from `src/colormaps/*.csv`.
- Perceptually uniform colormaps for velocity and acceleration visualization.
- `Info` mode can open segment popups with metric/distance/duration/point details.
- Peak popups are anchored to the selected segment endpoint (not midpoint) and use a translucent panel to reduce path occlusion.
- Legend supports:
  - histogram mode cycle (`standard`, `precision`, `hidden`)
  - axis scaling combinations (`L/L`, `L/G`, `G/L`, `G/G`)
  - ranked peak navigation with `Top Peak` (jump to rank `1/x`) and `Next Peak`
  - when editing is active, peak ranking/filtering is scoped to the editing track
  - peak navigation auto-selects the ranked endpoint for immediate move/delete
  - after peak-driven delete, rank continuity is preserved and map refocus/selection is reapplied with a short delay
  - corner resize when histogram is visible

## Local development

```bash
npm install
npm run dev
```

Default dev server: `http://localhost:5174`.

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
