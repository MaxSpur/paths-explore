# CODEX_MEMO

## CURRENT_TASK
Improve velocity legend usability with resize support and persistent view settings.

## CURRENT_SUBTASK
Completed: make legend height resizing drive histogram height (not whitespace below actions), while keeping width-adaptive bins and persistent velocity settings.

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
  - Edit panel now exposes `move`, `marquee`, `lasso`, and `info` modes:
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
  - Sidebar now uses pill controls: `Off` / `Velocity` / `Acceleration` (replacing the old checkbox toggle).
  - Scale mode now uses pill controls: `Auto` / `Fixed` (replacing the old dropdown).
  - Scale modes: `auto` (max from visible loaded tracks) and `fixed` (user-entered max in current metric unit).
  - Segment velocity uses consecutive point distance and timestamp delta; segments without valid timing render at colormap minimum.
  - Acceleration mode colors segments by absolute acceleration magnitude (`m/s²`) from consecutive timed segment velocities.
  - Colormap selection is CSV-backed and loaded from discovered files.
  - Map legend now adapts to active metric (`Velocity` or `Acceleration`) including units.
  - Map legend includes `Next Peak`, cycling through highest metric segments and focusing each one.
  - Map legend includes a colorful, colormap-aligned histogram above the scale with click-cycle modes: `standard` (coarser bins), `precision` (many thin bins, no gaps), `hidden`.
  - Legend histogram includes a compact single-row axis-mode toggle (`L/L`, `L/G`, `G/L`, `G/G`) for linear/log scaling on X and Y independently.
  - X-axis log mode redistributes bins with a log transform while preserving colormap meaning via inverse sampling; Y-axis log mode scales bar heights with log(count).
  - Velocity legend can be resized by dragging its top-left corner; legend width drives histogram bin count in both `standard` and `precision` modes.
  - Histogram now also expands vertically with legend height; extra vertical space is consumed by the histogram instead of blank area below `Next Peak`.
  - Legend minimum height is now histogram-mode-aware (`hidden` < `standard` < `precision`) so controls like `Next Peak` remain visible.
  - Velocity UI settings are persisted in `localStorage` (`path-segments-velocity-settings-v1`) and restored on reload, including selected colormap.
  - While colorized segments are active on the editing track, edit markers switch to minimal ring-style markers so segment colors remain visible.
- Segment info workflow:
  - `Info` mode lets users click timed colorized segments to open a Leaflet popup.
  - Popup content includes metric value, segment index range, distance/duration (when available), and both endpoint coordinates/timestamps.
  - Clicking empty map space closes the active popup.
- Editing toggle behavior:
  - Starting edit on a hidden track now auto-enables that track’s visibility before entering edit mode.
  - Colormaps are now auto-discovered from `src/colormaps/*.csv` at build/dev time and listed automatically in the Velocity selector.
  - Fixed max control now supports 0..350 km/h and uses synchronized number + range slider inputs.
- Sidebar editing UX:
  - Edit modes are compact single-row pills (`Move`, `Marquee`, `Lasso`, `Info`) with descriptions moved into hover tooltips.
- Import UX:
  - Dedicated drop box removed; users can now drag and drop files anywhere on the page.
  - Import section uses a compact hint line instead of a large drop target block.
  - Full-page drag-over overlay now appears while file payload is dragged over the app.
- Cursor behavior:
  - Native map cursor is hidden while inside the map; proxy cursor is used for consistency.
  - Pan proxy (circular) in normal mode and editing `move` mode.
  - Crosshair proxy in editing `marquee`/`lasso` modes.
  - In editing `move` mode, hovering editable track points switches proxy to crosshair.
  - Space pressed always forces pan proxy.
  - Cursor classes are reapplied after drag/marquee/lasso start/end and after full render cycles.
  - Space key handlers consume repeat keydown/keyup events (except when typing into form controls).
- Track list control UX:
  - Replaced checkbox toggles with pill-style buttons for `Visible`, `Lines`, `Points`, and `Edit`.
  - Removed `Start Edit`/`Stop Edit` action button in favor of a persistent edit-state toggle.
  - Visibility toggling no longer triggers map auto-fit/movement.
  - Track visualization rules enforce at least one of `Points` or `Segments` active.
- Track ordering:
  - Sidebar ordering now controls map overlap order.
  - Per-track header controls include move up/down actions plus collapse toggle.
  - Reorder glyphs now use borderless typographic symbols (`▲/△`, `▼/▽`) with tighter alignment.
  - Rendering is bottom-to-top so tracks near the top of the list draw on top.
- Sidebar layout:
  - Main sections (`Import`, `Edit`, `Velocity`, `Tracks`) support collapse and up/down reorder controls.
  - Section ordering and collapsed state are stored in `localStorage` (`path-segments-sidebar-layout-v1`) and restored on reload.
- Import/status:
  - Former standalone `Status` section merged into `Import`.
  - Import status is now one compact line: loaded total + last import result (errors still highlighted).
- Velocity auto scale:
  - Auto mode now computes max speed from currently visible tracks only (map coloring + sidebar status text).

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
