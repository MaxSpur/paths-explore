import type {
  AppState,
  EditInteractionMode,
  ImportSummary,
  SegmentColorMetric,
  VelocityScaleMode,
  VelocityViewSettings
} from "../model/types";
import { COLORMAPS, DEFAULT_COLORMAP_ID } from "../colormaps";

const SIDEBAR_SECTION_IDS = ["import", "edit", "velocity", "tracks"] as const;
type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number];
const SIDEBAR_LAYOUT_STORAGE_KEY = "path-segments-sidebar-layout-v1";

interface SidebarLayoutPrefs {
  order: SidebarSectionId[];
  collapsed: SidebarSectionId[];
}

function isSidebarSectionId(value: string): value is SidebarSectionId {
  return (SIDEBAR_SECTION_IDS as readonly string[]).includes(value);
}

interface SidebarCallbacks {
  onImportFiles: (files: File[] | FileList) => Promise<void>;
  onToggleVisibility: (trackId: string, visible: boolean) => void;
  onTogglePoints: (trackId: string, show: boolean) => void;
  onToggleSegments: (trackId: string, show: boolean) => void;
  onMoveTrackUp: (trackId: string) => void;
  onMoveTrackDown: (trackId: string) => void;
  onFocusTrack: (trackId: string) => void;
  onExportTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onToggleEdit: (trackId: string) => void;
  onEditModeChange: (mode: EditInteractionMode) => void;
  onVelocityModeChange: (mode: "off" | SegmentColorMetric) => void;
  onVelocityScaleModeChange: (mode: VelocityScaleMode) => void;
  onVelocityFixedMaxChange: (maxValue: number) => void;
  onVelocityColormapChange: (colormapId: string) => void;
}

export class SidebarView {
  private root: HTMLElement;
  private callbacks: SidebarCallbacks;
  private fileInput: HTMLInputElement;
  private trackList: HTMLElement;
  private summaryStatus: HTMLElement;
  private collapsedTrackIds = new Set<string>();
  private sectionOrder: SidebarSectionId[] = [...SIDEBAR_SECTION_IDS];
  private collapsedSectionIds = new Set<SidebarSectionId>();
  private lastState: AppState = { tracks: [], selectedPointIds: [] };
  private lastSummary?: ImportSummary;
  private lastEditMode: EditInteractionMode = "move";
  private lastVelocitySettings: VelocityViewSettings = {
    enabled: false,
    metric: "velocity",
    scaleMode: "auto",
    fixedMax: 60,
    colormapId: DEFAULT_COLORMAP_ID
  };
  private lastVelocityMaxDisplayValue = 0;

