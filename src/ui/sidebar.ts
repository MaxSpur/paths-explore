import type { AppState, ImportSummary } from "../model/types";

interface SidebarCallbacks {
  onImportFiles: (files: File[] | FileList) => Promise<void>;
  onToggleVisibility: (trackId: string, visible: boolean) => void;
  onTogglePoints: (trackId: string, show: boolean) => void;
  onFocusTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onToggleEdit: (trackId: string) => void;
}

export class SidebarView {
  private root: HTMLElement;
  private callbacks: SidebarCallbacks;
  private fileInput: HTMLInputElement;
  private dropZone: HTMLElement;
  private trackList: HTMLElement;
  private summaryCount: HTMLElement;
  private summaryStatus: HTMLElement;

  constructor(root: HTMLElement, callbacks: SidebarCallbacks) {
    this.root = root;
    this.callbacks = callbacks;

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

      <section class="panel-section panel-summary">
        <div id="summary-count">Loaded tracks: 0</div>
        <div id="summary-status" class="status-text">No imports yet.</div>
      </section>

      <section class="panel-section panel-tracks">
        <h2>Tracks</h2>
        <div id="track-list" class="track-list"></div>
      </section>
    `;

    this.fileInput = this.root.querySelector("#track-file-input") as HTMLInputElement;
    this.dropZone = this.root.querySelector("#drop-zone") as HTMLElement;
    this.trackList = this.root.querySelector("#track-list") as HTMLElement;
    this.summaryCount = this.root.querySelector("#summary-count") as HTMLElement;
    this.summaryStatus = this.root.querySelector("#summary-status") as HTMLElement;

    this.bindImportControls();
    this.bindTrackActions();
  }

  getFileInputElement(): HTMLInputElement {
    return this.fileInput;
  }

  getDropZoneElement(): HTMLElement {
    return this.dropZone;
  }

  render(state: AppState, summary?: ImportSummary): void {
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
        const safeTrackName = this.escapeHtml(track.name);
        return `
          <article class="track-item${isEditing ? " is-editing" : ""}" data-track-id="${track.id}">
            <div class="track-item-header">
              <span class="track-color" style="background:${track.color}"></span>
              <h3 title="${safeTrackName}">${safeTrackName}</h3>
            </div>
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
        } ${isEditing ? "disabled title=\"Forced on during edit mode\"" : ""} />
                points
              </label>
            </div>
            <div class="track-actions">
              <button data-action="focus" data-track-id="${track.id}" type="button">Focus</button>
              <button data-action="edit" data-track-id="${track.id}" type="button">${
          isEditing ? "Stop Edit" : "Edit"
        }</button>
              <button data-action="delete" data-track-id="${track.id}" type="button">Delete</button>
            </div>
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

  private bindTrackActions(): void {
    this.trackList.addEventListener("change", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      const action = target.dataset.action;
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

    this.trackList.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const action = target.dataset.action;
      const trackId = target.dataset.trackId;

      if (!trackId) {
        return;
      }

      if (action === "focus") {
        this.callbacks.onFocusTrack(trackId);
      }

      if (action === "delete") {
        this.callbacks.onDeleteTrack(trackId);
      }

      if (action === "edit") {
        this.callbacks.onToggleEdit(trackId);
      }
    });
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
      "\"": "&quot;",
      "'": "&#39;"
    };

    return value.replace(/[&<>"']/g, (char) => map[char]);
  }
}
