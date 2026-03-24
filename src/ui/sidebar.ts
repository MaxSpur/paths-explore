import type {
  AnalysisMode,
  AnalysisSettings,
  AppState,
  EditInteractionMode,
  ImportSummary,
  MapBaseStyle,
  MapViewSettings,
  VelocityScaleMode,
} from "../model/types";
import {
  getAvailableOdMetricCatalog,
  isOdEdgeBundle,
  type BundleOdMetricDefinition,
  type BundleOdMetricFamily,
  type BundleOdMetricVariant,
  type BundleState
} from "../model/bundles";
import { COLORMAPS, DEFAULT_COLORMAP_ID } from "../colormaps";

const SIDEBAR_SECTION_IDS = ["import", "bundles", "edit", "map", "velocity", "tracks"] as const;
type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number];
const SIDEBAR_LAYOUT_STORAGE_KEY = "path-segments-sidebar-layout-v1";
const TRACK_COLLAPSE_STORAGE_KEY = "path-segments-collapsed-tracks-v1";
type AnalysisHeaderMode = AnalysisMode;
const MAP_STYLE_OPTIONS: Array<{ id: MapBaseStyle; label: string }> = [
  { id: "osm-standard", label: "OSM Standard" },
  { id: "carto-light", label: "CARTO Light" },
  { id: "carto-positron", label: "CARTO Positron" },
  { id: "carto-positron-nolabels", label: "CARTO Positron (No Labels)" },
  { id: "carto-dark", label: "CARTO Dark" },
  { id: "carto-voyager", label: "CARTO Voyager" }
];

interface SidebarLayoutPrefs {
  order: SidebarSectionId[];
  collapsed: SidebarSectionId[];
}

function isSidebarSectionId(value: string): value is SidebarSectionId {
  return (SIDEBAR_SECTION_IDS as readonly string[]).includes(value);
}

function getAnalysisHeaderMode(settings: AnalysisSettings): AnalysisHeaderMode {
  return settings.mode;
}

function getAnalysisHeaderGlyph(mode: AnalysisHeaderMode): string {
  if (mode === "velocity") {
    return "🅥";
  }

  if (mode === "acceleration") {
    return "🅐";
  }

  if (mode === "od") {
    return "OD";
  }

  return "Ⓞ";
}

function getAnalysisHeaderLabel(mode: AnalysisHeaderMode): string {
  if (mode === "velocity") {
    return "Velocity";
  }

  if (mode === "acceleration") {
    return "Acceleration";
  }

  if (mode === "od") {
    return "OD";
  }

  return "Off";
}

interface SidebarCallbacks {
  onImportFiles: (files: File[] | FileList) => Promise<void>;
  onToggleVisibility: (trackId: string, visible: boolean) => void;
  onToggleBundleVisibility: (bundleId: string, visible: boolean) => void;
  onToggleBundleOverlays: (bundleId: string, overlaysVisible: boolean) => void;
  onToggleBundleExtraction: (bundleId: string, extractionEnabled: boolean) => void;
  onTogglePoints: (trackId: string, show: boolean) => void;
  onToggleSegments: (trackId: string, show: boolean) => void;
  onMoveTrackUp: (trackId: string) => void;
  onMoveTrackDown: (trackId: string) => void;
  onFocusTrack: (trackId: string) => void;
  onFocusBundle: (bundleId: string) => void;
  onExportTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onDeleteBundle: (bundleId: string) => void;
  onToggleEdit: (trackId: string) => void;
  onEditModeChange: (mode: EditInteractionMode) => void;
  onAnalysisModeChange: (mode: AnalysisMode) => void;
  onAnalysisVelocityScaleModeChange: (mode: VelocityScaleMode) => void;
  onAnalysisVelocityFixedMaxChange: (maxValue: number) => void;
  onAnalysisColormapChange: (colormapId: string) => void;
  onAnalysisOdColorMetricKeyChange: (metricKey: string) => void;
  onAnalysisOdDrawOrderMetricKeyChange: (metricKey: string) => void;
  onAnalysisOdLinkMetricSelectionsChange: (linked: boolean) => void;
  onAnalysisOdLinkVariantValueSelectionsChange: (linked: boolean) => void;
  onMapBaseStyleChange: (baseStyle: MapBaseStyle) => void;
  onMapDarkenChange: (darkenPercent: number) => void;
  onMapDesaturateChange: (desaturatePercent: number) => void;
}

type OdMetricSelectorRole = "color" | "draw-order";

interface OdMetricSourceOption {
  sourceKey: string;
  family: BundleOdMetricFamily;
  sourceLabel: string;
  definitions: BundleOdMetricDefinition[];
}

export class SidebarView {
  private root: HTMLElement;
  private callbacks: SidebarCallbacks;
  private fileInput: HTMLInputElement;
  private bundleList: HTMLElement;
  private trackList: HTMLElement;
  private summaryStatus: HTMLElement;
  private collapsedTrackIds = new Set<string>();
  private sectionOrder: SidebarSectionId[] = [...SIDEBAR_SECTION_IDS];
  private collapsedSectionIds = new Set<SidebarSectionId>();
  private lastBundleState: BundleState = { bundles: [] };
  private lastState: AppState = { tracks: [], selectedPointIds: [] };
  private lastSummary?: ImportSummary;
  private lastEditMode: EditInteractionMode = "move";
  private lastAnalysisSettings: AnalysisSettings = {
    mode: "off",
    colormapId: DEFAULT_COLORMAP_ID,
    velocityScaleMode: "auto",
    velocityFixedMax: 60,
    odColorMetricKey: "weight",
    odDrawOrderMetricKey: "weight",
    odLinkMetricSelections: false,
    odLinkVariantValueSelections: false
  };
  private lastVelocityMaxDisplayValue = 0;
  private lastMapViewSettings: MapViewSettings = {
    baseStyle: "osm-standard",
    darkenPercent: 0,
    desaturatePercent: 0
  };

