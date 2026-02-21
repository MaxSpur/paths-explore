import L from "leaflet";
import type { PointCoordinateUpdate, Track } from "../model/types";

interface RenderOptions {
  editingTrackId?: string;
  selectedPointIds?: string[];
  fitToVisible?: boolean;
}

interface MapViewCallbacks {
  onPointSelected?: (trackId: string, pointId: string, additive: boolean) => void;
  onPointsMoved?: (trackId: string, updates: PointCoordinateUpdate[]) => void;
  onMarqueeSelected?: (trackId: string, pointIds: string[], additive: boolean) => void;
  onMapBackgroundClick?: () => void;
}

interface DraggingPointContext {
  trackId: string;
  anchorPointId: string;
  anchorStartLatLng: L.LatLng;
  polyline: L.Polyline;
  markerByPointId: Map<string, L.CircleMarker>;
  indexByPointId: Map<string, number>;
  movePointIds: string[];
  startPositionsByPointId: Map<string, L.LatLng>;
}

interface MarqueeSelectionContext {
  trackId: string;
  startLatLng: L.LatLng;
  rectangle: L.Rectangle;
  additive: boolean;
}

export class MapView {
  private map: L.Map;
  private layerGroup: L.LayerGroup;
  private callbacks: MapViewCallbacks;
  private draggingPoint?: DraggingPointContext;
  private marqueeSelection?: MarqueeSelectionContext;
  private latestTracks: Track[] = [];
  private activeEditingTrackId?: string;
  private suppressNextMapClick = false;

  constructor(container: HTMLElement, callbacks: MapViewCallbacks) {
    this.callbacks = callbacks;
    this.map = L.map(container, {
      zoomControl: true,
      preferCanvas: true,
      boxZoom: false
    }).setView([39.8283, -98.5795], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    this.layerGroup = L.layerGroup().addTo(this.map);

    this.map.on("click", () => {
      if (this.suppressNextMapClick) {
        this.suppressNextMapClick = false;
        return;
      }

      this.callbacks.onMapBackgroundClick?.();
    });

    this.map.on("mousedown", this.onMapMouseDown);

    window.setTimeout(() => {
      this.map.invalidateSize();
    }, 0);
  }

  renderTracks(tracks: Track[], options: RenderOptions = {}): void {
    this.latestTracks = tracks;
    this.activeEditingTrackId = options.editingTrackId;

    this.resetDragState();
    this.resetMarqueeSelection();
    this.layerGroup.clearLayers();

    const selectedPointIdSet = new Set(options.selectedPointIds ?? []);

    for (const track of tracks) {
      if (!track.visible || track.points.length === 0) {
        continue;
      }

      const lineCoords: L.LatLngExpression[] = track.points.map((point) => [point.lat, point.lng]);
      const polyline = L.polyline(lineCoords, {
        color: track.color,
        weight: 4,
        opacity: 0.95
      });

      this.layerGroup.addLayer(polyline);

      const showPoints = track.showPoints || track.id === options.editingTrackId;
      if (!showPoints) {
        continue;
      }

      const markerByPointId = new Map<string, L.CircleMarker>();
      const indexByPointId = new Map<string, number>();
      const selectedInTrack = track.points
        .filter((point) => selectedPointIdSet.has(point.id))
        .map((point) => point.id);

      track.points.forEach((point, pointIndex) => {
        const isSelected = selectedPointIdSet.has(point.id);
        const marker = L.circleMarker([point.lat, point.lng], {
          radius: isSelected ? 6 : 4,
          weight: isSelected ? 3 : 2,
          color: isSelected ? "#111111" : "#ffffff",
          fillColor: track.color,
          fillOpacity: 1,
          interactive: true
        });

        markerByPointId.set(point.id, marker);
        indexByPointId.set(point.id, pointIndex);

        marker.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          const originalEvent = event.originalEvent;
          const additive = originalEvent instanceof MouseEvent ? originalEvent.shiftKey : false;
          this.callbacks.onPointSelected?.(track.id, point.id, additive);
        });

        if (track.id === options.editingTrackId) {
          marker.on("mousedown", (event) => {
            this.startPointDrag(event, {
              trackId: track.id,
              anchorPointId: point.id,
              anchorStartLatLng: marker.getLatLng(),
              polyline,
              markerByPointId,
              indexByPointId,
              movePointIds: selectedInTrack.includes(point.id) ? selectedInTrack : [point.id],
              startPositionsByPointId: new Map()
            });
          });
        }

        this.layerGroup.addLayer(marker);
      });
    }

