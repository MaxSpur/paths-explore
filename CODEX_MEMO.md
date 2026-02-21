# CODEX_MEMO

## CURRENT_TASK
Build a Vite + Vanilla TypeScript web app for map-based GPX/KML/GeoJSON track loading, visualization, and basic point editing, plus GitHub Pages deployment workflow.

## CURRENT_SUBTASK
Implement Shift-drag marquee selection for editing mode.

## ARCHITECTURE_FACTS
- Workspace started empty.
- Git repository was initialized during session.
- Target runtime is Vite dev server (`npm run dev`) and static GitHub Pages deployment.
- Baseline scaffold created: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, and source/test folders.
- App modules:
  - `src/io/parsers.ts` normalizes GPX/KML/GeoJSON into track arrays (LineString/MultiLineString only).
  - `src/io/fileImport.ts` performs multi-file import with partial-failure reporting.
  - `src/map/mapView.ts` renders polylines and point markers, including edit drag behavior.
  - `src/model/store.ts` handles visibility, point toggles, edit/selection state, and point move/delete mutations.
  - `src/ui/sidebar.ts` renders import controls + per-track actions.
  - `src/ui/editor.ts` wires Delete/Backspace/Escape keyboard editing controls.
- Security/robustness:
  - Sidebar escapes track names before injecting into HTML.
  - Removing a track clears selected point state.
- Selection/editing behavior:
  - `AppState` now tracks `selectedPointIds` for multi-selection.
  - Shift-click toggles points into/out of the active selection (within the same track context).
  - Dragging one selected point in edit mode moves all selected points together.
  - Delete/Backspace removes all selected points in one operation.
  - Point delete no longer triggers map auto-fit.
  - Leaflet default Shift box-zoom is disabled; custom Shift-drag marquee now selects points in the active editing track.

## KEY_DECISIONS
- Stack: Vite + Vanilla TypeScript.
- Map: Leaflet with OSM tile layer.
- Input formats: GPX, KML, GeoJSON.
- Default rendering: polyline first, per-track points toggle.
- Editing v1: point move/delete only.

## OPEN_ITEMS
- Optional future UX: add polygon lasso multi-select.
- Verify deployed `base` behavior in real GitHub Pages repo.

## PRUNE_NOTES
- Initial memo created with only durable project-level decisions.
- Omitted ephemeral command outputs and intermediate scaffolding steps.
- Pruned temporary implementation details that are now reflected directly in source files.
- Removed obsolete note about blocked local verification; tests/build now pass in-session.
