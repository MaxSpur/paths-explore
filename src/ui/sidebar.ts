import type {
  AppState,
  EditInteractionMode,
  ImportSummary,
  VelocityScaleMode,
  VelocityViewSettings
} from "../model/types";
import { COLORMAPS, DEFAULT_COLORMAP_ID } from "../colormaps";

interface SidebarCallbacks {
  onImportFiles: (files: File[] | FileList) => Promise<void>;
  onToggleVisibility: (trackId: string, visible: boolean) => void;
  onTogglePoints: (trackId: string, show: boolean) => void;
  onFocusTrack: (trackId: string) => void;
  onExportTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onToggleEdit: (trackId: string) => void;
  onEditModeChange: (mode: EditInteractionMode) => void;
  onVelocityEnabledChange: (enabled: boolean) => void;
  onVelocityScaleModeChange: (mode: VelocityScaleMode) => void;
  onVelocityFixedMaxChange: (maxKmh: number) => void;
  onVelocityColormapChange: (colormapId: string) => void;
}

export class SidebarView {
  private root: HTMLElement;
  private callbacks: SidebarCallbacks;
  private fileInput: HTMLInputElement;
  private dropZone: HTMLElement;
  private trackList: HTMLElement;
  private summaryCount: HTMLElement;
  private summaryStatus: HTMLElement;
  private collapsedTrackIds = new Set<string>();
  private lastState: AppState = { tracks: [], selectedPointIds: [] };
  private lastSummary?: ImportSummary;
  private lastEditMode: EditInteractionMode = "move";
  private lastVelocitySettings: VelocityViewSettings = {
    enabled: false,
    scaleMode: "auto",
    fixedMaxKmh: 60,
    colormapId: DEFAULT_COLORMAP_ID
  };
  private lastVelocityMaxKmh = 0;

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

      <section class="panel-section">
        <label class="import-label" for="track-file-input">Import files</label>
        <input id="track-file-input" class="file-input" type="file" multiple accept=".gpx,.kml,.geojson,.json" />
        <div id="drop-zone" class="drop-zone" tabindex="0" role="button">
          Drag and drop files here
        </div>
      </section>

      <section class="panel-section panel-edit">
        <h2>Edit</h2>
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
        </div>
        <p class="edit-hint">
          Hold Shift to add to selection. Hold Space to temporarily pan the map in any mode.
        </p>
      </section>

      <section class="panel-section panel-velocity">
        <h2>Velocity</h2>
        <label class="velocity-toggle">
          <input data-action="velocity-enabled" type="checkbox" />
          Color segments by velocity
        </label>
        <div class="velocity-controls">
          <label class="velocity-field">
            <span>Scale</span>
            <select data-action="velocity-scale-mode">
              <option value="auto">Auto (all loaded tracks)</option>
              <option value="fixed">Fixed max velocity</option>
            </select>
          </label>
          <label class="velocity-field">
            <span>Max (km/h)</span>
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
      </section>

      <section class="panel-section panel-summary">
        <div id="summary-count">Loaded tracks: 0</div>
        <div id="summary-status" class="status-text">No imports yet.</div>
      </section>

