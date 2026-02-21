import { createFileImporter } from "./io/fileImport";
import { MapView } from "./map/mapView";
import { TrackStore } from "./model/store";
import type { EditInteractionMode, ImportSummary } from "./model/types";
import { bindKeyboardEditor } from "./ui/editor";
import { SidebarView } from "./ui/sidebar";

interface RenderOptions {
  fitToVisible?: boolean;
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
  let latestSummary: ImportSummary | undefined;
  let editMode: EditInteractionMode = "move";
  let sidebar: SidebarView;
  let mapView: MapView;

  const render = (options: RenderOptions = {}): void => {
    const state = store.getState();

    sidebar.render(state, latestSummary, editMode);
    mapView.renderTracks(state.tracks, {
      editingTrackId: state.editingTrackId,
      selectedPointIds: state.selectedPointIds,
      editMode,
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
    onMarqueeSelected: (trackId, pointIds, additive) => {
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

  render();
}