  constructor(root: HTMLElement, callbacks: SidebarCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    const colormapOptions = COLORMAPS.map(
      (colormap) => `<option value="${colormap.id}">${this.escapeHtml(colormap.name)}</option>`
    ).join("");
    const mapStyleOptions = MAP_STYLE_OPTIONS.map(
      (option) => `<option value="${option.id}">${this.escapeHtml(option.label)}</option>`
    ).join("");

    this.root.innerHTML = `
      <header class="panel-header">
        <h1>Path Segments</h1>
        <p>Load GPX/KML/GeoJSON/CSV paths or generated parquet bundles.<br/>Drag here to import.</p>
      </header>

      <section class="panel-section sidebar-section" data-section-id="import">
        <div class="panel-section-header">
          <h2>Import</h2>
          ${this.buildSectionControls("import")}
        </div>
        <div class="panel-section-content">
          <label class="import-label" for="track-file-input">Import files</label>
          <input id="track-file-input" class="file-input" type="file" multiple accept=".gpx,.kml,.geojson,.json,.csv,.zip,.psbundle.zip" />
          <p class="import-hint">Tip: drag and drop files anywhere on the page.</p>
          <p id="summary-status" class="status-text">Loaded 0 tracks and 0 bundles. No imports yet.</p>
        </div>
      </section>

      <section class="panel-section panel-bundles sidebar-section" data-section-id="bundles">
        <div class="panel-section-header">
          <h2>Bundles</h2>
          ${this.buildSectionControls("bundles")}
        </div>
        <div class="panel-section-content">
          <div id="bundle-list" class="track-list"></div>
        </div>
      </section>

      <section class="panel-section panel-edit sidebar-section" data-section-id="edit">
        <div class="panel-section-header">
          <h2>Edit</h2>
          ${this.buildSectionControls("edit")}
        </div>
        <div class="panel-section-content">
          <div class="edit-mode-list">
            <label
              class="edit-mode-card"
              title="Move mode: drag selected points to reposition them."
              aria-label="Move mode: drag selected points to reposition them."
            >
              <input data-action="edit-mode" type="radio" name="edit-mode" value="move" checked />
              <span class="edit-mode-title">Move</span>
            </label>
            <label
              class="edit-mode-card"
              title="Marquee mode: drag a rectangle to select points."
              aria-label="Marquee mode: drag a rectangle to select points."
            >
              <input data-action="edit-mode" type="radio" name="edit-mode" value="marquee" />
              <span class="edit-mode-title">Marquee</span>
            </label>
            <label
              class="edit-mode-card"
              title="Lasso mode: freehand draw a shape to select points."
              aria-label="Lasso mode: freehand draw a shape to select points."
            >
              <input data-action="edit-mode" type="radio" name="edit-mode" value="lasso" />
              <span class="edit-mode-title">Lasso</span>
            </label>
            <label
              class="edit-mode-card"
              title="Info mode: click segments to inspect metric values and point details."
              aria-label="Info mode: click segments to inspect metric values and point details."
            >
              <input data-action="edit-mode" type="radio" name="edit-mode" value="info" />
              <span class="edit-mode-title">Info</span>
            </label>
          </div>
          <p class="edit-hint">
            Hold Shift to add to selection in edit modes.<br/>Hold Space to drag the map while editing.
          </p>
        </div>
      </section>

      <section class="panel-section panel-map sidebar-section" data-section-id="map">
        <div class="panel-section-header">
          <h2>Map</h2>
          ${this.buildSectionControls("map")}
        </div>
        <div class="panel-section-content">
          <label class="map-field">
            <span>Style</span>
            <select data-action="map-style">
              ${mapStyleOptions}
            </select>
          </label>
          <label class="map-field">
            <span>Darken</span>
            <div class="map-filter-row">
              <input data-action="map-darken" type="range" min="0" max="100" step="1" value="0" />
              <span class="map-filter-value" id="map-darken-value">0%</span>
            </div>
          </label>
          <label class="map-field">
            <span>Desaturate</span>
            <div class="map-filter-row">
              <input data-action="map-desaturate" type="range" min="0" max="100" step="1" value="0" />
              <span class="map-filter-value" id="map-desaturate-value">0%</span>
            </div>
          </label>
        </div>
      </section>

      <section class="panel-section panel-velocity sidebar-section" data-section-id="velocity">
        <div class="panel-section-header">
          <h2>Analysis</h2>
          ${this.buildSectionControls("velocity")}
        </div>
        <div class="panel-section-content">
          <div class="velocity-mode-row segmented-control" role="group" aria-label="Analysis mode">
            <button data-action="analysis-mode" data-mode="off" type="button" class="segmented-btn velocity-mode-btn">Off</button>
            <button data-action="analysis-mode" data-mode="velocity" type="button" class="segmented-btn velocity-mode-btn">Velocity</button>
            <button data-action="analysis-mode" data-mode="acceleration" type="button" class="segmented-btn velocity-mode-btn">Acceleration</button>
            <button data-action="analysis-mode" data-mode="od" type="button" class="segmented-btn velocity-mode-btn">OD</button>
          </div>
          <div class="velocity-controls">
            <label class="velocity-field" id="analysis-velocity-scale-field">
              <span>Scale</span>
              <div class="segmented-control velocity-scale-row" role="group" aria-label="Velocity scale mode">
                <button data-action="analysis-velocity-scale" data-scale="auto" type="button" class="segmented-btn velocity-scale-btn">
                  Auto
                </button>
                <button data-action="analysis-velocity-scale" data-scale="fixed" type="button" class="segmented-btn velocity-scale-btn">
                  Fixed
                </button>
              </div>
            </label>
            <label class="velocity-field" id="analysis-velocity-max-field">
              <span id="analysis-velocity-max-label">Max (km/h)</span>
              <div class="velocity-max-row">
                <input
                  class="velocity-max-input"
                  data-action="analysis-velocity-max"
                  type="number"
                  min="0"
                  max="350"
                  step="1"
                  value="60"
                />
                <input
                  class="velocity-max-slider"
                  data-action="analysis-velocity-max-slider"
                  type="range"
                  min="0"
                  max="350"
                  step="1"
                  value="60"
                />
              </div>
            </label>
            <label class="velocity-field">
              <span>Colormap</span>
              <select data-action="analysis-colormap">
                ${colormapOptions}
              </select>
            </label>
            <label class="velocity-field" id="analysis-od-color-source-field" hidden>
              <span>Color / Rank by</span>
              <select data-action="analysis-od-color-source"></select>
            </label>
            <label class="velocity-field" id="analysis-od-color-variant-field" hidden>
              <span>Variant</span>
              <select data-action="analysis-od-color-variant"></select>
            </label>
            <label class="velocity-field" id="analysis-od-color-value-field" hidden>
              <span>Value</span>
              <select data-action="analysis-od-color-value"></select>
            </label>
            <label class="velocity-field" id="analysis-od-draw-source-field" hidden>
              <span>Draw on top by</span>
              <select data-action="analysis-od-draw-source"></select>
            </label>
            <label class="velocity-field" id="analysis-od-draw-variant-field" hidden>
              <span>Variant</span>
              <select data-action="analysis-od-draw-variant"></select>
            </label>
            <label class="velocity-field" id="analysis-od-draw-value-field" hidden>
              <span>Value</span>
              <select data-action="analysis-od-draw-value"></select>
            </label>
            <label class="velocity-field" id="analysis-od-link-field" hidden>
              <span>Link Controls</span>
              <div class="segmented-control velocity-scale-row" role="group" aria-label="OD selector linking">
                <button
                  data-action="analysis-od-toggle-link-metrics"
                  type="button"
                  class="segmented-btn velocity-scale-btn"
                >
                  Link Metrics
                </button>
                <button
                  data-action="analysis-od-toggle-link-details"
                  type="button"
                  class="segmented-btn velocity-scale-btn"
                >
                  Link Variant/Value
                </button>
              </div>
            </label>
          </div>
          <p class="velocity-meta" id="analysis-meta">Analysis is off.</p>
        </div>
      </section>

      <section class="panel-section panel-tracks sidebar-section" data-section-id="tracks">
        <div class="panel-section-header">
          <h2>Tracks</h2>
          ${this.buildSectionControls("tracks")}
        </div>
        <div class="panel-section-content">
          <div class="tracks-header-row">
            <div class="tracks-header-actions">
              <button data-action="collapse-all" type="button">Collapse</button>
              <button data-action="expand-all" type="button">Expand</button>
            </div>
          </div>
          <div id="track-list" class="track-list"></div>
        </div>
      </section>
    `;

    this.fileInput = this.root.querySelector("#track-file-input") as HTMLInputElement;
    this.bundleList = this.root.querySelector("#bundle-list") as HTMLElement;
    this.trackList = this.root.querySelector("#track-list") as HTMLElement;
    this.summaryStatus = this.root.querySelector("#summary-status") as HTMLElement;

    this.loadSectionLayout();
    this.loadCollapsedTracks();
    this.applySectionLayout();
    this.bindImportControls();
    this.bindPanelActions();
  }

  getFileInputElement(): HTMLInputElement {
    return this.fileInput;
  }

