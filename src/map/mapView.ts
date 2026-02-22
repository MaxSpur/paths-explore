import L from "leaflet";
import { getColormapById, sampleColormapColor } from "../colormaps";
import {
  computeTrackSegmentVelocities,
  computeVelocityScaleInfo,
  normalizeVelocity,
  type VelocityScaleInfo
} from "./velocity";
import type {
  EditInteractionMode,
  PointCoordinateUpdate,
  Track,
  VelocityViewSettings
} from "../model/types";

interface RenderOptions {
  editingTrackId?: string;
  selectedPointIds?: string[];
  editMode?: EditInteractionMode;
  fitToVisible?: boolean;
  velocitySettings?: VelocityViewSettings;
}

interface MapViewCallbacks {
  onPointSelected?: (trackId: string, pointId: string, additive: boolean) => void;
  onPointsMoved?: (trackId: string, updates: PointCoordinateUpdate[]) => void;
  onAreaSelected?: (trackId: string, pointIds: string[], additive: boolean) => void;
  onMapBackgroundClick?: () => void;
}

interface DraggingPointContext {
  trackId: string;
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

interface LassoSelectionContext {
  trackId: string;
  vertices: L.LatLng[];
  line: L.Polyline;
  additive: boolean;
}

interface LegendColormap {
  name: string;
  colors: { r: number; g: number; b: number }[];
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export class MapView {
  private map: L.Map;
  private layerGroup: L.LayerGroup;
  private velocityLegendElement?: HTMLDivElement;
  private callbacks: MapViewCallbacks;
  private draggingPoint?: DraggingPointContext;
  private marqueeSelection?: MarqueeSelectionContext;
  private lassoSelection?: LassoSelectionContext;
  private latestTracks: Track[] = [];
  private activeEditingTrackId?: string;
  private activeEditMode: EditInteractionMode = "move";
  private suppressNextMapClick = false;
  private isSpacePressed = false;

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
    const velocityLegendControl = L.control({ position: "bottomright" });
    velocityLegendControl.onAdd = () => {
      const legend = L.DomUtil.create("div", "velocity-legend is-hidden") as HTMLDivElement;
      L.DomEvent.disableClickPropagation(legend);
      L.DomEvent.disableScrollPropagation(legend);
      this.velocityLegendElement = legend;
      return legend;
    };
    velocityLegendControl.addTo(this.map);

    this.map.on("click", () => {
      if (this.suppressNextMapClick) {
        this.suppressNextMapClick = false;
        return;
      }

      if (this.isSpacePressed) {
        return;
      }

      this.callbacks.onMapBackgroundClick?.();
    });

    this.map.on("mousedown", this.onMapMouseDown);
    window.addEventListener("keydown", this.onWindowKeyDown);
    window.addEventListener("keyup", this.onWindowKeyUp);
    window.addEventListener("blur", this.onWindowBlur);

    window.setTimeout(() => {
      this.map.invalidateSize();
    }, 0);
  }