    if (options.fitToVisible) {
      this.fitVisibleTracks(tracks);
    }
  }

  focusTrack(trackId: string, tracks: Track[]): void {
    const track = tracks.find((candidate) => candidate.id === trackId);

    if (!track || track.points.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(track.points.map((point) => [point.lat, point.lng] as L.LatLngTuple));
    this.map.fitBounds(bounds.pad(0.2));
  }

  fitVisibleTracks(tracks: Track[]): void {
    const visibleTracks = tracks.filter((track) => track.visible && track.points.length > 0);

    if (visibleTracks.length === 0) {
      return;
    }

    const allPoints = visibleTracks.flatMap((track) =>
      track.points.map((point) => [point.lat, point.lng] as L.LatLngTuple)
    );

    const bounds = L.latLngBounds(allPoints);
    this.map.fitBounds(bounds.pad(0.15));
  }

  private startPointDrag(event: L.LeafletMouseEvent, context: DraggingPointContext): void {
    L.DomEvent.stopPropagation(event);

    if (this.draggingPoint) {
      return;
    }

    const filteredIds = context.movePointIds.filter(
      (pointId) => context.markerByPointId.has(pointId) && context.indexByPointId.has(pointId)
    );

    if (filteredIds.length === 0) {
      return;
    }

    const startPositionsByPointId = new Map<string, L.LatLng>();
    for (const pointId of filteredIds) {
      const marker = context.markerByPointId.get(pointId);
      if (!marker) {
        continue;
      }

      startPositionsByPointId.set(pointId, marker.getLatLng());
    }

    this.draggingPoint = {
      ...context,
      movePointIds: filteredIds,
      startPositionsByPointId
    };

    this.map.dragging.disable();
    this.map.on("mousemove", this.onDragMove);
    this.map.on("mouseup", this.onDragEnd);
  }

  private onDragMove = (event: L.LeafletMouseEvent): void => {
    if (!this.draggingPoint) {
      return;
    }

    const deltaLat = event.latlng.lat - this.draggingPoint.anchorStartLatLng.lat;
    const deltaLng = event.latlng.lng - this.draggingPoint.anchorStartLatLng.lng;

    const existing = this.draggingPoint.polyline.getLatLngs();
    const isFlat = Array.isArray(existing) && existing.length > 0 && !Array.isArray(existing[0]);
    const flat = isFlat ? [...(existing as L.LatLng[])] : null;

    for (const pointId of this.draggingPoint.movePointIds) {
      const startPos = this.draggingPoint.startPositionsByPointId.get(pointId);
      const marker = this.draggingPoint.markerByPointId.get(pointId);
      const pointIndex = this.draggingPoint.indexByPointId.get(pointId);

      if (!startPos || !marker || pointIndex === undefined) {
        continue;
      }

      const nextLatLng = L.latLng(startPos.lat + deltaLat, startPos.lng + deltaLng);
      marker.setLatLng(nextLatLng);

      if (flat) {
        flat[pointIndex] = nextLatLng;
      }
    }

    if (flat) {
      this.draggingPoint.polyline.setLatLngs(flat);
    }
  };

  private onDragEnd = (): void => {
    if (!this.draggingPoint) {
      return;
    }

    const updates: PointCoordinateUpdate[] = [];

    for (const pointId of this.draggingPoint.movePointIds) {
      const marker = this.draggingPoint.markerByPointId.get(pointId);

      if (!marker) {
        continue;
      }

      const latLng = marker.getLatLng();
      updates.push({ pointId, lat: latLng.lat, lng: latLng.lng });
    }

    this.callbacks.onPointsMoved?.(this.draggingPoint.trackId, updates);
    this.resetDragState();
  };

  private onMapMouseDown = (event: L.LeafletMouseEvent): void => {
    const originalEvent = event.originalEvent;

    if (!(originalEvent instanceof MouseEvent) || !originalEvent.shiftKey) {
      return;
    }

    if (!this.activeEditingTrackId || this.draggingPoint) {
      return;
    }

    originalEvent.preventDefault();
    L.DomEvent.stopPropagation(originalEvent);

    this.resetMarqueeSelection();

    const rectangle = L.rectangle(L.latLngBounds(event.latlng, event.latlng), {
      color: "#111111",
      weight: 1,
      dashArray: "4 4",
      fillColor: "#111111",
      fillOpacity: 0.08,
      interactive: false
    }).addTo(this.map);

    this.marqueeSelection = {
      trackId: this.activeEditingTrackId,
      startLatLng: event.latlng,
      rectangle,
      additive: true
    };

    this.map.dragging.disable();
    this.map.on("mousemove", this.onMarqueeMove);
    this.map.on("mouseup", this.onMarqueeEnd);
  };

  private onMarqueeMove = (event: L.LeafletMouseEvent): void => {
    if (!this.marqueeSelection) {
      return;
    }

    this.marqueeSelection.rectangle.setBounds(
      L.latLngBounds(this.marqueeSelection.startLatLng, event.latlng)
    );
  };

  private onMarqueeEnd = (): void => {
    if (!this.marqueeSelection) {
      return;
    }

    const { trackId, rectangle, additive } = this.marqueeSelection;
    const bounds = rectangle.getBounds();

    const pointIds = this.getPointIdsInBounds(trackId, bounds);
    this.callbacks.onMarqueeSelected?.(trackId, pointIds, additive);

    this.suppressNextMapClick = true;
    this.resetMarqueeSelection();
  };

  private getPointIdsInBounds(trackId: string, bounds: L.LatLngBounds): string[] {
    const track = this.latestTracks.find((candidate) => candidate.id === trackId);

    if (!track) {
      return [];
    }

    return track.points
      .filter((point) => bounds.contains([point.lat, point.lng]))
      .map((point) => point.id);
  }

  private resetMarqueeSelection(): void {
    if (!this.marqueeSelection) {
      return;
    }

    if (this.map.hasLayer(this.marqueeSelection.rectangle)) {
      this.map.removeLayer(this.marqueeSelection.rectangle);
    }

    this.marqueeSelection = undefined;
    this.map.dragging.enable();
    this.map.off("mousemove", this.onMarqueeMove);
    this.map.off("mouseup", this.onMarqueeEnd);
  }

  private resetDragState(): void {
    if (!this.draggingPoint) {
      return;
    }

    this.draggingPoint = undefined;
    this.map.dragging.enable();
    this.map.off("mousemove", this.onDragMove);
    this.map.off("mouseup", this.onDragEnd);
  }
}