      <section class="panel-section panel-tracks">
        <div class="tracks-header-row">
          <h2>Tracks</h2>
          <div class="tracks-header-actions">
            <button data-action="collapse-all" type="button">Collapse</button>
            <button data-action="expand-all" type="button">Expand</button>
          </div>
        </div>
        <div id="track-list" class="track-list"></div>
      </section>
    `;

    this.fileInput = this.root.querySelector("#track-file-input") as HTMLInputElement;
    this.dropZone = this.root.querySelector("#drop-zone") as HTMLElement;
    this.trackList = this.root.querySelector("#track-list") as HTMLElement;
    this.summaryCount = this.root.querySelector("#summary-count") as HTMLElement;
    this.summaryStatus = this.root.querySelector("#summary-status") as HTMLElement;

    this.bindImportControls();
    this.bindPanelActions();
  }

  getFileInputElement(): HTMLInputElement {
    return this.fileInput;
  }

  getDropZoneElement(): HTMLElement {
    return this.dropZone;
  }

  render(
    state: AppState,
    summary: ImportSummary | undefined,
    editMode: EditInteractionMode,
    velocitySettings: VelocityViewSettings,
    velocityMaxKmh: number
  ): void {
    this.lastState = state;
    this.lastSummary = summary;
    this.lastEditMode = editMode;
    this.lastVelocitySettings = velocitySettings;
    this.lastVelocityMaxKmh = velocityMaxKmh;

    this.pruneCollapsedTrackIds(state);
    this.syncEditModeControls(editMode);
    this.syncVelocityControls(velocitySettings, velocityMaxKmh);

    this.summaryCount.textContent = `Loaded tracks: ${state.tracks.length}`;

    if (summary) {
      this.summaryStatus.textContent = this.buildSummaryMessage(summary);
      this.summaryStatus.classList.toggle("has-error", summary.issues.length > 0);
    }

    if (state.tracks.length === 0) {
      this.trackList.innerHTML = '<p class="empty-message">No tracks loaded.</p>';
      return;
    }

    this.trackList.innerHTML = state.tracks
      .map((track) => {
        const isEditing = state.editingTrackId === track.id;
        const isCollapsed = this.collapsedTrackIds.has(track.id);
        const safeTrackName = this.escapeHtml(track.name);

        return `
          <article class="track-item${isEditing ? " is-editing" : ""}${
            isCollapsed ? " is-collapsed" : ""
          }" data-track-id="${track.id}">
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
              <span class="track-collapse-indicator">${isCollapsed ? "+" : "-"}</span>
            </button>
            ${
              isCollapsed
                ? ""
                : `
              <div class="track-controls">
                <label>
                  <input data-action="toggle-visible" data-track-id="${track.id}" type="checkbox" ${
                    track.visible ? "checked" : ""
                  } />
                  visible
                </label>
                <label>
                  <input data-action="toggle-points" data-track-id="${track.id}" type="checkbox" ${
                    track.showPoints || isEditing ? "checked" : ""
                  } ${isEditing ? 'disabled title="Forced on during edit mode"' : ""} />
                  points
                </label>
              </div>
              <div class="track-actions">
                <button data-action="focus" data-track-id="${track.id}" type="button">Focus</button>
                <button data-action="export" data-track-id="${track.id}" type="button">Export</button>
                <button data-action="edit" data-track-id="${track.id}" type="button">${
                  isEditing ? "Stop Edit" : "Start Edit"
                }</button>
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

    this.dropZone.addEventListener("click", () => {
      this.fileInput.click();
    });

    this.dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.fileInput.click();
      }
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
        if (action === "velocity-scale-mode") {
          this.callbacks.onVelocityScaleModeChange(target.value as VelocityScaleMode);
        }

        if (action === "velocity-colormap") {
          this.callbacks.onVelocityColormapChange(target.value);
        }

        return;
      }

      if (action === "edit-mode") {
        this.callbacks.onEditModeChange(target.value as EditInteractionMode);
        return;
      }

      if (action === "velocity-enabled") {
        this.callbacks.onVelocityEnabledChange(target.checked);
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

      const trackId = target.dataset.trackId;
      if (!trackId) {
        return;
      }

      if (action === "toggle-visible") {
        this.callbacks.onToggleVisibility(trackId, target.checked);
      }

      if (action === "toggle-points") {
        this.callbacks.onTogglePoints(trackId, target.checked);
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
      const trackId = button.dataset.trackId;

      if (action === "collapse-all") {
        this.collapseAll();
        return;
      }

      if (action === "expand-all") {
        this.expandAll();
        return;
      }

      if (!trackId) {
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

      if (action === "edit") {
        this.callbacks.onToggleEdit(trackId);
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
      this.lastVelocityMaxKmh
    );
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
    velocityMaxKmh: number
  ): void {
    const enabledInput = this.root.querySelector<HTMLInputElement>('input[data-action="velocity-enabled"]');
    if (enabledInput) {
      enabledInput.checked = velocitySettings.enabled;
    }

    const scaleModeSelect = this.root.querySelector<HTMLSelectElement>('select[data-action="velocity-scale-mode"]');
    if (scaleModeSelect) {
      scaleModeSelect.value = velocitySettings.scaleMode;
      scaleModeSelect.disabled = !velocitySettings.enabled;
    }

    const maxInput = this.root.querySelector<HTMLInputElement>('input[data-action="velocity-max"]');
    const maxSlider = this.root.querySelector<HTMLInputElement>('input[data-action="velocity-max-slider"]');
    const roundedMax = Number.isFinite(velocitySettings.fixedMaxKmh)
      ? Math.max(0, Math.min(350, Math.round(velocitySettings.fixedMaxKmh)))
      : 0;

    if (maxInput) {
      maxInput.value = String(roundedMax);
      maxInput.disabled = !velocitySettings.enabled || velocitySettings.scaleMode !== "fixed";
    }
    if (maxSlider) {
      maxSlider.value = String(roundedMax);
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
      velocityMeta.textContent = "Velocity coloring is off.";
      return;
    }

    const roundedAutoMax = Number.isFinite(velocityMaxKmh) ? Math.round(velocityMaxKmh * 10) / 10 : 0;
    velocityMeta.textContent =
      velocitySettings.scaleMode === "fixed"
        ? `Fixed max: ${roundedMax} km/h.`
        : `Auto max: ${roundedAutoMax} km/h across loaded tracks.`;
  }

  private buildSummaryMessage(summary: ImportSummary): string {
    const successMessage =
      summary.importedTrackCount > 0
        ? `Imported ${summary.importedTrackCount} track${summary.importedTrackCount === 1 ? "" : "s"}.`
        : "No tracks imported.";

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