  render(
    state: AppState,
    bundleState: BundleState,
    summary: ImportSummary | undefined,
    importStatusMessage: string | undefined,
    editMode: EditInteractionMode,
    analysisSettings: AnalysisSettings,
    velocityMaxDisplayValue: number,
    mapViewSettings: MapViewSettings
  ): void {
    this.lastState = state;
    this.lastBundleState = bundleState;
    this.lastSummary = summary;
    this.lastEditMode = editMode;
    this.lastAnalysisSettings = analysisSettings;
    this.lastVelocityMaxDisplayValue = velocityMaxDisplayValue;
    this.lastMapViewSettings = mapViewSettings;

    this.pruneCollapsedTrackIds(state);
    this.syncEditModeControls(editMode);
    this.syncMapControls(mapViewSettings);
    this.syncAnalysisControls(analysisSettings, velocityMaxDisplayValue);
    this.applySectionLayout();

    const importMessage = importStatusMessage ?? (summary ? this.buildSummaryMessage(summary) : "No imports yet.");
    this.summaryStatus.textContent = `Loaded ${state.tracks.length} track${state.tracks.length === 1 ? "" : "s"
      } and ${bundleState.bundles.length} bundle${bundleState.bundles.length === 1 ? "" : "s"}. ${importMessage}`;
    this.summaryStatus.classList.toggle(
      "has-error",
      !importStatusMessage && (summary ? summary.issues.length > 0 : false)
    );

    if (bundleState.bundles.length === 0) {
      this.bundleList.innerHTML = '<p class="empty-message">No bundles loaded.</p>';
    } else {
      this.bundleList.innerHTML = bundleState.bundles
        .map((bundle) => {
          const isOdBundle = isOdEdgeBundle(bundle.bundle);
          const visualState: "hidden" | "visible" = bundle.visible ? "visible" : "hidden";
          const stateLabel = bundle.visible ? "Visible" : "Hidden";
          const stateGlyph = bundle.visible ? "Ⓥ" : "Ⓗ";
          const safeBundleName = this.escapeHtml(bundle.name);
          const overlayCount = bundle.bundle.overlays.length;
          const trajectoryCount = bundle.bundle.manifest.counts.trajectoryCount;
          const trajectoryLabel = isOdBundle ? "flow" : "trajectory";

          return `
            <article class="track-item is-${visualState}" data-bundle-id="${bundle.id}">
              <div class="track-item-header">
                <div class="track-item-header-main">
                  <span class="track-color" style="background:${bundle.color}"></span>
                  <span class="track-title" title="${safeBundleName}">${safeBundleName}</span>
                </div>
                <div class="track-item-header-controls">
                  <button
                    class="track-state-btn track-state-${visualState}"
                    data-action="bundle-toggle-visible-mini"
                    data-bundle-id="${bundle.id}"
                    data-next-visible="${bundle.visible ? "false" : "true"}"
                    type="button"
                    title="${bundle.visible ? "Hide bundle" : "Show bundle"}"
                    aria-label="Bundle state: ${stateLabel}. Click to ${bundle.visible ? "hide" : "show"} bundle."
                    aria-pressed="${bundle.visible ? "true" : "false"}"
                  >
                    ${stateGlyph}
                  </button>
                </div>
              </div>
              <p class="bundle-meta">${trajectoryCount} ${trajectoryLabel}${trajectoryCount === 1 ? "" : "s"} · ${overlayCount} overlay${overlayCount === 1 ? "" : "s"}</p>
              <div class="track-toggle-row bundle-toggle-row">
                <button
                  class="track-toggle-btn track-visibility-toggle ${bundle.visible ? "is-on" : "is-off"}"
                  data-action="bundle-toggle-visible"
                  data-bundle-id="${bundle.id}"
                  data-next-visible="${bundle.visible ? "false" : "true"}"
                  type="button"
                  aria-pressed="${bundle.visible ? "true" : "false"}"
                >
                  ${bundle.visible ? "Visible" : "Hidden"}
                </button>
                <button
                  class="track-toggle-btn ${bundle.overlaysVisible ? "is-active" : "is-inactive"}${bundle.visible ? "" : " is-muted"}"
                  data-action="bundle-toggle-overlays"
                  data-bundle-id="${bundle.id}"
                  data-next-overlays="${bundle.overlaysVisible ? "false" : "true"}"
                  type="button"
                  aria-pressed="${bundle.overlaysVisible ? "true" : "false"}"
                  ${overlayCount > 0 ? "" : "disabled"}
                >
                  Overlays
                </button>
                ${isOdBundle
                  ? ""
                  : `
                <button
                  class="track-toggle-btn ${bundle.extractionEnabled ? "is-active" : "is-inactive"}${bundle.visible ? "" : " is-muted"}"
                  data-action="bundle-toggle-extraction"
                  data-bundle-id="${bundle.id}"
                  data-next-extraction="${bundle.extractionEnabled ? "false" : "true"}"
                  type="button"
                  aria-pressed="${bundle.extractionEnabled ? "true" : "false"}"
                >
                  Extract
                </button>
                `}
              </div>
              <div class="track-actions">
                <button data-action="bundle-focus" data-bundle-id="${bundle.id}" type="button">Focus</button>
                <button data-action="bundle-delete" data-bundle-id="${bundle.id}" type="button">Remove</button>
              </div>
            </article>
          `;
        })
        .join("");
    }

    if (state.tracks.length === 0) {
      this.trackList.innerHTML = '<p class="empty-message">No tracks loaded.</p>';
      return;
    }

    this.trackList.innerHTML = state.tracks
      .map((track, index) => {
        const isEditing = state.editingTrackId === track.id;
        const visualState: "hidden" | "visible" | "editing" = isEditing
          ? "editing"
          : track.visible
            ? "visible"
            : "hidden";
        const stateLabel = visualState === "editing" ? "Editing" : visualState === "visible" ? "Visible" : "Hidden";
        const stateGlyph = visualState === "editing" ? "🅔" : visualState === "visible" ? "Ⓥ" : "Ⓗ";
        const isCollapsed = this.collapsedTrackIds.has(track.id);
        const safeTrackName = this.escapeHtml(track.name);
        const canMoveUp = index > 0;
        const canMoveDown = index < state.tracks.length - 1;

        return `
          <article class="track-item is-${visualState}${isCollapsed ? " is-collapsed" : ""
          }" data-track-id="${track.id}">
            <div class="track-item-header">
              <button
                class="track-item-header-button"
                data-action="toggle-collapse"
                data-track-id="${track.id}"
                type="button"
                aria-expanded="${isCollapsed ? "false" : "true"}"
              >
                <span class="track-item-header-main">
                  <span class="track-color" style="background:${track.color}"></span>
                  <span class="track-title" title="${safeTrackName}">${safeTrackName}</span>
                </span>
              </button>
              <div class="track-item-header-controls">
                <button
                  class="track-state-btn track-state-${visualState}"
                  data-action="toggle-visible-mini"
                  data-track-id="${track.id}"
                  data-next-visible="${track.visible ? "false" : "true"}"
                  type="button"
                  title="${track.visible ? "Hide track" : "Show track"}"
                  aria-label="Track state: ${stateLabel}. Click to ${track.visible ? "hide" : "show"} track."
                  aria-pressed="${track.visible ? "true" : "false"}"
                >
                  ${stateGlyph}
                </button>
                <button
                  class="track-header-icon-btn"
                  data-action="move-up"
                  data-track-id="${track.id}"
                  type="button"
                  title="Move track up"
                  aria-label="Move track up"
                  ${canMoveUp ? "" : "disabled"}
                >
                  ${canMoveUp ? "▲" : "△"}
                </button>
                <button
                  class="track-header-icon-btn"
                  data-action="move-down"
                  data-track-id="${track.id}"
                  type="button"
                  title="Move track down"
                  aria-label="Move track down"
                  ${canMoveDown ? "" : "disabled"}
                >
                  ${canMoveDown ? "▼" : "▽"}
                </button>
                <button
                  class="track-header-icon-btn"
                  data-action="toggle-collapse"
                  data-track-id="${track.id}"
                  type="button"
                  title="${isCollapsed ? "Expand track" : "Collapse track"}"
                  aria-label="${isCollapsed ? "Expand track" : "Collapse track"}"
                  aria-expanded="${isCollapsed ? "false" : "true"}"
                >
                  <span class="track-collapse-indicator">${isCollapsed ? "＋" : "－"}</span>
                </button>
              </div>
            </div>
            ${isCollapsed
            ? ""
            : `
              <div class="track-toggle-row">
                <button
                  class="track-toggle-btn track-visibility-toggle ${track.visible ? "is-on" : "is-off"}${isEditing ? " is-editing-track" : ""
            }"
                  data-action="toggle-visible"
                  data-track-id="${track.id}"
                  data-next-visible="${track.visible ? "false" : "true"}"
                  type="button"
                  aria-pressed="${track.visible ? "true" : "false"}"
                  title="${track.visible ? "Hide track" : "Show track"}"
                >
                  ${track.visible ? "Visible" : "Hidden"}
                </button>
                <button
                  class="track-toggle-btn ${track.showSegments ? "is-active" : "is-inactive"}${track.visible ? "" : " is-muted"}"
                  data-action="toggle-segments"
                  data-track-id="${track.id}"
                  data-next-segments="${track.showSegments ? "false" : "true"}"
                  type="button"
                  aria-pressed="${track.showSegments ? "true" : "false"}"
                >
                  Lines
                </button>
                <button
                  class="track-toggle-btn ${track.showPoints || isEditing ? "is-active" : "is-inactive"}${track.visible ? "" : " is-muted"}"
                  data-action="toggle-points"
                  data-track-id="${track.id}"
                  data-next-points="${track.showPoints || isEditing ? "false" : "true"}"
                  type="button"
                  aria-pressed="${track.showPoints || isEditing ? "true" : "false"}"
                  ${isEditing ? 'disabled title="Points are enabled while this track is being edited."' : ""}
                >
                  Points
                </button>
                <button
                  class="track-toggle-btn track-edit-toggle ${isEditing ? "is-active" : "is-inactive"}${track.visible ? "" : " is-track-hidden"}"
                  data-action="toggle-edit"
                  data-track-id="${track.id}"
                  type="button"
                  aria-pressed="${isEditing ? "true" : "false"}"
                  title="${track.visible ? "Toggle edit mode" : "Start editing and show this track"}"
                >
                  ${isEditing ? "Editing" : "Edit"}
                </button>
              </div>
              <div class="track-actions">
                <button data-action="focus" data-track-id="${track.id}" type="button">Focus</button>
                <button data-action="export" data-track-id="${track.id}" type="button">Export</button>
                <button data-action="delete" data-track-id="${track.id}" type="button">Delete</button>
              </div>
            `
          }
          </article>
        `;
      })
      .join("");
  }

  private bindImportControls(): void {
    this.fileInput.addEventListener("change", async () => {
      if (!this.fileInput.files) {
        return;
      }

      await this.callbacks.onImportFiles(this.fileInput.files);
      this.fileInput.value = "";
    });
  }

  private bindPanelActions(): void {
    this.root.addEventListener("change", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
        return;
      }

      const action = target.dataset.action;

      if (target instanceof HTMLSelectElement) {
        if (action === "analysis-colormap") {
          this.callbacks.onAnalysisColormapChange(target.value);
        } else if (action === "map-style") {
          const style = target.value;
          if (MAP_STYLE_OPTIONS.some((option) => option.id === style)) {
            this.callbacks.onMapBaseStyleChange(style as MapBaseStyle);
          }
        } else if (
          action === "analysis-od-color-source" ||
          action === "analysis-od-color-variant" ||
          action === "analysis-od-color-value"
        ) {
          this.applyOdMetricSelection("color");
        } else if (
          action === "analysis-od-draw-source" ||
          action === "analysis-od-draw-variant" ||
          action === "analysis-od-draw-value"
        ) {
          this.applyOdMetricSelection("draw-order");
        }

        return;
      }

      if (action === "edit-mode") {
        this.callbacks.onEditModeChange(target.value as EditInteractionMode);
        return;
      }

      if (action === "analysis-velocity-max") {
        const nextMax = Number.parseFloat(target.value);
        if (Number.isFinite(nextMax)) {
          this.callbacks.onAnalysisVelocityFixedMaxChange(nextMax);
        }
        return;
      }

      if (action === "analysis-velocity-max-slider") {
        const nextMax = Number.parseFloat(target.value);
        if (Number.isFinite(nextMax)) {
          this.callbacks.onAnalysisVelocityFixedMaxChange(nextMax);
        }
        return;
      }

      if (action === "map-darken") {
        const nextValue = Number.parseFloat(target.value);
        if (Number.isFinite(nextValue)) {
          this.callbacks.onMapDarkenChange(nextValue);
        }
        return;
      }

      if (action === "map-desaturate") {
        const nextValue = Number.parseFloat(target.value);
        if (Number.isFinite(nextValue)) {
          this.callbacks.onMapDesaturateChange(nextValue);
        }
      }
    });

    this.root.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest("button[data-action]") as HTMLButtonElement | null;
      if (!button) {
        return;
      }

      const action = button.dataset.action;
      const sectionId = button.dataset.sectionId;
      const trackId = button.dataset.trackId;

      if (sectionId && isSidebarSectionId(sectionId)) {
        if (action === "section-toggle-collapse") {
          this.toggleSectionCollapse(sectionId);
          return;
        }

        if (action === "section-move-up") {
          this.moveSection(sectionId, "up");
          return;
        }

        if (action === "section-move-down") {
          this.moveSection(sectionId, "down");
          return;
        }
      }

      if (action === "collapse-all") {
        this.collapseAll();
        return;
      }

      if (action === "expand-all") {
        this.expandAll();
        return;
      }

      if (action === "analysis-mode") {
        const mode = button.dataset.mode;
        if (mode === "off" || mode === "velocity" || mode === "acceleration" || mode === "od") {
          this.callbacks.onAnalysisModeChange(mode);
        }
        return;
      }

      if (action === "analysis-mode-cycle") {
        const currentMode = getAnalysisHeaderMode(this.lastAnalysisSettings);
        const nextMode: AnalysisHeaderMode =
          currentMode === "off"
            ? "velocity"
            : currentMode === "velocity"
              ? "acceleration"
              : currentMode === "acceleration"
                ? "od"
                : "off";
        this.callbacks.onAnalysisModeChange(nextMode);
        return;
      }

      if (action === "analysis-velocity-scale") {
        const mode = button.dataset.scale;
        if (mode === "auto" || mode === "fixed") {
          this.callbacks.onAnalysisVelocityScaleModeChange(mode);
        }
        return;
      }

      if (action === "analysis-od-toggle-link-metrics") {
        const nextLinked = !this.lastAnalysisSettings.odLinkMetricSelections;
        this.callbacks.onAnalysisOdLinkMetricSelectionsChange(nextLinked);
        if (nextLinked) {
          this.emitOdMetricKeyChange("draw-order", this.lastAnalysisSettings.odColorMetricKey);
        }
        return;
      }

      if (action === "analysis-od-toggle-link-details") {
        const nextLinked = !this.lastAnalysisSettings.odLinkVariantValueSelections;
        this.callbacks.onAnalysisOdLinkVariantValueSelectionsChange(nextLinked);
        if (nextLinked && !this.lastAnalysisSettings.odLinkMetricSelections) {
          const colorDefinition = this.getOdMetricDefinition(this.lastAnalysisSettings.odColorMetricKey);
          if (colorDefinition) {
            const linkedMetricKey = this.findLinkedVariantValueMetricKey("draw-order", colorDefinition);
            if (linkedMetricKey) {
              this.emitOdMetricKeyChange("draw-order", linkedMetricKey);
            }
          }
        }
        return;
      }

      const bundleId = button.dataset.bundleId;
      if (bundleId) {
        if (action === "bundle-toggle-visible" || action === "bundle-toggle-visible-mini") {
          this.callbacks.onToggleBundleVisibility(bundleId, button.dataset.nextVisible === "true");
          return;
        }

        if (action === "bundle-toggle-overlays") {
          this.callbacks.onToggleBundleOverlays(bundleId, button.dataset.nextOverlays === "true");
          return;
        }

        if (action === "bundle-toggle-extraction") {
          this.callbacks.onToggleBundleExtraction(bundleId, button.dataset.nextExtraction === "true");
          return;
        }

        if (action === "bundle-focus") {
          this.callbacks.onFocusBundle(bundleId);
          return;
        }

        if (action === "bundle-delete") {
          this.callbacks.onDeleteBundle(bundleId);
          return;
        }
      }

      if (!trackId) {
        return;
      }

      if (action === "toggle-visible") {
        this.callbacks.onToggleVisibility(trackId, button.dataset.nextVisible === "true");
        return;
      }

      if (action === "toggle-visible-mini") {
        this.callbacks.onToggleVisibility(trackId, button.dataset.nextVisible === "true");
        return;
      }

      if (action === "move-up") {
        this.callbacks.onMoveTrackUp(trackId);
        return;
      }

      if (action === "move-down") {
        this.callbacks.onMoveTrackDown(trackId);
        return;
      }

      if (action === "toggle-points") {
        this.callbacks.onTogglePoints(trackId, button.dataset.nextPoints === "true");
        return;
      }

      if (action === "toggle-segments") {
        this.callbacks.onToggleSegments(trackId, button.dataset.nextSegments === "true");
        return;
      }

      if (action === "toggle-edit") {
        this.callbacks.onToggleEdit(trackId);
        return;
      }

      if (action === "toggle-collapse") {
        this.toggleTrackCollapse(trackId);
        return;
      }

      if (action === "focus") {
        this.callbacks.onFocusTrack(trackId);
        return;
      }

      if (action === "export") {
        this.callbacks.onExportTrack(trackId);
        return;
      }

      if (action === "delete") {
        this.callbacks.onDeleteTrack(trackId);
        return;
      }

    });

    this.root.addEventListener("input", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      const action = target.dataset.action;
      if (
        action !== "analysis-velocity-max" &&
        action !== "analysis-velocity-max-slider" &&
        action !== "map-darken" &&
        action !== "map-desaturate"
      ) {
        return;
      }

      const nextValue = Number.parseFloat(target.value);
      if (!Number.isFinite(nextValue)) {
        return;
      }

      if (action === "map-darken") {
        this.callbacks.onMapDarkenChange(nextValue);
        return;
      }

      if (action === "map-desaturate") {
        this.callbacks.onMapDesaturateChange(nextValue);
        return;
      }

      this.callbacks.onAnalysisVelocityFixedMaxChange(nextValue);
    });
  }

  private getOdMetricCatalog(): BundleOdMetricDefinition[] {
    return getAvailableOdMetricCatalog(this.lastBundleState.bundles);
  }

  private getOdMetricSourceOptions(): OdMetricSourceOption[] {
    const optionsBySource = new Map<string, OdMetricSourceOption>();

    for (const definition of this.getOdMetricCatalog()) {
      const existing = optionsBySource.get(definition.sourceKey);
      if (existing) {
        existing.definitions.push(definition);
        continue;
      }

      optionsBySource.set(definition.sourceKey, {
        sourceKey: definition.sourceKey,
        family: definition.family,
        sourceLabel: definition.sourceLabel,
        definitions: [definition]
      });
    }

    return Array.from(optionsBySource.values());
  }

  private getOdMetricSourceOption(sourceKey: string): OdMetricSourceOption | undefined {
    return this.getOdMetricSourceOptions().find((option) => option.sourceKey === sourceKey);
  }

  private getOdMetricDefinition(metricKey: string): BundleOdMetricDefinition | undefined {
    return this.getOdMetricCatalog().find((definition) => definition.key === metricKey);
  }

  private getOdMetricKeyForRole(role: OdMetricSelectorRole): string {
    return role === "color"
      ? this.lastAnalysisSettings.odColorMetricKey
      : this.lastAnalysisSettings.odDrawOrderMetricKey;
  }

  private emitOdMetricKeyChange(role: OdMetricSelectorRole, metricKey: string): void {
    if (role === "color") {
      this.callbacks.onAnalysisOdColorMetricKeyChange(metricKey);
      return;
    }

    this.callbacks.onAnalysisOdDrawOrderMetricKeyChange(metricKey);
  }

  private findLinkedVariantValueMetricKey(
    targetRole: OdMetricSelectorRole,
    sourceDefinition: BundleOdMetricDefinition
  ): string | undefined {
    if (
      (sourceDefinition.family !== "category" && sourceDefinition.family !== "time") ||
      !sourceDefinition.variant ||
      !sourceDefinition.valueKey
    ) {
      return undefined;
    }

    const targetDefinition = this.getOdMetricDefinition(this.getOdMetricKeyForRole(targetRole));
    const targetSourceKey = targetDefinition?.sourceKey;
    if (!targetSourceKey) {
      return undefined;
    }

    return this.getOdMetricCatalog().find(
      (definition) =>
        definition.sourceKey === targetSourceKey &&
        definition.variant === sourceDefinition.variant &&
        definition.valueKey === sourceDefinition.valueKey
    )?.key;
  }

  private getOdMetricSelectors(role: OdMetricSelectorRole): {
    sourceSelect: HTMLSelectElement | null;
    variantSelect: HTMLSelectElement | null;
    valueSelect: HTMLSelectElement | null;
    sourceField: HTMLElement | null;
    variantField: HTMLElement | null;
    valueField: HTMLElement | null;
  } {
    const prefix = role === "color" ? "analysis-od-color" : "analysis-od-draw";
    return {
      sourceSelect: this.root.querySelector<HTMLSelectElement>(`select[data-action="${prefix}-source"]`),
      variantSelect: this.root.querySelector<HTMLSelectElement>(`select[data-action="${prefix}-variant"]`),
      valueSelect: this.root.querySelector<HTMLSelectElement>(`select[data-action="${prefix}-value"]`),
      sourceField: this.root.querySelector<HTMLElement>(`#${prefix}-source-field`),
      variantField: this.root.querySelector<HTMLElement>(`#${prefix}-variant-field`),
      valueField: this.root.querySelector<HTMLElement>(`#${prefix}-value-field`)
    };
  }

  private setSelectOptions(
    select: HTMLSelectElement | null,
    options: Array<{ value: string; label: string }>,
    nextValue: string,
    disabled: boolean
  ): void {
    if (!select) {
      return;
    }

    select.innerHTML = options
      .map((option) => `<option value="${this.escapeAttribute(option.value)}">${this.escapeHtml(option.label)}</option>`)
      .join("");
    const optionExists = options.some((option) => option.value === nextValue);
    select.value = optionExists ? nextValue : options[0]?.value ?? "";
    select.disabled = disabled || options.length <= 1;
  }

  private syncOdMetricSelectors(
    role: OdMetricSelectorRole,
    metricKey: string,
    enabled: boolean
  ): void {
    const selectors = this.getOdMetricSelectors(role);
    const sourceOptions = this.getOdMetricSourceOptions();
    const definition =
      this.getOdMetricDefinition(metricKey) ?? this.getOdMetricCatalog()[0];
    const resolvedSource =
      (definition && this.getOdMetricSourceOption(definition.sourceKey)) ?? sourceOptions[0];

    if (selectors.sourceField) {
      selectors.sourceField.hidden = !enabled;
    }

    this.setSelectOptions(
      selectors.sourceSelect,
      sourceOptions.map((option) => ({
        value: option.sourceKey,
        label: option.sourceLabel
      })),
      resolvedSource?.sourceKey ?? "",
      !enabled
    );

    const supportsVariantAndValue =
      enabled &&
      resolvedSource !== undefined &&
      (resolvedSource.family === "category" || resolvedSource.family === "time");

    if (selectors.variantField) {
      selectors.variantField.hidden = !supportsVariantAndValue;
    }
    if (selectors.valueField) {
      selectors.valueField.hidden = !supportsVariantAndValue;
    }

    if (!supportsVariantAndValue || !resolvedSource) {
      if (selectors.variantSelect) {
        selectors.variantSelect.innerHTML = "";
        selectors.variantSelect.disabled = true;
      }
      if (selectors.valueSelect) {
        selectors.valueSelect.innerHTML = "";
        selectors.valueSelect.disabled = true;
      }
      return;
    }

    const variants = Array.from(
      new Set(
        resolvedSource.definitions
          .map((candidate) => candidate.variant)
          .filter((candidate): candidate is BundleOdMetricVariant => candidate === "share" || candidate === "subtotal")
      )
    );
    const resolvedVariant =
      variants.includes(definition?.variant as BundleOdMetricVariant)
        ? (definition?.variant as BundleOdMetricVariant)
        : variants[0];
    const definitionsForVariant = resolvedSource.definitions.filter(
      (candidate) => candidate.variant === resolvedVariant
    );
    const valueOptions = definitionsForVariant.map((candidate) => ({
      value: candidate.valueKey ?? candidate.key,
      label: candidate.valueLabel ?? candidate.label
    }));
    const resolvedValue =
      definitionsForVariant.some((candidate) => candidate.valueKey === definition?.valueKey)
        ? (definition?.valueKey ?? definitionsForVariant[0]?.valueKey ?? "")
        : (definitionsForVariant[0]?.valueKey ?? "");

    this.setSelectOptions(
      selectors.variantSelect,
      variants.map((variant) => ({
        value: variant,
        label: variant === "share" ? "Share" : "Subtotal"
      })),
      resolvedVariant,
      !enabled
    );
    this.setSelectOptions(selectors.valueSelect, valueOptions, resolvedValue, !enabled);
  }

  private applyOdMetricSelection(role: OdMetricSelectorRole): void {
    const selectors = this.getOdMetricSelectors(role);
    const sourceKey = selectors.sourceSelect?.value;
    if (!sourceKey) {
      return;
    }

    const source = this.getOdMetricSourceOption(sourceKey);
    if (!source) {
      return;
    }

    let nextDefinition: BundleOdMetricDefinition | undefined;
    if (source.family === "numeric") {
      nextDefinition = source.definitions[0];
    } else {
      const variant = selectors.variantSelect?.value;
      const valueKey = selectors.valueSelect?.value;
      nextDefinition = source.definitions.find(
        (definition) => definition.variant === variant && definition.valueKey === valueKey
      );
      if (!nextDefinition) {
        nextDefinition = source.definitions[0];
      }
    }

    if (!nextDefinition) {
      return;
    }

    const otherRole: OdMetricSelectorRole = role === "color" ? "draw-order" : "color";
    this.emitOdMetricKeyChange(role, nextDefinition.key);

    if (this.lastAnalysisSettings.odLinkMetricSelections) {
      this.emitOdMetricKeyChange(otherRole, nextDefinition.key);
      return;
    }

    if (this.lastAnalysisSettings.odLinkVariantValueSelections) {
      const linkedMetricKey = this.findLinkedVariantValueMetricKey(otherRole, nextDefinition);
      if (linkedMetricKey) {
        this.emitOdMetricKeyChange(otherRole, linkedMetricKey);
      }
    }
  }

  private collapseAll(): void {
    this.collapsedTrackIds = new Set(this.lastState.tracks.map((track) => track.id));
    this.saveCollapsedTracks();
    this.rerenderFromCache();
  }

  private expandAll(): void {
    this.collapsedTrackIds.clear();
    this.saveCollapsedTracks();
    this.rerenderFromCache();
  }

  private toggleTrackCollapse(trackId: string): void {
    if (this.collapsedTrackIds.has(trackId)) {
      this.collapsedTrackIds.delete(trackId);
    } else {
      this.collapsedTrackIds.add(trackId);
    }

    this.saveCollapsedTracks();
    this.rerenderFromCache();
  }

  private rerenderFromCache(): void {
      this.render(
        this.lastState,
        this.lastBundleState,
        this.lastSummary,
        undefined,
        this.lastEditMode,
        this.lastAnalysisSettings,
        this.lastVelocityMaxDisplayValue,
        this.lastMapViewSettings
      );
  }

  private buildSectionControls(sectionId: SidebarSectionId): string {
    const velocityModeControl =
      sectionId === "velocity"
        ? `
        <button
          class="section-header-icon-btn section-velocity-mode-btn"
          data-action="analysis-mode-cycle"
          data-mode="off"
          type="button"
          title="Toggle analysis mode"
          aria-label="Analysis mode: Off. Click to cycle between Off, Velocity, Acceleration, and OD."
          aria-pressed="false"
        >
          ${getAnalysisHeaderGlyph("off")}
        </button>
      `
        : "";

    return `
      <div class="panel-section-controls">
        ${velocityModeControl}
        <button
          class="section-header-icon-btn"
          data-action="section-move-up"
          data-section-id="${sectionId}"
          type="button"
          title="Move section up"
          aria-label="Move section up"
        >
          ▲
        </button>
        <button
          class="section-header-icon-btn"
          data-action="section-move-down"
          data-section-id="${sectionId}"
          type="button"
          title="Move section down"
          aria-label="Move section down"
        >
          ▼
        </button>
        <button
          class="section-header-icon-btn"
          data-action="section-toggle-collapse"
          data-section-id="${sectionId}"
          type="button"
          title="Collapse section"
          aria-label="Collapse section"
          aria-expanded="true"
        >
          <span class="section-collapse-indicator">－</span>
        </button>
      </div>
    `;
  }

  private moveSection(sectionId: SidebarSectionId, direction: "up" | "down"): void {
    const currentIndex = this.sectionOrder.indexOf(sectionId);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= this.sectionOrder.length) {
      return;
    }

    const order = [...this.sectionOrder];
    const [movedSection] = order.splice(currentIndex, 1);
    order.splice(targetIndex, 0, movedSection);
    this.sectionOrder = order;

    this.applySectionLayout();
    this.saveSectionLayout();
  }

  private toggleSectionCollapse(sectionId: SidebarSectionId): void {
    if (this.collapsedSectionIds.has(sectionId)) {
      this.collapsedSectionIds.delete(sectionId);
    } else {
      this.collapsedSectionIds.add(sectionId);
    }

    this.applySectionLayout();
    this.saveSectionLayout();
  }

  private applySectionLayout(): void {
    const sections = this.root.querySelectorAll<HTMLElement>(".sidebar-section");

    sections.forEach((section) => {
      const sectionId = section.dataset.sectionId;
      if (!sectionId || !isSidebarSectionId(sectionId)) {
        return;
      }

      const orderIndex = this.sectionOrder.indexOf(sectionId);
      section.style.order = String(orderIndex < 0 ? 999 : orderIndex + 1);

      const isCollapsed = this.collapsedSectionIds.has(sectionId);
      section.classList.toggle("is-collapsed", isCollapsed);

      const content = section.querySelector<HTMLElement>(".panel-section-content");
      if (content) {
        content.hidden = isCollapsed;
      }

      const upButton = section.querySelector<HTMLButtonElement>(
        'button[data-action="section-move-up"]'
      );
      if (upButton) {
        const canMoveUp = orderIndex > 0;
        upButton.disabled = !canMoveUp;
        upButton.textContent = canMoveUp ? "▲" : "△";
      }

      const downButton = section.querySelector<HTMLButtonElement>(
        'button[data-action="section-move-down"]'
      );
      if (downButton) {
        const canMoveDown = orderIndex >= 0 && orderIndex < this.sectionOrder.length - 1;
        downButton.disabled = !canMoveDown;
        downButton.textContent = canMoveDown ? "▼" : "▽";
      }

      const collapseButton = section.querySelector<HTMLButtonElement>(
        'button[data-action="section-toggle-collapse"]'
      );
      if (collapseButton) {
        collapseButton.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
        collapseButton.title = isCollapsed ? "Expand section" : "Collapse section";
        collapseButton.setAttribute("aria-label", isCollapsed ? "Expand section" : "Collapse section");
        const indicator = collapseButton.querySelector<HTMLElement>(".section-collapse-indicator");
        if (indicator) {
          indicator.textContent = isCollapsed ? "＋" : "－";
        }
      }
    });
  }

  private loadSectionLayout(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      const rawLayout = localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY);
      if (!rawLayout) {
        return;
      }

      const parsed = JSON.parse(rawLayout) as Partial<SidebarLayoutPrefs>;
      const rawOrder = Array.isArray(parsed.order) ? parsed.order : [];
      const validStoredOrder = rawOrder.filter(
        (value): value is SidebarSectionId =>
          typeof value === "string" && isSidebarSectionId(value)
      );
      const normalizedOrder: SidebarSectionId[] = [];
      validStoredOrder.forEach((sectionId) => {
        if (!normalizedOrder.includes(sectionId)) {
          normalizedOrder.push(sectionId);
        }
      });
      SIDEBAR_SECTION_IDS.forEach((sectionId) => {
        if (!normalizedOrder.includes(sectionId)) {
          normalizedOrder.push(sectionId);
        }
      });
      this.sectionOrder = normalizedOrder;

      const rawCollapsed = Array.isArray(parsed.collapsed) ? parsed.collapsed : [];
      this.collapsedSectionIds = new Set(
        rawCollapsed.filter(
          (value): value is SidebarSectionId =>
            typeof value === "string" && isSidebarSectionId(value)
        )
      );
    } catch {
      this.sectionOrder = [...SIDEBAR_SECTION_IDS];
      this.collapsedSectionIds.clear();
    }
  }

  private saveSectionLayout(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    const layout: SidebarLayoutPrefs = {
      order: [...this.sectionOrder],
      collapsed: [...this.collapsedSectionIds]
    };

    try {
      localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Ignore persistence failures (quota/private mode).
    }
  }

  private loadCollapsedTracks(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      const raw = localStorage.getItem(TRACK_COLLAPSE_STORAGE_KEY);
      if (!raw) {
        this.collapsedTrackIds.clear();
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.collapsedTrackIds.clear();
        return;
      }

      this.collapsedTrackIds = new Set(
        parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
      );
    } catch {
      this.collapsedTrackIds.clear();
    }
  }

  private saveCollapsedTracks(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      localStorage.setItem(
        TRACK_COLLAPSE_STORAGE_KEY,
        JSON.stringify([...this.collapsedTrackIds])
      );
    } catch {
      // Ignore persistence failures (quota/private mode).
    }
  }

  private pruneCollapsedTrackIds(state: AppState): void {
    if (state.tracks.length === 0) {
      return;
    }

    const validIds = new Set(state.tracks.map((track) => track.id));
    const nextCollapsed = new Set(
      Array.from(this.collapsedTrackIds).filter((trackId) => validIds.has(trackId))
    );
    const changed = nextCollapsed.size !== this.collapsedTrackIds.size;
    this.collapsedTrackIds = nextCollapsed;
    if (changed) {
      this.saveCollapsedTracks();
    }
  }

  private syncEditModeControls(editMode: EditInteractionMode): void {
    const modeInputs = this.root.querySelectorAll<HTMLInputElement>('input[name="edit-mode"]');

    modeInputs.forEach((input) => {
      const isActive = input.value === editMode;
      input.checked = isActive;
      input.closest(".edit-mode-card")?.classList.toggle("is-active", isActive);
    });
  }

  private syncMapControls(mapViewSettings: MapViewSettings): void {
    const styleSelect = this.root.querySelector<HTMLSelectElement>('select[data-action="map-style"]');
    if (styleSelect) {
      const hasSelectedStyle = MAP_STYLE_OPTIONS.some((option) => option.id === mapViewSettings.baseStyle);
      styleSelect.value = hasSelectedStyle ? mapViewSettings.baseStyle : MAP_STYLE_OPTIONS[0]?.id ?? "osm-standard";
    }

    const darken = Number.isFinite(mapViewSettings.darkenPercent)
      ? Math.max(0, Math.min(100, Math.round(mapViewSettings.darkenPercent)))
      : 0;
    const desaturate = Number.isFinite(mapViewSettings.desaturatePercent)
      ? Math.max(0, Math.min(100, Math.round(mapViewSettings.desaturatePercent)))
      : 0;

    const darkenInput = this.root.querySelector<HTMLInputElement>('input[data-action="map-darken"]');
    if (darkenInput) {
      darkenInput.value = String(darken);
    }

    const desaturateInput = this.root.querySelector<HTMLInputElement>('input[data-action="map-desaturate"]');
    if (desaturateInput) {
      desaturateInput.value = String(desaturate);
    }

    const darkenValue = this.root.querySelector<HTMLElement>("#map-darken-value");
    if (darkenValue) {
      darkenValue.textContent = `${darken}%`;
    }

    const desaturateValue = this.root.querySelector<HTMLElement>("#map-desaturate-value");
    if (desaturateValue) {
      desaturateValue.textContent = `${desaturate}%`;
    }
  }

  private syncAnalysisControls(
    analysisSettings: AnalysisSettings,
    velocityMaxDisplayValue: number
  ): void {
    const mode = getAnalysisHeaderMode(analysisSettings);
    const velocityEnabled = mode === "velocity" || mode === "acceleration";
    const odEnabled = mode === "od";
    const modeButtons = this.root.querySelectorAll<HTMLButtonElement>('button[data-action="analysis-mode"]');
    modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle("is-active", isActive);
      button.classList.toggle("is-inactive", !isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    const headerModeButton = this.root.querySelector<HTMLButtonElement>('button[data-action="analysis-mode-cycle"]');
    if (headerModeButton) {
      headerModeButton.dataset.mode = mode;
      headerModeButton.textContent = getAnalysisHeaderGlyph(mode);
      headerModeButton.classList.toggle("is-off", mode === "off");
      headerModeButton.classList.toggle("is-velocity", mode === "velocity");
      headerModeButton.classList.toggle("is-acceleration", mode === "acceleration");
      headerModeButton.classList.toggle("is-od", mode === "od");
      headerModeButton.setAttribute("aria-pressed", mode === "off" ? "false" : "true");
      headerModeButton.title = `Analysis mode: ${getAnalysisHeaderLabel(mode)} (click to cycle)`;
      headerModeButton.setAttribute(
        "aria-label",
        `Analysis mode: ${getAnalysisHeaderLabel(mode)}. Click to cycle between Off, Velocity, Acceleration, and OD.`
      );
    }

    const scaleButtons = this.root.querySelectorAll<HTMLButtonElement>(
      'button[data-action="analysis-velocity-scale"]'
    );
    scaleButtons.forEach((button) => {
      const isActive = button.dataset.scale === analysisSettings.velocityScaleMode;
      button.classList.toggle("is-active", isActive);
      button.classList.toggle("is-inactive", !isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.disabled = !velocityEnabled;
    });

    const unitLabel = mode === "acceleration" ? "m/s²" : "km/h";
    const inputStep = mode === "acceleration" ? "0.1" : "1";
    const maxLabel = this.root.querySelector<HTMLElement>("#analysis-velocity-max-label");
    if (maxLabel) {
      maxLabel.textContent = `Max (${unitLabel})`;
    }

    const velocityScaleField = this.root.querySelector<HTMLElement>("#analysis-velocity-scale-field");
    if (velocityScaleField) {
      velocityScaleField.hidden = !velocityEnabled;
    }

    const velocityMaxField = this.root.querySelector<HTMLElement>("#analysis-velocity-max-field");
    if (velocityMaxField) {
      velocityMaxField.hidden = !velocityEnabled;
    }

    this.syncOdMetricSelectors("color", analysisSettings.odColorMetricKey, odEnabled);
    this.syncOdMetricSelectors("draw-order", analysisSettings.odDrawOrderMetricKey, odEnabled);

    const odLinkField = this.root.querySelector<HTMLElement>("#analysis-od-link-field");
    if (odLinkField) {
      odLinkField.hidden = !odEnabled;
    }

    const odLinkMetricsButton = this.root.querySelector<HTMLButtonElement>(
      'button[data-action="analysis-od-toggle-link-metrics"]'
    );
    if (odLinkMetricsButton) {
      const isActive = analysisSettings.odLinkMetricSelections;
      odLinkMetricsButton.classList.toggle("is-active", isActive);
      odLinkMetricsButton.classList.toggle("is-inactive", !isActive);
      odLinkMetricsButton.setAttribute("aria-pressed", isActive ? "true" : "false");
      odLinkMetricsButton.disabled = !odEnabled;
    }

    const odLinkDetailsButton = this.root.querySelector<HTMLButtonElement>(
      'button[data-action="analysis-od-toggle-link-details"]'
    );
    if (odLinkDetailsButton) {
      const isActive = analysisSettings.odLinkVariantValueSelections;
      odLinkDetailsButton.classList.toggle("is-active", isActive);
      odLinkDetailsButton.classList.toggle("is-inactive", !isActive);
      odLinkDetailsButton.setAttribute("aria-pressed", isActive ? "true" : "false");
      odLinkDetailsButton.disabled = !odEnabled;
    }

    const maxInput = this.root.querySelector<HTMLInputElement>('input[data-action="analysis-velocity-max"]');
    const maxSlider = this.root.querySelector<HTMLInputElement>(
      'input[data-action="analysis-velocity-max-slider"]'
    );
    const roundedMax = Number.isFinite(analysisSettings.velocityFixedMax)
      ? Math.max(
        0,
        Math.min(
          350,
          mode === "acceleration"
            ? Math.round(analysisSettings.velocityFixedMax * 10) / 10
            : Math.round(analysisSettings.velocityFixedMax)
        )
      )
      : 0;

    if (maxInput) {
      maxInput.value = String(roundedMax);
      maxInput.step = inputStep;
      maxInput.disabled = !velocityEnabled || analysisSettings.velocityScaleMode !== "fixed";
    }
    if (maxSlider) {
      maxSlider.value = String(roundedMax);
      maxSlider.step = inputStep;
      maxSlider.disabled = !velocityEnabled || analysisSettings.velocityScaleMode !== "fixed";
    }

    const colormapSelect = this.root.querySelector<HTMLSelectElement>('select[data-action="analysis-colormap"]');
    if (colormapSelect) {
      const optionExists = Array.from(colormapSelect.options).some(
        (option) => option.value === analysisSettings.colormapId
      );
      colormapSelect.value = optionExists
        ? analysisSettings.colormapId
        : colormapSelect.options[0]?.value ?? "";
      colormapSelect.disabled = mode === "off";
    }

    const analysisMeta = this.root.querySelector<HTMLElement>("#analysis-meta");
    if (!analysisMeta) {
      return;
    }

    if (mode === "off") {
      analysisMeta.textContent = "Analysis is off.";
      return;
    }

    if (odEnabled) {
      const colorMetric = this.getOdMetricDefinition(analysisSettings.odColorMetricKey);
      const drawMetric = this.getOdMetricDefinition(analysisSettings.odDrawOrderMetricKey);
      const colorLabel = colorMetric?.label ?? "Weight";
      const drawLabel = drawMetric?.label ?? colorLabel;
      const metricLinkLabel = analysisSettings.odLinkMetricSelections ? "linked" : "independent";
      const detailLinkLabel = analysisSettings.odLinkVariantValueSelections
        ? "variant/value linked"
        : "variant/value independent";
      analysisMeta.textContent = `Color/rank uses ${colorLabel}. Draw order uses ${drawLabel}. Metrics are ${metricLinkLabel}; ${detailLinkLabel}.`;
      return;
    }

    const roundedAutoMax = Number.isFinite(velocityMaxDisplayValue)
      ? Math.round(velocityMaxDisplayValue * 10) / 10
      : 0;
    const metricLabel = mode === "acceleration" ? "acceleration" : "velocity";
    analysisMeta.textContent =
      analysisSettings.velocityScaleMode === "fixed"
        ? `Fixed ${metricLabel} max: ${roundedMax} ${unitLabel}.`
        : `Max ${metricLabel}: ${roundedAutoMax} ${unitLabel} across visible tracks.`;
  }

  private buildSummaryMessage(summary: ImportSummary): string {
    const parts: string[] = [];
    if (summary.importedTrackCount > 0) {
      parts.push(`${summary.importedTrackCount} track${summary.importedTrackCount === 1 ? "" : "s"}`);
    }
    if (summary.importedBundleCount > 0) {
      parts.push(`${summary.importedBundleCount} bundle${summary.importedBundleCount === 1 ? "" : "s"}`);
    }

    const successMessage =
      parts.length > 0
        ? `Last import added ${parts.join(" and ")}.`
        : "Last import added no tracks or bundles.";

    if (summary.issues.length === 0) {
      return successMessage;
    }

    const issuePreview = summary.issues
      .slice(0, 2)
      .map((issue) => `${issue.fileName}: ${issue.message}`)
      .join(" | ");

    const suffix = summary.issues.length > 2 ? ` (+${summary.issues.length - 2} more)` : "";
    return `${successMessage} ${issuePreview}${suffix}`;
  }

  private escapeHtml(value: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return value.replace(/[&<>"']/g, (char) => map[char]);
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }
}