  renderTracks(tracks: Track[], options: RenderOptions = {}): void {
    this.latestTracks = tracks;
    this.activeEditingTrackId = options.editingTrackId;
    this.activeEditMode = options.editMode ?? "move";

    this.resetDragState();
    this.resetMarqueeSelection();
    this.resetLassoSelection();
    this.layerGroup.clearLayers();

    const selectedPointIdSet = new Set(options.selectedPointIds ?? []);
    const velocitySettings = options.velocitySettings;
    const renderVelocity = velocitySettings?.enabled ?? false;
    const colormap = velocitySettings ? getColormapById(velocitySettings.colormapId) : undefined;
    const velocityScaleInfo =
      renderVelocity && velocitySettings ? computeVelocityScaleInfo(tracks, velocitySettings) : undefined;
    this.updateVelocityLegend(renderVelocity, velocitySettings, colormap, velocityScaleInfo);

    for (const track of tracks) {
      if (!track.visible || track.points.length === 0) {
        continue;
      }

      const lineCoords: L.LatLngExpression[] = track.points.map((point) => [point.lat, point.lng]);
      const polyline = renderVelocity
        ? this.renderVelocityTrackPolyline(track, lineCoords, colormap?.colors ?? [], velocityScaleInfo)
        : L.polyline(lineCoords, {
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
          if (this.isSpacePressed) {
            return;
          }

          L.DomEvent.stopPropagation(event);
          const originalEvent = event.originalEvent;
          const additive = originalEvent instanceof MouseEvent ? originalEvent.shiftKey : false;
          this.callbacks.onPointSelected?.(track.id, point.id, additive);
        });

        if (track.id === options.editingTrackId && this.activeEditMode === "move") {
          marker.on("mousedown", (event) => {
            if (this.isSpacePressed) {
              return;
            }

            this.startPointDrag(event, {
              trackId: track.id,
              anchorStartLatLng: marker.getLatLng(),
              polyline,
              markerByPointId,
              indexByPointId,
              movePointIds: selectedInTrack.includes(point.id) ? selectedInTrack : [point.id],
              startPositionsByPointId: new Map()
            });
          });
        } else if (track.id === options.editingTrackId) {
          marker.on("mousedown", (event) => {
            if (!this.isSpacePressed) {
              L.DomEvent.stopPropagation(event);
            }
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

  private renderVelocityTrackPolyline(
    track: Track,
    lineCoords: L.LatLngExpression[],
    colormapColors: { r: number; g: number; b: number }[],
    velocityScaleInfo?: VelocityScaleInfo
  ): L.Polyline {
    const hiddenPolyline = L.polyline(lineCoords, {
      color: "#000000",
      weight: 0,
      opacity: 0,
      interactive: false
    });

    const timedSegmentsByStart = new Map(
      computeTrackSegmentVelocities(track).map((segment) => [segment.startIndex, segment.metersPerSecond])
    );

    for (let idx = 0; idx < track.points.length - 1; idx += 1) {
      const start = track.points[idx];
      const end = track.points[idx + 1];
      const timedVelocity = timedSegmentsByStart.get(idx);

      const hasVelocity =
        timedVelocity !== undefined &&
        velocityScaleInfo !== undefined &&
        velocityScaleInfo.maxMetersPerSecond > 0;

      const normalizedVelocity =
        hasVelocity && timedVelocity !== undefined && velocityScaleInfo
          ? normalizeVelocity(timedVelocity, velocityScaleInfo)
          : 0;

      const segmentColor =
        colormapColors.length > 0
          ? sampleColormapColor(colormapColors, normalizedVelocity)
          : hasVelocity
            ? track.color
            : "#1a4f9a";

      const segment = L.polyline(
        [
          [start.lat, start.lng],
          [end.lat, end.lng]
        ],
        {
          color: segmentColor,
          weight: 5,
          opacity: 1,
          interactive: false,
          lineCap: "round",
          lineJoin: "round"
        }
      );

      this.layerGroup.addLayer(segment);
    }

    return hiddenPolyline;
  }

  private updateVelocityLegend(
    enabled: boolean,
    settings: VelocityViewSettings | undefined,
    colormap: LegendColormap | undefined,
    velocityScaleInfo: VelocityScaleInfo | undefined
  ): void {
    if (!this.velocityLegendElement) {
      return;
    }

    if (!enabled || !settings || !colormap) {
      this.velocityLegendElement.classList.add("is-hidden");
      this.velocityLegendElement.innerHTML = "";
      return;
    }

    const maxKmh = velocityScaleInfo ? Math.max(0, velocityScaleInfo.maxKmh) : 0;
    const gradient = this.buildLegendGradient(colormap.colors);
    const scaleLabel =
      settings.scaleMode === "fixed"
        ? `Fixed scale (max ${Math.max(0, Math.round(settings.fixedMaxKmh))} km/h)`
        : "Auto scale (across loaded tracks)";
    const availability =
      maxKmh <= 0 ? "No timed segments available." : `Current max: ${Math.round(maxKmh * 10) / 10} km/h`;

    this.velocityLegendElement.classList.remove("is-hidden");
    this.velocityLegendElement.innerHTML = `
      <div class="velocity-legend-title">Velocity</div>
      <div class="velocity-legend-bar" style="--legend-gradient: ${gradient};"></div>
      <div class="velocity-legend-scale"><span>0 km/h</span><span>${Math.round(maxKmh * 10) / 10} km/h</span></div>
      <div class="velocity-legend-note">${scaleLabel}</div>
      <div class="velocity-legend-note">${availability}</div>
    `;
  }

  private buildLegendGradient(colors: { r: number; g: number; b: number }[]): string {
    if (colors.length === 0) {
      return "linear-gradient(90deg, rgb(27, 79, 154), rgb(245, 210, 50))";
    }

    const stopCount = Math.min(24, colors.length);
    const stops: string[] = [];

    for (let index = 0; index < stopCount; index += 1) {
      const t = stopCount === 1 ? 0 : index / (stopCount - 1);
      const color = sampleColormapColor(colors, t);
      stops.push(`${color} ${Math.round(t * 1000) / 10}%`);
    }

    return `linear-gradient(90deg, ${stops.join(", ")})`;
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

    if (!(originalEvent instanceof MouseEvent) || originalEvent.button !== 0) {
      return;
    }

    if (this.isSpacePressed) {
      return;
    }

    if (!this.activeEditingTrackId || this.draggingPoint) {
      return;
    }

    const shiftKey = originalEvent.shiftKey;

    if (this.activeEditMode === "lasso") {
      this.startLassoSelection(event, shiftKey);
      return;
    }

    const shouldStartMarquee = this.activeEditMode === "marquee" || shiftKey;
    if (!shouldStartMarquee) {
      return;
    }

    this.startMarqueeSelection(event, shiftKey);
  };

  private onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || event.repeat || isTypingTarget(event.target)) {
      return;
    }

    this.isSpacePressed = true;
    this.updateSpacePanClass();
    event.preventDefault();
  };

  private onWindowKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== "Space") {
      return;
    }

    this.isSpacePressed = false;
    this.updateSpacePanClass();
  };

  private onWindowBlur = (): void => {
    this.isSpacePressed = false;
    this.updateSpacePanClass();
  };

  private startMarqueeSelection(event: L.LeafletMouseEvent, additive: boolean): void {
    const originalEvent = event.originalEvent;
    originalEvent.preventDefault();
    L.DomEvent.stopPropagation(originalEvent);

    this.resetMarqueeSelection();
    this.resetLassoSelection();

    const rectangle = L.rectangle(L.latLngBounds(event.latlng, event.latlng), {
      color: "#111111",
      weight: 1,
      dashArray: "4 4",
      fillColor: "#111111",
      fillOpacity: 0.08,
      interactive: false
    }).addTo(this.map);

    this.marqueeSelection = {
      trackId: this.activeEditingTrackId!,
      startLatLng: event.latlng,
      rectangle,
      additive
    };

    this.map.dragging.disable();
    this.map.on("mousemove", this.onMarqueeMove);
    this.map.on("mouseup", this.onMarqueeEnd);
  }

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
    this.callbacks.onAreaSelected?.(trackId, pointIds, additive);

    this.suppressNextMapClick = true;
    this.resetMarqueeSelection();
  };