  constructor(root: HTMLElement, callbacks: SidebarCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    const colormapOptions = COLORMAPS.map(
      (colormap) => `<option value="${colormap.id}">${this.escapeHtml(colormap.name)}</option>`
    ).join("");

    this.root.innerHTML = `
      <header class="panel-header">
        <h1>Path Segments</h1>
        <p>Load GPX, KML, and GeoJSON path files.</p>
      </header>

      <section class="panel-section sidebar-section" data-section-id="import">
        <div class="panel-section-header">
          <h2>Import</h2>
          ${this.buildSectionControls("import")}
        </div>
        <div class="panel-section-content">
          <label class="import-label" for="track-file-input">Import files</label>
          <input id="track-file-input" class="file-input" type="file" multiple accept=".gpx,.kml,.geojson,.json" />
          <p class="import-hint">Tip: drag and drop files anywhere on the page.</p>
          <p id="summary-status" class="status-text">Loaded 0 tracks. No imports yet.</p>
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
            Hold Shift to add to selection in Move/Marquee/Lasso. Use Info mode to inspect segments.
          </p>
        </div>
      </section>

      <section class="panel-section panel-velocity sidebar-section" data-section-id="velocity">
        <div class="panel-section-header">
          <h2>Velocity</h2>
          ${this.buildSectionControls("velocity")}
        </div>
        <div class="panel-section-content">
          <div class="velocity-mode-row segmented-control" role="group" aria-label="Segment coloring mode">
            <button data-action="velocity-mode" data-mode="off" type="button" class="segmented-btn velocity-mode-btn">Off</button>
            <button data-action="velocity-mode" data-mode="velocity" type="button" class="segmented-btn velocity-mode-btn">Velocity</button>
            <button data-action="velocity-mode" data-mode="acceleration" type="button" class="segmented-btn velocity-mode-btn">Acceleration</button>
          </div>
          <div class="velocity-controls">
            <label class="velocity-field">
              <span>Scale</span>
              <div class="segmented-control velocity-scale-row" role="group" aria-label="Scale mode">
                <button data-action="velocity-scale" data-scale="auto" type="button" class="segmented-btn velocity-scale-btn">
                  Auto
                </button>
                <button data-action="velocity-scale" data-scale="fixed" type="button" class="segmented-btn velocity-scale-btn">
                  Fixed
                </button>
              </div>
            </label>
            <label class="velocity-field">
              <span id="velocity-max-label">Max (km/h)</span>
              <div class="velocity-max-row">
                <input
                  class="velocity-max-input"
                  data-action="velocity-max"
                  type="number"
                  min="0"
                  max="350"
                  step="1"
                  value="60"
                />
                <input
                  class="velocity-max-slider"
                  data-action="velocity-max-slider"
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
              <select data-action="velocity-colormap">
                ${colormapOptions}
              </select>
            </label>
          </div>
          <p class="velocity-meta" id="velocity-meta">Auto max: - km/h.</p>
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
    this.trackList = this.root.querySelector("#track-list") as HTMLElement;
    this.summaryStatus = this.root.querySelector("#summary-status") as HTMLElement;

    this.loadSectionLayout();
    this.applySectionLayout();
    this.bindImportControls();
    this.bindPanelActions();
  }

  getFileInputElement(): HTMLInputElement {
    return this.fileInput;
  }

  render(
    state: AppState,
    summary: ImportSummary | undefined,
    editMode: EditInteractionMode,
    velocitySettings: VelocityViewSettings,
    velocityMaxDisplayValue: number
  ): void {
    this.lastState = state;
    this.lastSummary = summary;
    this.lastEditMode = editMode;
    this.lastVelocitySettings = velocitySettings;
    this.lastVelocityMaxDisplayValue = velocityMaxDisplayValue;

    this.pruneCollapsedTrackIds(state);
    this.syncEditModeControls(editMode);
    this.syncVelocityControls(velocitySettings, velocityMaxDisplayValue);
    this.applySectionLayout();

    const importMessage = summary ? this.buildSummaryMessage(summary) : "No imports yet.";
    this.summaryStatus.textContent = `Loaded ${state.tracks.length} track${
      state.tracks.length === 1 ? "" : "s"
    }. ${importMessage}`;
    this.summaryStatus.classList.toggle("has-error", summary ? summary.issues.length > 0 : false);

    if (state.tracks.length === 0) {
      this.trackList.innerHTML = '<p class="empty-message">No tracks loaded.</p>';
      return;
    }

    this.trackList.innerHTML = state.tracks
      .map((track, index) => {
        const isEditing = state.editingTrackId === track.id;
        const isCollapsed = this.collapsedTrackIds.has(track.id);
        const safeTrackName = this.escapeHtml(track.name);
        const canMoveUp = index > 0;
        const canMoveDown = index < state.tracks.length - 1;

        return `
          <article class="track-item${isEditing ? " is-editing" : ""}${
            isCollapsed ? " is-collapsed" : ""
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
            ${
              isCollapsed
                ? ""
                : `
              <div class="track-toggle-row">
                <button
                  class="track-toggle-btn ${track.visible ? "is-active" : "is-inactive"}"
                  data-action="toggle-visible"
                  data-track-id="${track.id}"
                  data-next-visible="${track.visible ? "false" : "true"}"
                  type="button"
                  aria-pressed="${track.visible ? "true" : "false"}"
                >
                  Visible
                </button>
                <button
                  class="track-toggle-btn ${track.showSegments ? "is-active" : "is-inactive"}"
                  data-action="toggle-segments"
                  data-track-id="${track.id}"
                  data-next-segments="${track.showSegments ? "false" : "true"}"
                  type="button"
                  aria-pressed="${track.showSegments ? "true" : "false"}"
                >
                  Lines
                </button>
                <button
                  class="track-toggle-btn ${track.showPoints || isEditing ? "is-active" : "is-inactive"}"
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
                  class="track-toggle-btn track-edit-toggle ${isEditing ? "is-active" : "is-inactive"}"
                  data-action="toggle-edit"
                  data-track-id="${track.id}"
                  type="button"
                  aria-pressed="${isEditing ? "true" : "false"}"
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
        if (action === "velocity-colormap") {
          this.callbacks.onVelocityColormapChange(target.value);
        }

        return;
      }

      if (action === "edit-mode") {
        this.callbacks.onEditModeChange(target.value as EditInteractionMode);
        return;
      }

      if (action === "velocity-max") {
        const nextMax = Number.parseFloat(target.value);
        if (Number.isFinite(nextMax)) {
          this.callbacks.onVelocityFixedMaxChange(nextMax);
        }
        return;
      }

      if (action === "velocity-max-slider") {
        const nextMax = Number.parseFloat(target.value);
        if (Number.isFinite(nextMax)) {
          this.callbacks.onVelocityFixedMaxChange(nextMax);
        }
        return;
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

      if (action === "velocity-mode") {
        const mode = button.dataset.mode;
        if (mode === "off" || mode === "velocity" || mode === "acceleration") {
          this.callbacks.onVelocityModeChange(mode);
        }
        return;
      }

      if (action === "velocity-scale") {
        const mode = button.dataset.scale;
        if (mode === "auto" || mode === "fixed") {
          this.callbacks.onVelocityScaleModeChange(mode);
        }
        return;
      }

      if (!trackId) {
        return;
      }

      if (action === "toggle-visible") {
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
      if (action !== "velocity-max" && action !== "velocity-max-slider") {
        return;
      }

      const nextMax = Number.parseFloat(target.value);
      if (!Number.isFinite(nextMax)) {
        return;
      }

      this.callbacks.onVelocityFixedMaxChange(nextMax);
    });
  }

  private collapseAll(): void {
    this.collapsedTrackIds = new Set(this.lastState.tracks.map((track) => track.id));
    this.rerenderFromCache();
  }

  private expandAll(): void {
    this.collapsedTrackIds.clear();
    this.rerenderFromCache();
  }

  private toggleTrackCollapse(trackId: string): void {
    if (this.collapsedTrackIds.has(trackId)) {
      this.collapsedTrackIds.delete(trackId);
    } else {
      this.collapsedTrackIds.add(trackId);
    }

    this.rerenderFromCache();
  }

  private rerenderFromCache(): void {
    this.render(
      this.lastState,
      this.lastSummary,
      this.lastEditMode,
      this.lastVelocitySettings,
      this.lastVelocityMaxDisplayValue
    );
  }

  private buildSectionControls(sectionId: SidebarSectionId): string {
    return `
      <div class="panel-section-controls">
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

  private pruneCollapsedTrackIds(state: AppState): void {
    const validIds = new Set(state.tracks.map((track) => track.id));
    this.collapsedTrackIds = new Set(
      Array.from(this.collapsedTrackIds).filter((trackId) => validIds.has(trackId))
    );
  }

  private syncEditModeControls(editMode: EditInteractionMode): void {
    const modeInputs = this.root.querySelectorAll<HTMLInputElement>('input[name="edit-mode"]');

    modeInputs.forEach((input) => {
      const isActive = input.value === editMode;
      input.checked = isActive;
      input.closest(".edit-mode-card")?.classList.toggle("is-active", isActive);
    });
  }

  private syncVelocityControls(
    velocitySettings: VelocityViewSettings,
    velocityMaxDisplayValue: number
  ): void {
    const mode = velocitySettings.enabled ? velocitySettings.metric : "off";
    const modeButtons = this.root.querySelectorAll<HTMLButtonElement>('button[data-action="velocity-mode"]');
    modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle("is-active", isActive);
      button.classList.toggle("is-inactive", !isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    const scaleButtons = this.root.querySelectorAll<HTMLButtonElement>('button[data-action="velocity-scale"]');
    scaleButtons.forEach((button) => {
      const isActive = button.dataset.scale === velocitySettings.scaleMode;
      button.classList.toggle("is-active", isActive);
      button.classList.toggle("is-inactive", !isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.disabled = !velocitySettings.enabled;
    });

    const unitLabel = velocitySettings.metric === "acceleration" ? "m/s²" : "km/h";
    const inputStep = velocitySettings.metric === "acceleration" ? "0.1" : "1";
    const maxLabel = this.root.querySelector<HTMLElement>("#velocity-max-label");
    if (maxLabel) {
      maxLabel.textContent = `Max (${unitLabel})`;
    }

    const maxInput = this.root.querySelector<HTMLInputElement>('input[data-action="velocity-max"]');
    const maxSlider = this.root.querySelector<HTMLInputElement>('input[data-action="velocity-max-slider"]');
    const roundedMax = Number.isFinite(velocitySettings.fixedMax)
      ? Math.max(
          0,
          Math.min(
            350,
            velocitySettings.metric === "acceleration"
              ? Math.round(velocitySettings.fixedMax * 10) / 10
              : Math.round(velocitySettings.fixedMax)
          )
        )
      : 0;

    if (maxInput) {
      maxInput.value = String(roundedMax);
      maxInput.step = inputStep;
      maxInput.disabled = !velocitySettings.enabled || velocitySettings.scaleMode !== "fixed";
    }
    if (maxSlider) {
      maxSlider.value = String(roundedMax);
      maxSlider.step = inputStep;
      maxSlider.disabled = !velocitySettings.enabled || velocitySettings.scaleMode !== "fixed";
    }

    const colormapSelect = this.root.querySelector<HTMLSelectElement>('select[data-action="velocity-colormap"]');
    if (colormapSelect) {
      const optionExists = Array.from(colormapSelect.options).some(
        (option) => option.value === velocitySettings.colormapId
      );
      colormapSelect.value = optionExists
        ? velocitySettings.colormapId
        : colormapSelect.options[0]?.value ?? "";
      colormapSelect.disabled = !velocitySettings.enabled;
    }

    const velocityMeta = this.root.querySelector<HTMLElement>("#velocity-meta");
    if (!velocityMeta) {
      return;
    }

    if (!velocitySettings.enabled) {
      velocityMeta.textContent = "Segment coloring is off.";
      return;
    }

    const roundedAutoMax = Number.isFinite(velocityMaxDisplayValue)
      ? Math.round(velocityMaxDisplayValue * 10) / 10
      : 0;
    const metricLabel = velocitySettings.metric === "acceleration" ? "acceleration" : "velocity";
    velocityMeta.textContent =
      velocitySettings.scaleMode === "fixed"
        ? `Fixed ${metricLabel} max: ${roundedMax} ${unitLabel}.`
        : `Auto ${metricLabel} max: ${roundedAutoMax} ${unitLabel} across visible tracks.`;
  }

  private buildSummaryMessage(summary: ImportSummary): string {
    const importCountLabel = `${summary.importedTrackCount} track${
      summary.importedTrackCount === 1 ? "" : "s"
    }`;
    const successMessage =
      summary.importedTrackCount > 0
        ? `Last import added ${importCountLabel}.`
        : "Last import added no tracks.";

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
}
