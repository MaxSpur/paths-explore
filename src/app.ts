import { createFileImporter } from "./io/fileImport";
import { createTrackPersistence } from "./io/persistence";
import { serializeTrack } from "./io/serializers";
import { MapView } from "./map/mapView";
import { computeVelocityScaleInfo } from "./map/velocity";
import { DEFAULT_COLORMAP_ID } from "./colormaps";
import { TrackStore } from "./model/store";
import type { EditInteractionMode, ImportSummary, VelocityViewSettings } from "./model/types";
import { bindKeyboardEditor } from "./ui/editor";
import { SidebarView } from "./ui/sidebar";

interface RenderOptions {
  fitToVisible?: boolean;
}

function downloadTrackFile(fileName: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export function createApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app-layout">
      <aside id="sidebar" class="sidebar"></aside>
      <main class="map-shell">
        <div id="map" class="map-view" aria-label="Track map"></div>
      </main>
    </div>
  `;

  const sidebarElement = root.querySelector("#sidebar") as HTMLElement;
  const mapElement = root.querySelector("#map") as HTMLElement;

  const store = new TrackStore();
  const persistence = createTrackPersistence();
  let latestSummary: ImportSummary | undefined;
  let editMode: EditInteractionMode = "move";
  let velocitySettings: VelocityViewSettings = {
    enabled: false,
    scaleMode: "auto",
    fixedMaxKmh: 60,
    colormapId: DEFAULT_COLORMAP_ID
  };
  let sidebar: SidebarView;
  let mapView: MapView;

  const render = (options: RenderOptions = {}): void => {
    const state = store.getState();
    const velocityScaleInfo = computeVelocityScaleInfo(state.tracks, velocitySettings);

    sidebar.render(state, latestSummary, editMode, velocitySettings, velocityScaleInfo.maxKmh);
    mapView.renderTracks(state.tracks, {
      editingTrackId: state.editingTrackId,
      selectedPointIds: state.selectedPointIds,
      editMode,
      velocitySettings,
      fitToVisible: options.fitToVisible
    });
  };

  mapView = new MapView(mapElement, {
    onPointSelected: (trackId, pointId, additive) => {
      store.togglePointSelection(trackId, pointId, additive);
      render();
    },
    onPointsMoved: (trackId, updates) => {
      store.movePoints(trackId, updates);
      render();
    },
    onAreaSelected: (trackId, pointIds, additive) => {
      store.selectPoints(trackId, pointIds, additive);
      render();
    },
    onMapBackgroundClick: () => {
      store.setSelectedPoints(undefined, []);
      render();
    }
  });

  const importer = createFileImporter({
    onTracks: (tracks) => {
      store.addTracks(tracks);
    },
    onSummary: (summary) => {
      latestSummary = summary;
      render({ fitToVisible: true });
    }
  });

  sidebar = new SidebarView(sidebarElement, {
    onImportFiles: async (files) => {
      await importer.importFiles(files);
    },
    onToggleVisibility: (trackId, visible) => {
      store.setTrackVisibility(trackId, visible);
      render({ fitToVisible: true });
    },
    onTogglePoints: (trackId, show) => {
      store.setTrackPointsVisible(trackId, show);
      render();
    },
    onFocusTrack: (trackId) => {
      mapView.focusTrack(trackId, store.getState().tracks);
    },
    onExportTrack: (trackId) => {
      const track = store.getState().tracks.find((candidate) => candidate.id === trackId);
      if (!track) {
        return;
      }

      const serialized = serializeTrack(track);
      downloadTrackFile(serialized.fileName, serialized.mimeType, serialized.content);
    },
    onDeleteTrack: (trackId) => {
      store.removeTrack(trackId);
      render({ fitToVisible: true });
    },
    onToggleEdit: (trackId) => {
      const currentlyEditing = store.getState().editingTrackId;
      store.setEditingTrack(currentlyEditing === trackId ? undefined : trackId);
      render();
    },
    onEditModeChange: (mode) => {
      editMode = mode;
      render();
    },
    onVelocityEnabledChange: (enabled) => {
      velocitySettings = {
        ...velocitySettings,
        enabled
      };
      render();
    },
    onVelocityScaleModeChange: (mode) => {
      velocitySettings = {
        ...velocitySettings,
        scaleMode: mode
      };
      render();
    },
    onVelocityFixedMaxChange: (maxKmh) => {
      if (!Number.isFinite(maxKmh)) {
        return;
      }

      velocitySettings = {
        ...velocitySettings,
        fixedMaxKmh: Math.max(1, maxKmh)
      };
      render();
    },
    onVelocityColormapChange: (colormapId) => {
      velocitySettings = {
        ...velocitySettings,
        colormapId
      };
      render();
    }
  });

  importer.bindDropZone(sidebar.getDropZoneElement());

  bindKeyboardEditor({
    getState: () => store.getState(),
    deleteSelectedPoints: () => {
      store.deleteSelectedPoints();
      render();
    },
    clearSelection: () => {
      store.setSelectedPoints(undefined, []);
      render();
    }
  });

  let previousTracks = store.getState().tracks;
  store.subscribe((state) => {
    if (state.tracks === previousTracks) {
      return;
    }

    previousTracks = state.tracks;
    void persistence.saveTracks(state.tracks);
  });

  void (async () => {
    const tracks = await persistence.loadTracks();
    if (tracks.length === 0) {
      return;
    }

    store.hydrateTracks(tracks);
    latestSummary = {
      importedTrackCount: tracks.length,
      issues: []
    };
    render({ fitToVisible: true });
  })();

  render();
}