  private startLassoSelection(event: L.LeafletMouseEvent, additive: boolean): void {
    const originalEvent = event.originalEvent;
    originalEvent.preventDefault();
    L.DomEvent.stopPropagation(originalEvent);

    this.resetMarqueeSelection();
    this.resetLassoSelection();

    const line = L.polyline([event.latlng], {
      color: "#111111",
      weight: 1.5,
      dashArray: "4 4",
      opacity: 0.95,
      interactive: false
    }).addTo(this.map);

    this.lassoSelection = {
      trackId: this.activeEditingTrackId!,
      vertices: [event.latlng],
      line,
      additive
    };

    this.map.dragging.disable();
    this.map.on("mousemove", this.onLassoMove);
    this.map.on("mouseup", this.onLassoEnd);
  }

  private onLassoMove = (event: L.LeafletMouseEvent): void => {
    if (!this.lassoSelection) {
      return;
    }

    const { vertices } = this.lassoSelection;
    const lastVertex = vertices[vertices.length - 1];

    if (this.map.distance(lastVertex, event.latlng) < 2) {
      return;
    }

    vertices.push(event.latlng);
    this.lassoSelection.line.setLatLngs([...vertices, vertices[0]]);
  };

  private onLassoEnd = (): void => {
    if (!this.lassoSelection) {
      return;
    }

    const { trackId, vertices, additive } = this.lassoSelection;

    const pointIds =
      vertices.length >= 3 ? this.getPointIdsInPolygon(trackId, vertices) : [];

    this.callbacks.onAreaSelected?.(trackId, pointIds, additive);
    this.suppressNextMapClick = true;
    this.resetLassoSelection();
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

  private getPointIdsInPolygon(trackId: string, vertices: L.LatLng[]): string[] {
    const track = this.latestTracks.find((candidate) => candidate.id === trackId);

    if (!track || vertices.length < 3) {
      return [];
    }

    return track.points
      .filter((point) => this.isPointInsidePolygon(point.lat, point.lng, vertices))
      .map((point) => point.id);
  }

  private isPointInsidePolygon(lat: number, lng: number, polygon: L.LatLng[]): boolean {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;

      const crossesLatitude = yi > lat !== yj > lat;
      if (!crossesLatitude) {
        continue;
      }

      const slope = (xj - xi) * (lat - yi);
      const divisor = yj - yi;
      const xAtLat = slope / (divisor === 0 ? Number.EPSILON : divisor) + xi;

      if (lng < xAtLat) {
        inside = !inside;
      }
    }

    return inside;
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

  private resetLassoSelection(): void {
    if (!this.lassoSelection) {
      return;
    }

    if (this.map.hasLayer(this.lassoSelection.line)) {
      this.map.removeLayer(this.lassoSelection.line);
    }

    this.lassoSelection = undefined;
    this.map.dragging.enable();
    this.map.off("mousemove", this.onLassoMove);
    this.map.off("mouseup", this.onLassoEnd);
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

  private updateSpacePanClass(): void {
    this.map.getContainer().classList.toggle("is-space-pan", this.isSpacePressed);
  }
}
