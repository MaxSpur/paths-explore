# CODEX_MEMO

## CURRENT_TASK
Extend the path viewer/editor with velocity-based segment visualization using imported perceptual colormaps.

## CURRENT_SUBTASK
Enable full-page drag/drop importing and tighten visual centering of compact edit mode buttons.

## ARCHITECTURE_FACTS
- Workspace started empty.
- Git repository was initialized during session.
- Target runtime is Vite dev server (`npm run dev`) and static GitHub Pages deployment.
- Pages deploy is handled by `.github/workflows/deploy.yml` on push to `master` or `main` plus manual dispatch.
- `dist/` is git-ignored and should not be committed; Actions artifact upload publishes built output.
- Vite build `base` is now `./` (relative assets) instead of hardcoded `/Path-Segments/`.
- Local git push config explicitly set:
  - `branch.master.remote=origin`
  - `branch.master.merge=refs/heads/master`
  - `branch.master.pushRemote=origin`
  - `remote.pushDefault=origin`
  - `push.default=upstream`
- Baseline scaffold created: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, and source/test folders.
- App modules:
  - `src/io/parsers.ts` normalizes GPX/KML/GeoJSON into track arrays (LineString/MultiLineString only).
  - `src/io/fileImport.ts` performs multi-file import with partial-failure reporting.
  - `src/io/persistence.ts` stores/restores tracks in IndexedDB (`path-segments` DB).
  - `src/io/serializers.ts` exports tracks to GPX/KML/GeoJSON text.
  - `src/map/mapView.ts` renders polylines and point markers, including edit drag behavior.
  - `src/map/velocity.ts` computes segment velocities from point timestamps and supports auto/fixed scaling.
  - `src/colormaps/index.ts` loads CSV colormaps (currently CET-L08) and samples colors by normalized value.
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
  - Edit panel now exposes `move`, `marquee`, and `lasso` modes:
    - `move`: point dragging enabled; Shift-drag marquee still available.
    - `marquee`: drag on map creates marquee selection; Shift makes it additive.
    - `lasso`: freehand selection on map; Shift makes it additive.
  - Holding Space temporarily switches to pan behavior (left-drag map) in any edit mode.
- Sidebar track list behavior:
  - Global `Collapse` and `Expand` controls in tracks header.
  - Per-track collapse toggle by clicking track header row.
  - Collapsed cards show header + color dot only.
  - Track actions include export in original format family (`gpx`, `kml`, `geojson`/`json`).
- Velocity visualization behavior:
  - New sidebar Velocity section toggles segment coloring by speed.
  - Scale modes: `auto` (max from all loaded tracks) and `fixed` (user-entered max km/h).
  - Segment velocity uses consecutive point distance and timestamp delta; segments without valid timing render at colormap minimum.
  - Colormap selection is CSV-backed and loaded from discovered files.
  - Map now shows an on-map velocity legend (gradient, min/max labels, scale mode note).
  - Colormaps are now auto-discovered from `src/colormaps/*.csv` at build/dev time and listed automatically in the Velocity selector.
  - Fixed max control now supports 0..350 km/h and uses synchronized number + range slider inputs.
- Sidebar editing UX:
  - Edit modes are compact single-row pills (`Move`, `Marquee`, `Lasso`) with descriptions moved into hover tooltips.
- Import UX:
  - Dedicated drop box removed; users can now drag and drop files anywhere on the page.
  - Import section uses a compact hint line instead of a large drop target block.

## KEY_DECISIONS
- Stack: Vite + Vanilla TypeScript.
- Map: Leaflet with OSM tile layer.
- Input formats: GPX, KML, GeoJSON.
- Default rendering: polyline first, per-track points toggle.
- Editing v1: point move/delete only.

## OPEN_ITEMS
- Optional: support custom display names/metadata per colormap instead of filename-derived labels.

## GIT_UI_PUSH_SETUP
- Goal: make Codex UI `Push` work via plain `git push` without manual remote args.
- One-time machine setup:
  - Use SSH for GitHub remotes by default:
    - `git config --global url."git@github.com:".insteadOf "https://github.com/"`
  - Ensure SSH auth works:
    - `ssh -T git@github.com` (should print successful auth message)
  - Optional reliability defaults:
    - `git config --global push.default upstream`
    - `git config --global remote.pushDefault origin`
- Per-new-repo minimum:
  - Ensure remote is SSH: `git remote -v` should show `git@github.com:...`
  - After first commit, set upstream once:
    - `git push -u origin $(git branch --show-current)`
  - After upstream exists, Codex UI push should work with plain `git push`.

## PRUNE_NOTES
- Initial memo created with only durable project-level decisions.
- Omitted ephemeral command outputs and intermediate scaffolding steps.
- Pruned temporary implementation details that are now reflected directly in source files.
- Removed obsolete note about blocked local verification; tests/build now pass in-session.
