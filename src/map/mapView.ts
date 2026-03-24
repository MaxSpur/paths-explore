import L from "leaflet";
import { getColormapById, sampleColormapColor } from "../colormaps";
import {
  findOdMetricDefinition,
  getAvailableOdMetricCatalog,
  getOdEdgeMetricValue,
  isOdEdgeBundle,
  type BundleOdMetricDefinition,
  type LoadedTrajectoryBundle
} from "../model/bundles";
import {
  computeTrackSegmentAccelerations,
  computeTrackSegmentVelocities,
  computeVelocityScaleInfo,
  normalizeVelocity,
  type SegmentColorScaleInfo
} from "./velocity";
import { BundleCanvasLayer } from "./bundleCanvasLayer";
import type {
  AnalysisSettings,
  EditInteractionMode,
  MapBaseStyle,
  MapViewSettings,
  PointCoordinateUpdate,
  SegmentColorMetric,
  Track,
  TrackPoint,
  VelocityViewSettings
} from "../model/types";

interface RenderOptions {
  bundles?: LoadedTrajectoryBundle[];
  editingTrackId?: string;
  selectedPointIds?: string[];
  editMode?: EditInteractionMode;
  fitToVisible?: boolean;
  fitToTrackIds?: string[];
  fitToBundleIds?: string[];
  analysisSettings?: AnalysisSettings;
  selectedOdEdge?: { bundleId: string; trajectoryId: string };
  velocitySettings?: VelocityViewSettings;
}

type PointSelectionSource = "point-click" | "peak-nav";

interface MapViewCallbacks {
  onPointSelected?: (
    trackId: string,
    pointId: string,
    additive: boolean,
    source: PointSelectionSource
  ) => void;
  onPointsMoved?: (trackId: string, updates: PointCoordinateUpdate[]) => void;
  onAreaSelected?: (trackId: string, pointIds: string[], additive: boolean) => void;
  onBundleTrajectorySelected?: (bundleId: string, trajectoryId: string) => void;
  onOdEdgeSelected?: (bundleId: string, trajectoryId: string) => void;
  onExtractSelectedOdEdge?: () => void;
  onMapBackgroundClick?: () => void;
  onCycleAnalysisColormap?: () => void;
}

interface DraggingPointContext {
  trackId: string;
  anchorStartLatLng: L.LatLng;
  polyline: L.Polyline;
  markerByPointId: Map<string, L.CircleMarker>;
  indexByPointId: Map<string, number>;
  pointIdByIndex: string[];
  segmentByStartIndex?: Map<number, L.Polyline>;
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

interface RankedMetricSegment {
  trackId: string;
  trackName: string;
  startIndex: number;
  endIndex: number;
  startPoint: Track["points"][number];
  endPoint: Track["points"][number];
  metric: SegmentColorMetric;
  metricLabel: string;
  baseValue: number;
  displayValue: number;
  unitLabel: string;
  distanceMeters?: number;
  durationSeconds?: number;
  latLngs: [L.LatLngTuple, L.LatLngTuple];
}

interface RankedOdEdge {
  bundleId: string;
  bundleName: string;
  trajectoryId: string;
  trajectoryName: string;
  weight: number;
  tripCount: number;
  durationMean?: number;
  metricValue: number;
  metricValues: Record<string, number>;
  properties?: Record<string, string | number | boolean | null>;
  latLngs: [L.LatLngTuple, L.LatLngTuple];
}

interface VelocityPolylineRenderResult {
  hiddenPolyline: L.Polyline;
  segmentByStartIndex: Map<number, L.Polyline>;
}

type LegendHistogramMode = "standard" | "precision" | "hidden";
type LegendHistogramAxisMode = "lin-lin" | "lin-log" | "log-lin" | "log-log";
export type UndoNavigationMode = "none" | "pan" | "teleport";
interface LegendResizeContext {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  wasMapDraggingEnabled: boolean;
}

const DEFAULT_LEGEND_WIDTH_PX = 248;
const DEFAULT_LEGEND_HEIGHT_PX = 200;
const MIN_LEGEND_WIDTH_PX = 248;
const MIN_LEGEND_HEIGHT_HISTOGRAM_PX = 238;
const HISTOGRAM_MIN_HEIGHT_REM = 3.35;
const HISTOGRAM_LOG_X_STRETCH = 45;
const DEFAULT_MAP_VIEW_SETTINGS: MapViewSettings = {
  baseStyle: "osm-standard",
  darkenPercent: 0,
  desaturatePercent: 0
};

interface BasemapStyleDefinition {
  urlTemplate: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
}

const BASEMAP_STYLES: Record<MapBaseStyle, BasemapStyleDefinition> = {
  "osm-standard": {
    urlTemplate: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    subdomains: "abc"
  },
  "carto-light": {
    urlTemplate: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd"
  },
  "carto-positron": {
    urlTemplate: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd"
  },
  "carto-positron-nolabels": {
    urlTemplate: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd"
  },
  "carto-dark": {
    urlTemplate: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd"
  },
  "carto-voyager": {
    urlTemplate: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd"
  }
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    target.isContentEditable
  );
}

export class MapView {
  private map: L.Map;
  private baseTileLayer?: L.TileLayer;
  private bundleCanvasLayer: BundleCanvasLayer;
  private layerGroup: L.LayerGroup;
  private velocityLegendElement?: HTMLDivElement;
  private spaceCursorElement: HTMLDivElement;
  private callbacks: MapViewCallbacks;
  private draggingPoint?: DraggingPointContext;
  private marqueeSelection?: MarqueeSelectionContext;
  private lassoSelection?: LassoSelectionContext;
  private latestTracks: Track[] = [];
  private latestBundles: LoadedTrajectoryBundle[] = [];
  private activeEditingTrackId?: string;
  private activeEditMode: EditInteractionMode = "move";
  private suppressNextMapClick = false;
  private isSpacePressed = false;
  private isPointerInsideMap = false;
  private isPointerOverLegend = false;
  private isHoveringEditablePoint = false;
  private pointerX = 0;
  private pointerY = 0;
  private rankedMetricSegments: RankedMetricSegment[] = [];
  private rankedMetricCursor = -1;
  private activeInfoPopup?: L.Popup;
  private preserveInfoPopupOnNextRender = false;
  private legendHistogramMode: LegendHistogramMode = "standard";
  private legendHistogramAxisMode: LegendHistogramAxisMode = "lin-lin";
  private lastLegendEnabled = false;
  private lastAnalysisSettings?: AnalysisSettings;
  private lastVelocitySettings?: VelocityViewSettings;
  private lastLegendColormap?: LegendColormap;
  private lastLegendScaleInfo?: SegmentColorScaleInfo;
  private rankedOdEdges: RankedOdEdge[] = [];
  private rankedOdCursor = -1;
  private selectedOdEdge?: { bundleId: string; trajectoryId: string };
  private legendResize?: LegendResizeContext;
  private legendWidthPx = DEFAULT_LEGEND_WIDTH_PX;
  private legendHeightPx = DEFAULT_LEGEND_HEIGHT_PX;
  private legendHasCustomSize = false;
  private legendVisibleModeWidthPx = DEFAULT_LEGEND_WIDTH_PX;
  private legendVisibleModeHeightPx = DEFAULT_LEGEND_HEIGHT_PX;
  private legendVisibleModeWasCustom = false;
  private mapViewSettings: MapViewSettings = { ...DEFAULT_MAP_VIEW_SETTINGS };

  constructor(container: HTMLElement, callbacks: MapViewCallbacks) {
    this.callbacks = callbacks;
    this.map = L.map(container, {
      zoomControl: true,
      preferCanvas: true,
      boxZoom: false
    }).setView([39.8283, -98.5795], 4);

    this.setBaseMapStyle(this.mapViewSettings.baseStyle);
    this.applyBaseMapFilter(this.mapViewSettings);

    const bundlePane = this.map.createPane("bundlePane");
    bundlePane.style.zIndex = "360";
    this.bundleCanvasLayer = new BundleCanvasLayer();
    this.bundleCanvasLayer.addTo(this.map);
    this.layerGroup = L.layerGroup().addTo(this.map);
    this.spaceCursorElement = L.DomUtil.create(
      "div",
      "map-space-cursor is-hidden",
      this.map.getContainer()
    ) as HTMLDivElement;
    const velocityLegendControl = L.control({ position: "bottomright" });
    velocityLegendControl.onAdd = () => {
      const legend = L.DomUtil.create("div", "velocity-legend is-hidden") as HTMLDivElement;
      L.DomEvent.disableClickPropagation(legend);
      L.DomEvent.disableScrollPropagation(legend);
      legend.addEventListener("click", this.onLegendClick);
      legend.addEventListener("pointerdown", this.onLegendPointerDown);
      legend.addEventListener("mouseenter", this.onLegendMouseEnter);
      legend.addEventListener("mouseleave", this.onLegendMouseLeave);
      this.velocityLegendElement = legend;
      return legend;
    };
    velocityLegendControl.addTo(this.map);

    this.map.on("click", (event: L.LeafletMouseEvent) => {
      if (this.suppressNextMapClick) {
        this.suppressNextMapClick = false;
        return;
      }

      if (this.isSpacePressed) {
        return;
      }

      if (!this.activeEditingTrackId && this.lastAnalysisSettings?.mode === "od") {
        const odSelection = this.bundleCanvasLayer.findNearestTrajectory(event.latlng, "od-edge");
        if (odSelection) {
          this.clearInfoPopup();
          this.callbacks.onOdEdgeSelected?.(odSelection.bundleId, odSelection.trajectoryId);
          return;
        }
      }

      if (this.lastAnalysisSettings?.mode !== "od") {
        const bundleSelection = this.bundleCanvasLayer.findNearestTrajectory(event.latlng, "path");
        if (bundleSelection) {
          this.clearInfoPopup();
          this.callbacks.onBundleTrajectorySelected?.(
            bundleSelection.bundleId,
            bundleSelection.trajectoryId
          );
          return;
        }
      }

      this.clearInfoPopup();
      this.callbacks.onMapBackgroundClick?.();
    });
    this.map.on("popupclose", this.onPopupClose);

    this.map.on("mousedown", this.onMapMouseDown);
    this.map.getContainer().addEventListener("mouseenter", this.onMapMouseEnter);
    this.map.getContainer().addEventListener("mousemove", this.onMapMouseMove);
    this.map.getContainer().addEventListener("mouseleave", this.onMapMouseLeave);
    document.addEventListener("keydown", this.onWindowKeyDown, true);
    document.addEventListener("keyup", this.onWindowKeyUp, true);
    window.addEventListener("blur", this.onWindowBlur);

    window.setTimeout(() => {
      this.map.invalidateSize();
    }, 0);
  }

  setMapViewSettings(settings: MapViewSettings): void {
    const normalized: MapViewSettings = {
      baseStyle: settings.baseStyle in BASEMAP_STYLES ? settings.baseStyle : DEFAULT_MAP_VIEW_SETTINGS.baseStyle,
      darkenPercent: clampPercent(settings.darkenPercent),
      desaturatePercent: clampPercent(settings.desaturatePercent)
    };

    const baseStyleChanged = normalized.baseStyle !== this.mapViewSettings.baseStyle;
    this.mapViewSettings = normalized;

    if (baseStyleChanged) {
      this.setBaseMapStyle(normalized.baseStyle);
    }

    this.applyBaseMapFilter(normalized);
  }

  renderTracks(tracks: Track[], options: RenderOptions = {}): void {
    this.latestTracks = tracks;
    this.latestBundles = options.bundles ?? [];
    this.activeEditingTrackId = options.editingTrackId;
    this.activeEditMode = options.editMode ?? "move";
    this.lastAnalysisSettings = options.analysisSettings;
    this.selectedOdEdge = options.selectedOdEdge;
    this.isHoveringEditablePoint = false;
    if (this.preserveInfoPopupOnNextRender) {
      this.preserveInfoPopupOnNextRender = false;
    } else {
      this.clearInfoPopup();
    }
    this.resetDragState();
    this.resetMarqueeSelection();
    this.resetLassoSelection();
    this.layerGroup.clearLayers();
    this.bundleCanvasLayer.setBundles(this.latestBundles);
    const analysisSettings = options.analysisSettings;
    const activeColormap = analysisSettings ? getColormapById(analysisSettings.colormapId) : undefined;
    this.bundleCanvasLayer.setAnalysisContext({
      mode: analysisSettings?.mode ?? "off",
      colormapColors: activeColormap?.colors ?? [],
      odColorMetricKey: analysisSettings?.odColorMetricKey ?? "weight",
      odDrawOrderMetricKey: analysisSettings?.odDrawOrderMetricKey ?? "weight",
      selectedOdEdge: options.selectedOdEdge
    });

    const selectedPointIdSet = new Set(options.selectedPointIds ?? []);
    const velocitySettings = options.velocitySettings;
    const renderVelocity = velocitySettings?.enabled ?? false;
    const colormap = velocitySettings ? activeColormap : undefined;
    const velocityScaleTracks =
      velocitySettings?.scaleMode === "auto" ? tracks.filter((track) => track.visible) : tracks;
    const velocityScaleInfo =
      renderVelocity && velocitySettings
        ? computeVelocityScaleInfo(velocityScaleTracks, velocitySettings)
        : undefined;
    const rankedSegments: RankedMetricSegment[] = [];

    // Draw bottom-to-top so the first track in the sidebar list appears on top.
    for (const track of [...tracks].reverse()) {
      if (!track.visible || track.points.length === 0) {
        continue;
      }

      const lineCoords: L.LatLngExpression[] = track.points.map((point) => [point.lat, point.lng]);
      const showSegments = track.showSegments ?? true;
      let segmentByStartIndex: Map<number, L.Polyline> | undefined;
      const polyline = showSegments
        ? renderVelocity
          ? (() => {
              const velocityRender = this.renderVelocityTrackPolyline(
                track,
                lineCoords,
                velocitySettings?.metric ?? "velocity",
                colormap?.colors ?? [],
                velocityScaleInfo,
                rankedSegments
              );
              segmentByStartIndex = velocityRender.segmentByStartIndex;
              return velocityRender.hiddenPolyline;
            })()
          : L.polyline(lineCoords, {
              color: track.color,
              weight: 4,
              opacity: 0.95
            })
        : L.polyline(lineCoords, {
            color: track.color,
            weight: 0,
            opacity: 0,
            interactive: false
          });

      if (showSegments) {
        this.layerGroup.addLayer(polyline);
      }

      const showPoints = track.showPoints || track.id === options.editingTrackId;
      if (!showPoints) {
        continue;
      }

      const useMinimalEditingMarkers =
        renderVelocity && track.id === options.editingTrackId && showSegments;

      const markerByPointId = new Map<string, L.CircleMarker>();
      const indexByPointId = new Map<string, number>();
      const selectedInTrack = track.points
        .filter((point) => selectedPointIdSet.has(point.id))
        .map((point) => point.id);

      track.points.forEach((point, pointIndex) => {
        const isSelected = selectedPointIdSet.has(point.id);
        const marker = L.circleMarker([point.lat, point.lng], {
          radius: useMinimalEditingMarkers ? (isSelected ? 5 : 2.2) : isSelected ? 6 : 4,
          weight: useMinimalEditingMarkers ? (isSelected ? 2.4 : 1.2) : isSelected ? 3 : 2,
          color: useMinimalEditingMarkers
            ? isSelected
              ? "#0d0d0d"
              : "rgba(17, 17, 17, 0.68)"
            : isSelected
              ? "#111111"
              : "#ffffff",
          fillColor: useMinimalEditingMarkers ? "#ffffff" : track.color,
          fillOpacity: useMinimalEditingMarkers ? (isSelected ? 0.82 : 0) : 1,
          interactive: this.activeEditMode !== "info"
        });

        markerByPointId.set(point.id, marker);
        indexByPointId.set(point.id, pointIndex);

        marker.on("click", (event) => {
          if (this.activeEditMode === "info") {
            return;
          }

          if (this.isSpacePressed) {
            return;
          }

          L.DomEvent.stopPropagation(event);
          const originalEvent = event.originalEvent;
          const additive = originalEvent instanceof MouseEvent ? originalEvent.shiftKey : false;
          this.callbacks.onPointSelected?.(track.id, point.id, additive, "point-click");
        });

        if (track.id === options.editingTrackId && this.activeEditMode === "move") {
          marker.on("mouseover", () => {
            this.isHoveringEditablePoint = true;
            this.updateCursorClass();
          });

          marker.on("mouseout", () => {
            this.isHoveringEditablePoint = false;
            this.updateCursorClass();
          });

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
              pointIdByIndex: track.points.map((trackPoint) => trackPoint.id),
              segmentByStartIndex,
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

    if (
      options.fitToTrackIds &&
      options.fitToTrackIds.length > 0 &&
      options.fitToBundleIds &&
      options.fitToBundleIds.length > 0
    ) {
      this.fitTracksAndBundlesByIds(tracks, options.fitToTrackIds, this.latestBundles, options.fitToBundleIds);
    } else if (options.fitToTrackIds && options.fitToTrackIds.length > 0) {
      this.fitTracksByIds(tracks, options.fitToTrackIds);
    } else if (options.fitToBundleIds && options.fitToBundleIds.length > 0) {
      this.fitBundlesByIds(this.latestBundles, options.fitToBundleIds);
    } else if (options.fitToVisible) {
      this.fitVisibleContent(tracks, this.latestBundles);
    }

    this.setRankedMetricSegments(rankedSegments);
    this.setRankedOdEdges(
      this.collectRankedOdEdges(analysisSettings?.odColorMetricKey ?? "weight"),
      options.selectedOdEdge
    );
    this.updateAnalysisLegend(
      analysisSettings ?? {
        mode: "off",
        colormapId: "",
        velocityScaleMode: "auto",
        velocityFixedMax: 0,
        odColorMetricKey: "weight",
        odDrawOrderMetricKey: "weight"
      },
      velocitySettings,
      colormap,
      velocityScaleInfo
    );
    this.updateCursorClass();
  }

  focusTrack(trackId: string, tracks: Track[]): void {
    const track = tracks.find((candidate) => candidate.id === trackId);

    if (!track || track.points.length === 0) {
      return;
    }

    this.fitBoundsForPoints(
      track.points.map((point) => [point.lat, point.lng] as L.LatLngTuple),
      0.2
    );
  }

  focusBundle(bundleId: string): void {
    const bounds = this.bundleCanvasLayer.getBoundsForBundle(bundleId);
    if (!bounds || !bounds.isValid()) {
      return;
    }

    this.map.fitBounds(bounds.pad(0.15));
  }

  fitVisibleTracks(tracks: Track[]): void {
    const visibleTracks = tracks.filter((track) => track.visible && track.points.length > 0);

    if (visibleTracks.length === 0) {
      return;
    }

    this.fitBoundsForPoints(
      visibleTracks.flatMap((track) =>
        track.points.map((point) => [point.lat, point.lng] as L.LatLngTuple)
      ),
      0.15
    );
  }

  fitVisibleContent(tracks: Track[], bundles: LoadedTrajectoryBundle[]): void {
    const visibleTrackPoints = tracks
      .filter((track) => track.visible && track.points.length > 0)
      .flatMap((track) => track.points.map((point) => [point.lat, point.lng] as L.LatLngTuple));

    const bundleBounds = this.bundleCanvasLayer.getBoundsForVisibleBundles();
    if (visibleTrackPoints.length === 0 && !bundleBounds) {
      return;
    }

    if (visibleTrackPoints.length > 0) {
      const pointBounds = L.latLngBounds(visibleTrackPoints);
      if (bundleBounds) {
        pointBounds.extend(bundleBounds);
      }
      this.map.fitBounds(pointBounds.pad(0.15));
      return;
    }

    this.map.fitBounds(bundleBounds!.pad(0.15));
  }

  fitTracksByIds(tracks: Track[], trackIds: string[]): void {
    const targetIdSet = new Set(trackIds);
    const matchingVisibleTracks = tracks.filter(
      (track) => targetIdSet.has(track.id) && track.visible && track.points.length > 0
    );
    const matchingTracks =
      matchingVisibleTracks.length > 0
        ? matchingVisibleTracks
        : tracks.filter((track) => targetIdSet.has(track.id) && track.points.length > 0);

    if (matchingTracks.length === 0) {
      return;
    }

    this.fitBoundsForPoints(
      matchingTracks.flatMap((track) =>
        track.points.map((point) => [point.lat, point.lng] as L.LatLngTuple)
      ),
      0.15
    );
  }

  fitBundlesByIds(bundles: LoadedTrajectoryBundle[], bundleIds: string[]): void {
    const targetIds = new Set(bundleIds);
    let mergedBounds: L.LatLngBounds | null = null;

    for (const bundle of bundles) {
      if (!targetIds.has(bundle.id)) {
        continue;
      }

      const bounds = this.bundleCanvasLayer.getBoundsForBundle(bundle.id);
      if (!bounds) {
        continue;
      }

      mergedBounds = mergedBounds ? mergedBounds.extend(bounds) : bounds;
    }

    if (!mergedBounds || !mergedBounds.isValid()) {
      return;
    }

    this.map.fitBounds(mergedBounds.pad(0.15));
  }

  fitTracksAndBundlesByIds(
    tracks: Track[],
    trackIds: string[],
    bundles: LoadedTrajectoryBundle[],
    bundleIds: string[]
  ): void {
    const trackIdSet = new Set(trackIds);
    const trackPoints = tracks
      .filter((track) => trackIdSet.has(track.id) && track.points.length > 0)
      .flatMap((track) => track.points.map((point) => [point.lat, point.lng] as L.LatLngTuple));

    let mergedBounds = trackPoints.length > 0 ? L.latLngBounds(trackPoints) : null;

    for (const bundleId of bundleIds) {
      const bundleBounds = this.bundleCanvasLayer.getBoundsForBundle(bundleId);
      if (!bundleBounds) {
        continue;
      }

      mergedBounds = mergedBounds ? mergedBounds.extend(bundleBounds) : bundleBounds;
    }

    if (!mergedBounds || !mergedBounds.isValid()) {
      return;
    }

    this.map.fitBounds(mergedBounds.pad(0.15));
  }

  private fitBoundsForPoints(points: L.LatLngTuple[], pad: number): void {
    if (points.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(points);
    if (!bounds.isValid()) {
      return;
    }

    this.map.fitBounds(bounds.pad(pad));
  }

  async focusPointsIfOutsideView(
    points: Array<Pick<TrackPoint, "lat" | "lng">>
  ): Promise<UndoNavigationMode> {
    if (points.length === 0) {
      return "none";
    }

    const validPoints = points.filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
    );
    if (validPoints.length === 0) {
      return "none";
    }

    const currentBounds = this.map.getBounds();
    const anyPointAlreadyVisible = validPoints.some((point) =>
      currentBounds.contains([point.lat, point.lng])
    );
    if (anyPointAlreadyVisible) {
      return "none";
    }

    const bounds = L.latLngBounds(validPoints.map((point) => [point.lat, point.lng] as L.LatLngTuple));
    if (!bounds.isValid()) {
      return "none";
    }

    const targetBounds = bounds.pad(0.8);
    const fitOptions: L.FitBoundsOptions = { maxZoom: 16 };
    const navigationMode = this.classifyUndoNavigationMode(targetBounds, fitOptions);
    await this.fitBoundsAndWait(targetBounds, fitOptions);
    return navigationMode;
  }

  private classifyUndoNavigationMode(
    targetBounds: L.LatLngBounds,
    options?: L.FitBoundsOptions
  ): Exclude<UndoNavigationMode, "none"> {
    const currentCenter = this.map.getCenter();
    const targetCenter = targetBounds.getCenter();
    const distanceMeters = currentCenter.distanceTo(targetCenter);

    const currentZoom = this.map.getZoom();
    let targetZoom = this.map.getBoundsZoom(targetBounds, false);

    if (options?.maxZoom !== undefined) {
      targetZoom = Math.min(targetZoom, options.maxZoom);
    }
    if (options?.minZoom !== undefined) {
      targetZoom = Math.max(targetZoom, options.minZoom);
    }

    const zoomDelta = Math.abs(targetZoom - currentZoom);

    if (distanceMeters >= 25_000 || zoomDelta >= 3) {
      return "teleport";
    }

    return "pan";
  }

  private fitBoundsAndWait(bounds: L.LatLngBounds, options?: L.FitBoundsOptions): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const timeout = window.setTimeout(() => {
        if (resolved) {
          return;
        }

        resolved = true;
        this.map.off("moveend", onMoveEnd);
        resolve();
      }, 600);

      const onMoveEnd = (): void => {
        if (resolved) {
          return;
        }

        resolved = true;
        window.clearTimeout(timeout);
        resolve();
      };

      this.map.once("moveend", onMoveEnd);
      this.map.fitBounds(bounds, options);
    });
  }

  private setBaseMapStyle(style: MapBaseStyle): void {
    if (this.baseTileLayer) {
      this.baseTileLayer.remove();
      this.baseTileLayer = undefined;
    }

    const definition = BASEMAP_STYLES[style] ?? BASEMAP_STYLES[DEFAULT_MAP_VIEW_SETTINGS.baseStyle];
    const options: L.TileLayerOptions = {
      maxZoom: definition.maxZoom,
      attribution: definition.attribution
    };
    if (definition.subdomains) {
      options.subdomains = definition.subdomains;
    }

    this.baseTileLayer = L.tileLayer(definition.urlTemplate, options);
    this.baseTileLayer.addTo(this.map);
  }

  private applyBaseMapFilter(settings: MapViewSettings): void {
    const tilePane = this.map.getPane("tilePane");
    if (!tilePane) {
      return;
    }

    const brightness = Math.max(0, (100 - settings.darkenPercent) / 100);
    const saturation = Math.max(0, (100 - settings.desaturatePercent) / 100);
    const isDefault = settings.darkenPercent === 0 && settings.desaturatePercent === 0;

    tilePane.style.filter = isDefault
      ? ""
      : `saturate(${saturation.toFixed(3)}) brightness(${brightness.toFixed(3)})`;
  }

  private renderVelocityTrackPolyline(
    track: Track,
    lineCoords: L.LatLngExpression[],
    metric: SegmentColorMetric,
    colormapColors: { r: number; g: number; b: number }[],
    velocityScaleInfo: SegmentColorScaleInfo | undefined,
    rankedSegments: RankedMetricSegment[]
  ): VelocityPolylineRenderResult {
    const hiddenPolyline = L.polyline(lineCoords, {
      color: "#000000",
      weight: 0,
      opacity: 0,
      interactive: false
    });
    const segmentByStartIndex = new Map<number, L.Polyline>();

    const velocitySegments = computeTrackSegmentVelocities(track);
    const velocitySegmentsByStart = new Map(
      velocitySegments.map((segment) => [segment.startIndex, segment])
    );
    const metricValuesByStart =
      metric === "acceleration"
        ? new Map(
            computeTrackSegmentAccelerations(track).map((segment) => [
              segment.startIndex,
              segment.metersPerSecondSquared
            ])
          )
        : new Map(velocitySegments.map((segment) => [segment.startIndex, segment.metersPerSecond]));
    const metricLabel = metric === "acceleration" ? "Acceleration" : "Velocity";
    const unitLabel = metric === "acceleration" ? "m/s²" : "km/h";
    const enableSegmentInfoClick = this.activeEditMode === "info";

    for (let idx = 0; idx < track.points.length - 1; idx += 1) {
      const start = track.points[idx];
      const end = track.points[idx + 1];
      const metricValue = metricValuesByStart.get(idx);
      const velocitySegment = velocitySegmentsByStart.get(idx);

      const hasVelocity =
        metricValue !== undefined &&
        velocityScaleInfo !== undefined &&
        velocityScaleInfo.maxBaseValue > 0;

      const normalizedVelocity =
        hasVelocity && metricValue !== undefined && velocityScaleInfo
          ? normalizeVelocity(metricValue, velocityScaleInfo)
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
          interactive: enableSegmentInfoClick && metricValue !== undefined,
          lineCap: "round",
          lineJoin: "round"
        }
      );
      segmentByStartIndex.set(idx, segment);

      if (metricValue !== undefined) {
        const displayValue =
          metric === "acceleration" ? metricValue : metricValue * 3.6;
        const segmentInfo: RankedMetricSegment = {
          trackId: track.id,
          trackName: track.name,
          startIndex: idx,
          endIndex: idx + 1,
          startPoint: start,
          endPoint: end,
          metric,
          metricLabel,
          baseValue: metricValue,
          displayValue,
          unitLabel,
          distanceMeters: velocitySegment
            ? velocitySegment.metersPerSecond * velocitySegment.deltaSeconds
            : undefined,
          durationSeconds: velocitySegment?.deltaSeconds,
          latLngs: [
            [start.lat, start.lng],
            [end.lat, end.lng]
          ]
        };
        rankedSegments.push(segmentInfo);

        if (enableSegmentInfoClick) {
          segment.on("click", (event: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(event);
            this.openSegmentInfoPopup(segmentInfo);
          });
        }
      }

      this.layerGroup.addLayer(segment);
    }

    return {
      hiddenPolyline,
      segmentByStartIndex
    };
  }

  private updateAnalysisLegend(
    analysisSettings: AnalysisSettings,
    velocitySettings: VelocityViewSettings | undefined,
    colormap: LegendColormap | undefined,
    velocityScaleInfo: SegmentColorScaleInfo | undefined
  ): void {
    this.lastLegendEnabled = analysisSettings.mode !== "off";
    this.lastAnalysisSettings = analysisSettings;
    this.lastVelocitySettings = velocitySettings;
    this.lastLegendColormap = colormap;
    this.lastLegendScaleInfo = velocityScaleInfo;

    if (!this.velocityLegendElement) {
      return;
    }

    if (analysisSettings.mode === "off" || !colormap) {
      this.hideAnalysisLegend();
      return;
    }

    if (analysisSettings.mode === "od") {
      this.renderOdAnalysisLegend(analysisSettings, colormap);
      return;
    }

    this.renderTrackMetricAnalysisLegend(analysisSettings, velocitySettings, colormap, velocityScaleInfo);
  }

  private hideAnalysisLegend(): void {
    if (!this.velocityLegendElement) {
      return;
    }

    if (this.legendResize) {
      this.onLegendPointerUp(undefined, false);
    }

    this.velocityLegendElement.classList.add("is-hidden");
    this.velocityLegendElement.innerHTML = "";
    this.rankedMetricCursor = -1;
    this.rankedOdCursor = -1;
  }

  private renderTrackMetricAnalysisLegend(
    analysisSettings: AnalysisSettings,
    settings: VelocityViewSettings | undefined,
    colormap: LegendColormap,
    velocityScaleInfo: SegmentColorScaleInfo | undefined
  ): void {
    if (!this.velocityLegendElement || !settings) {
      this.hideAnalysisLegend();
      return;
    }

    const maxDisplayValue = velocityScaleInfo ? Math.max(0, velocityScaleInfo.maxDisplayValue) : 0;
    const unitLabel = velocityScaleInfo?.unitLabel ?? "";
    const metricLabel = velocityScaleInfo?.metricLabel ?? "Velocity";
    const gradient = this.buildLegendGradient(colormap.colors);
    const normalizedValues =
      velocityScaleInfo && velocityScaleInfo.maxBaseValue > 0
        ? this.rankedMetricSegments.map((segment) => normalizeVelocity(segment.baseValue, velocityScaleInfo))
        : [];
    const histogramMarkup = this.buildLegendHistogramMarkup(colormap.colors, normalizedValues);
    const axisModeControlMarkup = this.buildLegendAxisModeControlMarkup();
    const resizeEnabled = this.legendHistogramMode !== "hidden";
    const resizeHandleMarkup = resizeEnabled
      ? `
      <button
        type="button"
        data-action="resize-legend"
        class="velocity-legend-resize-handle"
        title="Drag top-left corner to resize panel"
        aria-label="Resize panel"
      ></button>
    `
      : "";
    const scaleLabel =
      settings.scaleMode === "fixed"
        ? `Fixed scale (max ${Math.max(0, Math.round(settings.fixedMax * 10) / 10)} ${unitLabel})`
        : "Auto scale (across visible tracks)";
    const availability =
      maxDisplayValue <= 0
        ? "No timed segments available."
        : `Current max: ${Math.round(maxDisplayValue * 10) / 10} ${unitLabel}`;
    const activeSegments = this.getActiveRankedMetricSegments();
    if (this.rankedMetricCursor >= activeSegments.length) {
      this.rankedMetricCursor = -1;
    }
    const currentRank = this.rankedMetricCursor >= 0 ? this.rankedMetricCursor + 1 : 0;
    const totalRanks = activeSegments.length;
    const actionPrimaryLabel = analysisSettings.mode === "acceleration" ? "Top Peak" : "Top Peak";
    const actionSecondaryLabel = analysisSettings.mode === "acceleration" ? "Next Peak" : "Next Peak";

    this.velocityLegendElement.classList.remove("is-hidden");
    this.velocityLegendElement.innerHTML = `
      ${resizeHandleMarkup}
      <div class="velocity-legend-header">
        <div class="velocity-legend-title">${metricLabel}</div>
        ${axisModeControlMarkup}
      </div>
      ${histogramMarkup}
      <button
        type="button"
        data-action="cycle-legend-colormap"
        class="velocity-legend-bar velocity-legend-colormap-btn"
        style="--legend-gradient: ${gradient};"
        title="Colormap: ${this.escapeHtml(colormap.name)}. Click to cycle."
        aria-label="Colormap: ${this.escapeHtml(colormap.name)}. Click to cycle."
      ></button>
      <div class="velocity-legend-scale"><span>0 ${unitLabel}</span><span>${
        Math.round(maxDisplayValue * 10) / 10
      } ${unitLabel}</span></div>
      <div class="velocity-legend-note">${scaleLabel}</div>
      <div class="velocity-legend-note">${availability}</div>
      <div class="velocity-legend-actions">
        <span class="velocity-legend-cycle-controls">
          <button
            type="button"
            data-action="reset-analysis-focus"
            class="velocity-legend-cycle-btn"
            ${totalRanks === 0 ? "disabled" : ""}
          >
            ${actionPrimaryLabel}
          </button>
          <button
            type="button"
            data-action="cycle-analysis-focus"
            class="velocity-legend-cycle-btn"
            ${totalRanks === 0 ? "disabled" : ""}
          >
            ${actionSecondaryLabel}
          </button>
        </span>
        <span class="velocity-legend-cycle-status">${currentRank}/${totalRanks}</span>
      </div>
    `;
    this.velocityLegendElement.classList.toggle("is-resize-enabled", resizeEnabled);
    this.applyLegendSizeStyles();
    this.velocityLegendElement.classList.toggle("is-resizing", Boolean(this.legendResize));
  }

  private renderOdAnalysisLegend(
    analysisSettings: AnalysisSettings,
    colormap: LegendColormap
  ): void {
    if (!this.velocityLegendElement) {
      return;
    }

    const activeEdges = this.rankedOdEdges;
    if (this.rankedOdCursor >= activeEdges.length) {
      this.rankedOdCursor = -1;
    }

    const metricKey = analysisSettings.odColorMetricKey;
    const metricDefinition = this.getOdMetricDefinition(metricKey);
    const drawOrderDefinition = this.getOdMetricDefinition(analysisSettings.odDrawOrderMetricKey);
    const metricLabel = metricDefinition?.label ?? this.getOdMetricLabel(metricKey);
    const scaleMax = activeEdges.reduce((maxValue, edge) => Math.max(maxValue, edge.metricValue), 0);
    const histogramMarkup = this.buildLegendHistogramMarkup(
      colormap.colors,
      scaleMax > 0 ? activeEdges.map((edge) => edge.metricValue / scaleMax) : []
    );
    const axisModeControlMarkup = this.buildLegendAxisModeControlMarkup();
    const gradient = this.buildLegendGradient(colormap.colors);
    const resizeEnabled = this.legendHistogramMode !== "hidden";
    const resizeHandleMarkup = resizeEnabled
      ? `
      <button
        type="button"
        data-action="resize-legend"
        class="velocity-legend-resize-handle"
        title="Drag top-left corner to resize panel"
        aria-label="Resize panel"
      ></button>
    `
      : "";
    const selectedEdge = this.getCurrentRankedOdEdge();
    const currentRank = this.rankedOdCursor >= 0 ? this.rankedOdCursor + 1 : 0;
    const totalRanks = activeEdges.length;
    const selectedName = selectedEdge ? this.escapeHtml(selectedEdge.trajectoryName) : "No OD flow selected.";
    const primaryValue = selectedEdge
      ? `${metricLabel}: <strong>${this.formatOdMetricValue(
          selectedEdge.metricValue,
          metricDefinition
        )}</strong>`
      : `${metricLabel}: <strong>n/a</strong>`;
    const weightDefinition = this.getOdMetricDefinition("weight");
    const tripCountDefinition = this.getOdMetricDefinition("tripCount");
    const durationDefinition = this.getOdMetricDefinition("durationMean");
    const weightValue = selectedEdge
      ? `Weight: ${this.formatOdMetricValue(selectedEdge.weight, weightDefinition)}`
      : "Weight: n/a";
    const tripCountValue = selectedEdge
      ? `Trip Count: ${this.formatOdMetricValue(selectedEdge.tripCount, tripCountDefinition)}`
      : "Trip Count: n/a";
    const durationValue =
      selectedEdge && typeof selectedEdge.durationMean === "number"
        ? `Mean Duration: ${this.formatOdMetricValue(selectedEdge.durationMean, durationDefinition)}${durationDefinition?.unitLabel ? ` ${durationDefinition.unitLabel}` : ""}`
        : "Mean Duration: n/a";
    const dominantSummaries = selectedEdge
      ? [
          this.getDominantOdMetricSummary(selectedEdge, "type_od"),
          this.getDominantOdMetricSummary(selectedEdge, "mode_principal"),
          this.getDominantOdMetricSummary(selectedEdge, "motif_o"),
          this.getDominantOdMetricSummary(selectedEdge, "motif_d")
        ].filter((value): value is string => Boolean(value))
      : [];
    const availability =
      scaleMax <= 0
        ? "No visible OD flows with usable metrics."
        : `Current max: ${this.formatOdMetricValue(scaleMax, metricDefinition)}`;
    const drawOrderNote = drawOrderDefinition
      ? `Draw on top by: ${drawOrderDefinition.label}.`
      : "Draw on top by current OD metric.";

    this.velocityLegendElement.classList.remove("is-hidden");
    this.velocityLegendElement.innerHTML = `
      ${resizeHandleMarkup}
      <div class="velocity-legend-header">
        <div class="velocity-legend-title">${metricLabel}</div>
        ${axisModeControlMarkup}
      </div>
      ${histogramMarkup}
      <button
        type="button"
        data-action="cycle-legend-colormap"
        class="velocity-legend-bar velocity-legend-colormap-btn"
        style="--legend-gradient: ${gradient};"
        title="Colormap: ${this.escapeHtml(colormap.name)}. Click to cycle."
        aria-label="Colormap: ${this.escapeHtml(colormap.name)}. Click to cycle."
      ></button>
      <div class="velocity-legend-scale"><span>0</span><span>${this.formatOdMetricValue(
        scaleMax,
        metricDefinition
      )}</span></div>
      <div class="velocity-legend-note">Auto scale across visible OD flows.</div>
      <div class="velocity-legend-note">${drawOrderNote}</div>
      <div class="velocity-legend-note">${availability}</div>
      <div class="velocity-legend-note"><strong>${selectedName}</strong></div>
      <div class="velocity-legend-note">${primaryValue}</div>
      <div class="velocity-legend-note">${weightValue}</div>
      <div class="velocity-legend-note">${tripCountValue}</div>
      <div class="velocity-legend-note">${durationValue}</div>
      ${dominantSummaries
        .map((summary) => `<div class="velocity-legend-note">${this.escapeHtml(summary)}</div>`)
        .join("")}
      <div class="velocity-legend-actions">
        <span class="velocity-legend-cycle-controls">
          <button
            type="button"
            data-action="reset-analysis-focus"
            class="velocity-legend-cycle-btn"
            ${totalRanks === 0 ? "disabled" : ""}
          >
            Top Flow
          </button>
          <button
            type="button"
            data-action="cycle-analysis-focus"
            class="velocity-legend-cycle-btn"
            ${totalRanks === 0 ? "disabled" : ""}
          >
            Next Flow
          </button>
          <button
            type="button"
            data-action="extract-selected-od"
            class="velocity-legend-cycle-btn"
            ${selectedEdge ? "" : "disabled"}
          >
            Extract Selected
          </button>
        </span>
        <span class="velocity-legend-cycle-status">${currentRank}/${totalRanks}</span>
      </div>
    `;
    this.velocityLegendElement.classList.toggle("is-resize-enabled", resizeEnabled);
    this.applyLegendSizeStyles();
    this.velocityLegendElement.classList.toggle("is-resizing", Boolean(this.legendResize));
  }

  private buildLegendAxisModeControlMarkup(): string {
    if (this.legendHistogramMode === "hidden") {
      return "";
    }

    const options: { mode: LegendHistogramAxisMode; shortLabel: string; title: string }[] = [
      { mode: "lin-lin", shortLabel: "L/L", title: "X linear, Y linear" },
      { mode: "lin-log", shortLabel: "L/G", title: "X linear, Y logarithmic" },
      { mode: "log-lin", shortLabel: "G/L", title: "X logarithmic, Y linear" },
      { mode: "log-log", shortLabel: "G/G", title: "X logarithmic, Y logarithmic" }
    ];

    const buttons = options
      .map(
        ({ mode, shortLabel, title }) => `
          <button
            type="button"
            data-action="set-legend-axis-mode"
            data-axis-mode="${mode}"
            class="velocity-legend-axis-btn${this.legendHistogramAxisMode === mode ? " is-active" : ""}"
            title="${title}"
            aria-label="${title}"
            aria-pressed="${this.legendHistogramAxisMode === mode ? "true" : "false"}"
          >
            ${shortLabel}
          </button>
        `
      )
      .join("");

    return `
      <div class="velocity-legend-axis-toggle" role="group" aria-label="Histogram axis scaling">
        <span class="velocity-legend-axis-caption">Axes</span>
        <span class="velocity-legend-axis-row">
          ${buttons}
        </span>
      </div>
    `;
  }

  private getIsLegendLogX(): boolean {
    return this.legendHistogramAxisMode === "log-lin" || this.legendHistogramAxisMode === "log-log";
  }

  private getIsLegendLogY(): boolean {
    return this.legendHistogramAxisMode === "lin-log" || this.legendHistogramAxisMode === "log-log";
  }

  private transformHistogramX(value: number): number {
    const clamped = Math.max(0, Math.min(1, value));
    if (!this.getIsLegendLogX()) {
      return clamped;
    }

    return Math.log1p(HISTOGRAM_LOG_X_STRETCH * clamped) / Math.log1p(HISTOGRAM_LOG_X_STRETCH);
  }

  private inverseTransformHistogramX(value: number): number {
    const clamped = Math.max(0, Math.min(1, value));
    if (!this.getIsLegendLogX()) {
      return clamped;
    }

    return (
      Math.exp(clamped * Math.log1p(HISTOGRAM_LOG_X_STRETCH)) - 1
    ) / HISTOGRAM_LOG_X_STRETCH;
  }

  private normalizeHistogramY(count: number, peakCount: number): number {
    if (peakCount <= 0 || count <= 0) {
      return 0;
    }

    if (!this.getIsLegendLogY()) {
      return count / peakCount;
    }

    return Math.log1p(count) / Math.log1p(peakCount);
  }

  private buildLegendHistogramMarkup(
    colormapColors: { r: number; g: number; b: number }[],
    normalizedValues: number[]
  ): string {
    const isPrecisionMode = this.legendHistogramMode === "precision";
    const binCount = this.getHistogramBinCount(isPrecisionMode);
    const histogramMinHeightRem = HISTOGRAM_MIN_HEIGHT_REM;
    const histogramGapPx = isPrecisionMode ? 0 : 1;
    const barRadiusStyle = isPrecisionMode ? "0" : "0.08rem 0.08rem 0 0";
    const counts = new Array<number>(binCount).fill(0);

    if (normalizedValues.length > 0) {
      for (const normalizedValue of normalizedValues) {
        const transformedValue = this.transformHistogramX(normalizedValue);
        const bucketIndex = Math.min(binCount - 1, Math.floor(transformedValue * binCount));
        counts[bucketIndex] += 1;
      }
    }

    const peakCount = counts.length > 0 ? Math.max(...counts) : 0;
    const bars = counts
      .map((count, index) => {
        const t = binCount === 1 ? 0.5 : index / (binCount - 1);
        const colorSampleT = this.inverseTransformHistogramX(t);
        const barColor =
          colormapColors.length > 0 ? sampleColormapColor(colormapColors, colorSampleT) : "#1a4f9a";
        const barHeightPercent =
          peakCount > 0
            ? Math.max(7, Math.round(this.normalizeHistogramY(count, peakCount) * 1000) / 10)
            : 0;

        return `<span class="velocity-legend-histogram-bar${
          count === 0 ? " is-empty" : ""
        }" style="height:${barHeightPercent}%;background:${barColor};border-radius:${barRadiusStyle};"></span>`;
      })
      .join("");

    const tooltip =
      this.legendHistogramMode === "standard"
        ? "Switch to precision histogram"
        : this.legendHistogramMode === "precision"
          ? "Hide histogram"
          : "Show standard histogram";

    if (this.legendHistogramMode === "hidden") {
      return `
        <button
          type="button"
          data-action="toggle-legend-histogram"
          class="velocity-legend-histogram is-collapsed"
          title="${tooltip}"
          aria-label="${tooltip}"
          aria-pressed="false"
        >
          <span class="velocity-legend-histogram-collapsed-label">Histogram hidden · click to cycle</span>
        </button>
      `;
    }

    return `
      <button
        type="button"
        data-action="toggle-legend-histogram"
        class="velocity-legend-histogram${isPrecisionMode ? " is-precision" : ""}"
        style="--legend-hist-gap:${histogramGapPx}px; --legend-hist-min-height:${histogramMinHeightRem}rem;"
        title="${tooltip}"
        aria-label="${tooltip}"
        aria-pressed="true"
      >
        <span
          class="velocity-legend-histogram-bars"
          style="grid-template-columns:repeat(${binCount}, minmax(0, 1fr));"
        >
          ${bars}
        </span>
      </button>
    `;
  }

  private getHistogramBinCount(isPrecisionMode: boolean): number {
    const renderedWidth = this.velocityLegendElement?.getBoundingClientRect().width ?? 0;
    const legendWidth = renderedWidth > 0 ? renderedWidth : this.legendWidthPx;
    const usableWidth = Math.max(140, legendWidth - 18);

    if (isPrecisionMode) {
      return Math.max(96, Math.min(420, Math.round(usableWidth / 1.45)));
    }

    return Math.max(20, Math.min(120, Math.round(usableWidth / 7.1)));
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

  private getRankedMetricSegmentKey(segment: RankedMetricSegment): string {
    const startId = segment.startPoint.id || `idx-${segment.startIndex}`;
    const endId = segment.endPoint.id || `idx-${segment.endIndex}`;
    return `${segment.metric}:${segment.trackId}:${startId}:${endId}`;
  }

  private getRankedOdEdgeKey(edge: RankedOdEdge): string {
    return `${edge.bundleId}:${edge.trajectoryId}`;
  }

  private getActiveRankedMetricSegments(): RankedMetricSegment[] {
    if (!this.activeEditingTrackId) {
      return this.rankedMetricSegments;
    }

    return this.rankedMetricSegments.filter(
      (segment) => segment.trackId === this.activeEditingTrackId
    );
  }

  private setRankedMetricSegments(segments: RankedMetricSegment[]): void {
    const previousActiveSegments = this.getActiveRankedMetricSegments();
    const previousCursor = this.rankedMetricCursor;
    const previousSegment =
      previousCursor >= 0 ? previousActiveSegments[previousCursor] : undefined;
    const previousSegmentKey = previousSegment
      ? this.getRankedMetricSegmentKey(previousSegment)
      : undefined;

    this.rankedMetricSegments = [...segments].sort((a, b) => b.baseValue - a.baseValue);

    const nextActiveSegments = this.getActiveRankedMetricSegments();
    if (nextActiveSegments.length === 0) {
      this.rankedMetricCursor = -1;
      this.updateLegendCycleStatus();
      return;
    }

    if (previousSegmentKey) {
      const nextIndex = nextActiveSegments.findIndex(
        (segment) => this.getRankedMetricSegmentKey(segment) === previousSegmentKey
      );
      if (nextIndex >= 0) {
        this.rankedMetricCursor = nextIndex;
        this.updateLegendCycleStatus();
        return;
      }
    }

    if (previousCursor >= 0) {
      this.rankedMetricCursor = Math.min(previousCursor, nextActiveSegments.length - 1);
      this.updateLegendCycleStatus();
      return;
    }

    this.rankedMetricCursor = -1;
    this.updateLegendCycleStatus();
  }

  private getOdMetricCatalog(): BundleOdMetricDefinition[] {
    return getAvailableOdMetricCatalog(this.latestBundles);
  }

  private getOdMetricDefinition(metricKey: string): BundleOdMetricDefinition | undefined {
    return findOdMetricDefinition(this.latestBundles, metricKey);
  }

  private collectRankedOdEdges(metricKey: string): RankedOdEdge[] {
    const rankedEdges: RankedOdEdge[] = [];

    for (const bundle of this.latestBundles) {
      if (!bundle.visible || !isOdEdgeBundle(bundle)) {
        continue;
      }

      for (const trajectory of bundle.bundle.renderTrajectories) {
        if (trajectory.path.length < 2) {
          continue;
        }

        const weight = getOdEdgeMetricValue(bundle.bundle, trajectory.id, "weight") ?? 0;
        const tripCount = getOdEdgeMetricValue(bundle.bundle, trajectory.id, "tripCount") ?? 0;
        const metricValue = getOdEdgeMetricValue(bundle.bundle, trajectory.id, metricKey) ?? 0;
        if (!(metricValue > 0)) {
          continue;
        }

        const reference = bundle.bundle.trajectoryRefById.get(trajectory.id);
        rankedEdges.push({
          bundleId: bundle.id,
          bundleName: bundle.name,
          trajectoryId: trajectory.id,
          trajectoryName: reference?.name ?? trajectory.id,
          weight,
          tripCount,
          durationMean: getOdEdgeMetricValue(bundle.bundle, trajectory.id, "durationMean"),
          metricValue,
          metricValues: {
            weight,
            tripCount,
            ...(reference?.metricValues ?? {})
          },
          properties: reference?.properties,
          latLngs: [
            trajectory.path[0],
            trajectory.path[trajectory.path.length - 1]
          ]
        });
      }
    }

    return rankedEdges.sort((left, right) => {
      if (right.metricValue !== left.metricValue) {
        return right.metricValue - left.metricValue;
      }

      return this.getRankedOdEdgeKey(left).localeCompare(this.getRankedOdEdgeKey(right));
    });
  }

  private setRankedOdEdges(
    edges: RankedOdEdge[],
    selectedEdge: { bundleId: string; trajectoryId: string } | undefined
  ): void {
    const previousEdge =
      this.rankedOdCursor >= 0 && this.rankedOdCursor < this.rankedOdEdges.length
        ? this.rankedOdEdges[this.rankedOdCursor]
        : undefined;
    const previousKey = previousEdge ? this.getRankedOdEdgeKey(previousEdge) : undefined;
    const selectedKey = selectedEdge ? `${selectedEdge.bundleId}:${selectedEdge.trajectoryId}` : undefined;

    this.rankedOdEdges = edges;

    if (this.rankedOdEdges.length === 0) {
      this.rankedOdCursor = -1;
      this.updateLegendCycleStatus();
      return;
    }

    if (selectedKey) {
      const selectedIndex = this.rankedOdEdges.findIndex(
        (edge) => this.getRankedOdEdgeKey(edge) === selectedKey
      );
      this.rankedOdCursor = selectedIndex >= 0 ? selectedIndex : -1;
      this.updateLegendCycleStatus();
      return;
    }

    if (previousKey) {
      const previousIndex = this.rankedOdEdges.findIndex(
        (edge) => this.getRankedOdEdgeKey(edge) === previousKey
      );
      if (previousIndex >= 0) {
        this.rankedOdCursor = previousIndex;
        this.updateLegendCycleStatus();
        return;
      }
    }

    if (this.rankedOdCursor >= 0) {
      this.rankedOdCursor = Math.min(this.rankedOdCursor, this.rankedOdEdges.length - 1);
    } else {
      this.rankedOdCursor = -1;
    }

    this.updateLegendCycleStatus();
  }

  private applyLegendSizeStyles(): void {
    if (!this.velocityLegendElement) {
      return;
    }

    const minHeight = this.getLegendMinimumHeightPx(this.legendHistogramMode);
    const width = this.legendHasCustomSize ? this.legendWidthPx : DEFAULT_LEGEND_WIDTH_PX;
    const requestedHeight = this.legendHasCustomSize ? this.legendHeightPx : DEFAULT_LEGEND_HEIGHT_PX;
    const useAutoHeight = this.legendHistogramMode === "hidden" && !this.legendHasCustomSize;
    const height = Math.max(minHeight, requestedHeight);

    this.velocityLegendElement.style.width = `${Math.round(width)}px`;
    this.velocityLegendElement.style.minHeight = useAutoHeight ? "0px" : `${Math.round(minHeight)}px`;
    this.velocityLegendElement.style.height = useAutoHeight ? "auto" : `${Math.round(height)}px`;

    if (this.legendHasCustomSize && !useAutoHeight) {
      this.legendHeightPx = height;
    }
  }

  private getLegendMinimumHeightPx(mode: LegendHistogramMode): number {
    if (mode === "hidden") {
      return 0;
    }

    return MIN_LEGEND_HEIGHT_HISTOGRAM_PX;
  }

  private setLegendHistogramMode(nextMode: LegendHistogramMode): void {
    const currentMode = this.legendHistogramMode;
    if (nextMode === currentMode) {
      return;
    }

    if (nextMode === "hidden") {
      const currentWidth = this.legendHasCustomSize ? this.legendWidthPx : DEFAULT_LEGEND_WIDTH_PX;
      const currentHeight = this.legendHasCustomSize ? this.legendHeightPx : DEFAULT_LEGEND_HEIGHT_PX;
      const currentMinHeight = this.getLegendMinimumHeightPx(currentMode);

      this.legendVisibleModeWidthPx = Math.max(MIN_LEGEND_WIDTH_PX, Math.round(currentWidth));
      this.legendVisibleModeHeightPx = Math.max(currentMinHeight, Math.round(currentHeight));
      this.legendVisibleModeWasCustom = this.legendHasCustomSize;

      this.legendHasCustomSize = false;
      this.legendWidthPx = DEFAULT_LEGEND_WIDTH_PX;
      this.legendHeightPx = DEFAULT_LEGEND_HEIGHT_PX;
      this.onLegendPointerUp(undefined, false);
      this.legendHistogramMode = nextMode;
      return;
    }

    if (currentMode === "hidden") {
      this.legendWidthPx = this.legendVisibleModeWidthPx;
      this.legendHeightPx = this.legendVisibleModeHeightPx;
      this.legendHasCustomSize = this.legendVisibleModeWasCustom;
      this.onLegendPointerUp(undefined, false);
    }

    this.legendHistogramMode = nextMode;
  }

  private onLegendPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const resizeHandle = target.closest<HTMLElement>('button[data-action="resize-legend"]');
    if (!resizeHandle || !this.velocityLegendElement || this.legendHistogramMode === "hidden") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const legendRect = this.velocityLegendElement.getBoundingClientRect();
    const minHeight = this.getLegendMinimumHeightPx(this.legendHistogramMode);
    this.legendWidthPx = Math.max(MIN_LEGEND_WIDTH_PX, Math.round(legendRect.width));
    this.legendHeightPx = Math.max(minHeight, Math.round(legendRect.height));
    this.legendHasCustomSize = true;
    this.legendResize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: this.legendWidthPx,
      startHeight: this.legendHeightPx,
      wasMapDraggingEnabled: this.map.dragging.enabled()
    };

    if (this.legendResize.wasMapDraggingEnabled) {
      this.map.dragging.disable();
    }

    this.velocityLegendElement.classList.add("is-resizing");
    document.addEventListener("pointermove", this.onLegendPointerMove, { passive: false });
    document.addEventListener("pointerup", this.onLegendPointerUp);
    document.addEventListener("pointercancel", this.onLegendPointerUp);
  };

  private onLegendPointerMove = (event: PointerEvent): void => {
    if (!this.legendResize) {
      return;
    }

    if (event.pointerId !== this.legendResize.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const mapRect = this.map.getContainer().getBoundingClientRect();
    const minHeight = this.getLegendMinimumHeightPx(this.legendHistogramMode);
    const maxWidth = Math.max(MIN_LEGEND_WIDTH_PX, Math.floor(mapRect.width - 24));
    const maxHeight = Math.max(minHeight, Math.floor(mapRect.height - 24));
    const widthFromDrag = this.legendResize.startWidth - (event.clientX - this.legendResize.startX);
    const heightFromDrag = this.legendResize.startHeight - (event.clientY - this.legendResize.startY);
    const nextWidth = Math.round(Math.min(maxWidth, Math.max(MIN_LEGEND_WIDTH_PX, widthFromDrag)));
    const nextHeight = Math.round(Math.min(maxHeight, Math.max(minHeight, heightFromDrag)));

    if (nextWidth === this.legendWidthPx && nextHeight === this.legendHeightPx) {
      return;
    }

    this.legendWidthPx = nextWidth;
    this.legendHeightPx = nextHeight;
    this.applyLegendSizeStyles();
    this.rerenderLegendFromLastContext();
  };

  private onLegendPointerUp = (event?: PointerEvent, rerender = true): void => {
    if (!this.legendResize) {
      return;
    }

    if (event && event.pointerId !== this.legendResize.pointerId) {
      return;
    }

    event?.preventDefault();
    event?.stopPropagation();

    const wasMapDraggingEnabled = this.legendResize.wasMapDraggingEnabled;
    this.legendResize = undefined;

    document.removeEventListener("pointermove", this.onLegendPointerMove);
    document.removeEventListener("pointerup", this.onLegendPointerUp);
    document.removeEventListener("pointercancel", this.onLegendPointerUp);

    this.velocityLegendElement?.classList.remove("is-resizing");

    if (
      wasMapDraggingEnabled &&
      !this.draggingPoint &&
      !this.marqueeSelection &&
      !this.lassoSelection
    ) {
      this.map.dragging.enable();
    }

    if (rerender) {
      this.rerenderLegendFromLastContext();
    }
  };

  private onLegendClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const colormapCycleButton = target.closest<HTMLButtonElement>(
      'button[data-action="cycle-legend-colormap"]'
    );
    if (colormapCycleButton) {
      event.preventDefault();
      this.callbacks.onCycleAnalysisColormap?.();
      return;
    }

    const axisModeButton = target.closest<HTMLButtonElement>(
      'button[data-action="set-legend-axis-mode"]'
    );
    if (axisModeButton) {
      event.preventDefault();
      const nextMode = axisModeButton.dataset.axisMode;
      if (
        nextMode === "lin-lin" ||
        nextMode === "lin-log" ||
        nextMode === "log-lin" ||
        nextMode === "log-log"
      ) {
        this.legendHistogramAxisMode = nextMode;
        this.rerenderLegendFromLastContext();
      }
      return;
    }

    const histogramToggle = target.closest<HTMLButtonElement>(
      'button[data-action="toggle-legend-histogram"]'
    );
    if (histogramToggle) {
      event.preventDefault();
      const nextHistogramMode =
        this.legendHistogramMode === "standard"
          ? "precision"
          : this.legendHistogramMode === "precision"
            ? "hidden"
            : "standard";
      this.setLegendHistogramMode(nextHistogramMode);
      this.rerenderLegendFromLastContext();
      return;
    }

    const extractButton = target.closest<HTMLButtonElement>('button[data-action="extract-selected-od"]');
    if (extractButton) {
      event.preventDefault();
      event.stopPropagation();
      this.suppressNextMapClick = true;
      this.callbacks.onExtractSelectedOdEdge?.();
      return;
    }

    const button = target.closest<HTMLButtonElement>('button[data-action="cycle-analysis-focus"]');
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      this.suppressNextMapClick = true;
      if (this.lastAnalysisSettings?.mode === "od") {
        this.focusNextOdEdge();
      } else {
        this.focusNextTopSegment();
      }
      return;
    }

    const resetButton = target.closest<HTMLButtonElement>('button[data-action="reset-analysis-focus"]');
    if (!resetButton) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.suppressNextMapClick = true;
    if (this.lastAnalysisSettings?.mode === "od") {
      this.focusTopOdEdge();
    } else {
      this.focusTopMetricSegment();
    }
  };

  private focusNextOdEdge(): void {
    if (this.rankedOdEdges.length === 0) {
      return;
    }

    this.rankedOdCursor = (this.rankedOdCursor + 1) % this.rankedOdEdges.length;
    const edge = this.rankedOdEdges[this.rankedOdCursor];
    this.callbacks.onOdEdgeSelected?.(edge.bundleId, edge.trajectoryId);
    this.focusRankedOdEdge(edge);
    this.focusMapContainer();
    this.updateLegendCycleStatus();
  }

  private focusTopOdEdge(): void {
    if (this.rankedOdEdges.length === 0) {
      return;
    }

    this.rankedOdCursor = -1;
    this.focusNextOdEdge();
  }

  private getCurrentRankedOdEdge(): RankedOdEdge | undefined {
    if (this.rankedOdCursor < 0 || this.rankedOdCursor >= this.rankedOdEdges.length) {
      return undefined;
    }

    return this.rankedOdEdges[this.rankedOdCursor];
  }

  private focusRankedOdEdge(edge: RankedOdEdge): void {
    const bounds = L.latLngBounds(edge.latLngs);
    if (!bounds.isValid()) {
      return;
    }

    this.map.fitBounds(bounds.pad(0.25), {
      maxZoom: 13
    });
  }

  private getOdMetricLabel(metricKey: string): string {
    return this.getOdMetricDefinition(metricKey)?.label ?? metricKey;
  }

  private formatOdMetricValue(
    value: number,
    definition: BundleOdMetricDefinition | undefined
  ): string {
    if (!Number.isFinite(value)) {
      return "0";
    }

    if (definition?.unitLabel === "%") {
      return `${(value * 100).toLocaleString(undefined, {
        minimumFractionDigits: value < 0.1 ? 1 : 0,
        maximumFractionDigits: 1
      })}%`;
    }

    if (definition?.key === "tripCount" || definition?.sourceKey === "tripCount") {
      return Math.round(value).toLocaleString();
    }

    if (definition?.unitLabel === "min") {
      return value.toLocaleString(undefined, {
        minimumFractionDigits: value < 100 ? 1 : 0,
        maximumFractionDigits: 1
      });
    }

    return value.toLocaleString(undefined, {
      minimumFractionDigits: value < 100 ? 1 : 0,
      maximumFractionDigits: 1
    });
  }

  private getDominantOdMetricSummary(edge: RankedOdEdge, sourceKey: string): string | undefined {
    const candidates = this.getOdMetricCatalog().filter(
      (definition) =>
        definition.sourceKey === sourceKey &&
        definition.variant === "share" &&
        definition.valueKey
    );
    if (candidates.length === 0) {
      return undefined;
    }

    let bestDefinition: BundleOdMetricDefinition | undefined;
    let bestValue = -1;
    for (const candidate of candidates) {
      const value = edge.metricValues[candidate.key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        continue;
      }

      if (value > bestValue) {
        bestValue = value;
        bestDefinition = candidate;
      }
    }

    if (!bestDefinition || bestValue < 0) {
      return undefined;
    }

    return `${bestDefinition.sourceLabel}: ${bestDefinition.valueLabel ?? bestDefinition.label} (${this.formatOdMetricValue(
      bestValue,
      bestDefinition
    )})`;
  }

  private onPopupClose = (event: L.PopupEvent): void => {
    if (this.activeInfoPopup && event.popup === this.activeInfoPopup) {
      this.activeInfoPopup = undefined;
    }
  };

  private focusNextTopSegment(): void {
    const activeSegments = this.getActiveRankedMetricSegments();
    if (activeSegments.length === 0) {
      return;
    }

    this.rankedMetricCursor = (this.rankedMetricCursor + 1) % activeSegments.length;
    const segment = activeSegments[this.rankedMetricCursor];
    this.focusRankedMetricSegment(segment);

    if (this.activeEditingTrackId && segment.trackId === this.activeEditingTrackId) {
      const endpointPointId = this.resolvePeakSegmentEndpointPointId(segment);
      if (endpointPointId) {
        window.setTimeout(() => {
          this.callbacks.onPointSelected?.(segment.trackId, endpointPointId, false, "peak-nav");
        }, 0);
      }
      this.focusMapContainer();
    }

    this.updateLegendCycleStatus();
  }

  private focusTopMetricSegment(): void {
    const activeSegments = this.getActiveRankedMetricSegments();
    if (activeSegments.length === 0) {
      return;
    }

    this.rankedMetricCursor = -1;
    this.focusNextTopSegment();
  }

  getCurrentPeakEndpointSelectionTarget(): { trackId: string; pointId: string } | undefined {
    const segment = this.getCurrentRankedMetricSegment();
    if (!segment) {
      return undefined;
    }

    const pointId = this.resolvePeakSegmentEndpointPointId(segment);
    if (!pointId) {
      return undefined;
    }

    return {
      trackId: segment.trackId,
      pointId
    };
  }

  focusCurrentPeakSegment(): boolean {
    const segment = this.getCurrentRankedMetricSegment();
    if (!segment) {
      return false;
    }

    this.focusRankedMetricSegment(segment);
    return true;
  }

  private getCurrentRankedMetricSegment(): RankedMetricSegment | undefined {
    const activeSegments = this.getActiveRankedMetricSegments();
    if (this.rankedMetricCursor < 0 || this.rankedMetricCursor >= activeSegments.length) {
      return undefined;
    }

    return activeSegments[this.rankedMetricCursor];
  }

  private focusRankedMetricSegment(segment: RankedMetricSegment): void {
    this.preserveInfoPopupOnNextRender = true;
    const bounds = L.latLngBounds(segment.latLngs);
    this.map.fitBounds(bounds.pad(3));
    this.openSegmentInfoPopup(segment);
  }

  private resolvePeakSegmentEndpointPointId(segment: RankedMetricSegment): string | undefined {
    const track = this.latestTracks.find((candidate) => candidate.id === segment.trackId);
    if (!track) {
      return segment.endPoint.id || undefined;
    }

    if (
      segment.endPoint.id &&
      track.points.some((point) => point.id === segment.endPoint.id)
    ) {
      return segment.endPoint.id;
    }

    const point = track.points[segment.endIndex];
    if (point?.id) {
      return point.id;
    }

    let nearest: TrackPoint | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of track.points) {
      const latDelta = candidate.lat - segment.endPoint.lat;
      const lngDelta = candidate.lng - segment.endPoint.lng;
      const distance = latDelta * latDelta + lngDelta * lngDelta;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    }

    return nearest?.id;
  }

  private focusMapContainer(): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== this.map.getContainer()) {
      activeElement.blur();
    }

    const mapContainer = this.map.getContainer();
    if (typeof mapContainer.focus === "function") {
      mapContainer.focus({ preventScroll: true });
    }
  }

  private openSegmentInfoPopup(segment: RankedMetricSegment): void {
    const endpoint = L.latLng(segment.endPoint.lat, segment.endPoint.lng);

    const formatPoint = (point: Track["points"][number]): string =>
      `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
    const durationText =
      segment.durationSeconds !== undefined ? `${segment.durationSeconds.toFixed(1)} s` : "n/a";
    const distanceText =
      segment.distanceMeters !== undefined ? `${segment.distanceMeters.toFixed(1)} m` : "n/a";

    const popupHtml = `
      <div class="segment-info-popup-content">
        <div class="segment-info-title">${this.escapeHtml(segment.trackName)}</div>
        <div class="segment-info-metric">
          ${segment.metricLabel}: <strong>${segment.displayValue.toFixed(2)} ${segment.unitLabel}</strong>
        </div>
        <div class="segment-info-meta">
          Segment: ${segment.startIndex + 1} → ${segment.endIndex + 1}<br />
          Distance: ${distanceText}<br />
          Duration: ${durationText}
        </div>
        <div class="segment-info-points">
          <div><strong>P${segment.startIndex + 1}</strong>: ${formatPoint(segment.startPoint)}${
      segment.startPoint.time ? ` (${this.escapeHtml(segment.startPoint.time)})` : ""
    }</div>
          <div><strong>P${segment.endIndex + 1}</strong>: ${formatPoint(segment.endPoint)}${
      segment.endPoint.time ? ` (${this.escapeHtml(segment.endPoint.time)})` : ""
    }</div>
        </div>
      </div>
    `;

    this.clearInfoPopup();
    const popup = L.popup({
      closeButton: true,
      autoClose: true,
      closeOnClick: false,
      autoPan: true,
      className: "segment-info-popup"
    })
      .setLatLng(endpoint)
      .setContent(popupHtml);
    popup.openOn(this.map);
    this.activeInfoPopup = popup;
  }

  private clearInfoPopup(): void {
    if (!this.activeInfoPopup) {
      return;
    }

    this.map.closePopup(this.activeInfoPopup);
    this.activeInfoPopup = undefined;
  }

  private updateLegendCycleStatus(): void {
    if (!this.velocityLegendElement) {
      return;
    }
    const status = this.velocityLegendElement.querySelector<HTMLElement>(".velocity-legend-cycle-status");
    if (this.lastAnalysisSettings?.mode === "od") {
      if (this.rankedOdCursor >= this.rankedOdEdges.length) {
        this.rankedOdCursor = -1;
      }

      if (status) {
        const currentRank = this.rankedOdCursor >= 0 ? this.rankedOdCursor + 1 : 0;
        status.textContent = `${currentRank}/${this.rankedOdEdges.length}`;
      }

      const cycleButtons = this.velocityLegendElement.querySelectorAll<HTMLButtonElement>(
        'button[data-action="cycle-analysis-focus"], button[data-action="reset-analysis-focus"]'
      );
      for (const button of cycleButtons) {
        button.disabled = this.rankedOdEdges.length === 0;
      }

      const extractButton = this.velocityLegendElement.querySelector<HTMLButtonElement>(
        'button[data-action="extract-selected-od"]'
      );
      if (extractButton) {
        extractButton.disabled = !this.getCurrentRankedOdEdge();
      }
      return;
    }

    const activeSegments = this.getActiveRankedMetricSegments();
    if (this.rankedMetricCursor >= activeSegments.length) {
      this.rankedMetricCursor = -1;
    }

    if (status) {
      const currentRank = this.rankedMetricCursor >= 0 ? this.rankedMetricCursor + 1 : 0;
      status.textContent = `${currentRank}/${activeSegments.length}`;
    }

    const buttons = this.velocityLegendElement.querySelectorAll<HTMLButtonElement>(
      'button[data-action="cycle-analysis-focus"], button[data-action="reset-analysis-focus"]'
    );
    for (const button of buttons) {
      button.disabled = activeSegments.length === 0;
    }
  }

  private rerenderLegendFromLastContext(): void {
    if (!this.lastAnalysisSettings) {
      return;
    }

    this.updateAnalysisLegend(
      this.lastAnalysisSettings,
      this.lastVelocitySettings,
      this.lastLegendColormap,
      this.lastLegendScaleInfo
    );
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
    this.updateCursorClass();
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
    const movedPointIndexes = new Set<number>();

    for (const pointId of this.draggingPoint.movePointIds) {
      const startPos = this.draggingPoint.startPositionsByPointId.get(pointId);
      const marker = this.draggingPoint.markerByPointId.get(pointId);
      const pointIndex = this.draggingPoint.indexByPointId.get(pointId);

      if (!startPos || !marker || pointIndex === undefined) {
        continue;
      }

      const nextLatLng = L.latLng(startPos.lat + deltaLat, startPos.lng + deltaLng);
      marker.setLatLng(nextLatLng);
      movedPointIndexes.add(pointIndex);

      if (flat) {
        flat[pointIndex] = nextLatLng;
      }
    }

    if (flat) {
      this.draggingPoint.polyline.setLatLngs(flat);
    }

    this.updateDraggedSegmentPolylines(movedPointIndexes);
  };

  private updateDraggedSegmentPolylines(movedPointIndexes: Set<number>): void {
    if (!this.draggingPoint?.segmentByStartIndex || movedPointIndexes.size === 0) {
      return;
    }

    const affectedSegmentIndexes = new Set<number>();
    const segmentByStartIndex = this.draggingPoint.segmentByStartIndex;
    const maxSegmentIndex = this.draggingPoint.pointIdByIndex.length - 2;

    for (const movedPointIndex of movedPointIndexes) {
      if (movedPointIndex > 0) {
        affectedSegmentIndexes.add(movedPointIndex - 1);
      }
      if (movedPointIndex < maxSegmentIndex + 1) {
        affectedSegmentIndexes.add(movedPointIndex);
      }
    }

    for (const segmentStartIndex of affectedSegmentIndexes) {
      if (segmentStartIndex < 0 || segmentStartIndex > maxSegmentIndex) {
        continue;
      }

      const segment = segmentByStartIndex.get(segmentStartIndex);
      if (!segment) {
        continue;
      }

      const startPointId = this.draggingPoint.pointIdByIndex[segmentStartIndex];
      const endPointId = this.draggingPoint.pointIdByIndex[segmentStartIndex + 1];
      const startMarker = this.draggingPoint.markerByPointId.get(startPointId);
      const endMarker = this.draggingPoint.markerByPointId.get(endPointId);

      if (!startMarker || !endMarker) {
        continue;
      }

      segment.setLatLngs([startMarker.getLatLng(), endMarker.getLatLng()]);
    }
  }

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

    const shouldStartMarquee =
      this.activeEditMode === "marquee" || (this.activeEditMode === "move" && shiftKey);
    if (!shouldStartMarquee) {
      return;
    }

    this.startMarqueeSelection(event, shiftKey);
  };

  private onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (this.isSpacePressed) {
      return;
    }

    this.isSpacePressed = true;
    this.updateCursorClass();
  };

  private onWindowKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== "Space") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!this.isSpacePressed) {
      return;
    }

    this.isSpacePressed = false;
    this.updateCursorClass();
  };

  private onWindowBlur = (): void => {
    this.isSpacePressed = false;
    this.onLegendPointerUp(undefined, false);
    this.updateCursorClass();
  };

  private onMapMouseEnter = (event: MouseEvent): void => {
    this.isPointerInsideMap = true;
    this.updatePointerPosition(event);
    this.updateCursorClass();
  };

  private onMapMouseMove = (event: MouseEvent): void => {
    this.updatePointerPosition(event);
    this.updateCursorClass();
  };

  private onMapMouseLeave = (): void => {
    this.isPointerInsideMap = false;
    this.isHoveringEditablePoint = false;
    this.isPointerOverLegend = false;
    this.updateCursorClass();
  };

  private onLegendMouseEnter = (): void => {
    this.isPointerOverLegend = true;
    this.updateCursorClass();
  };

  private onLegendMouseLeave = (): void => {
    this.isPointerOverLegend = false;
    this.updateCursorClass();
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
    this.updateCursorClass();
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
    this.updateCursorClass();
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
    this.updateCursorClass();
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
    this.updateCursorClass();
    this.map.off("mousemove", this.onLassoMove);
    this.map.off("mouseup", this.onLassoEnd);
  }

  private resetDragState(): void {
    if (!this.draggingPoint) {
      return;
    }

    this.draggingPoint = undefined;
    this.map.dragging.enable();
    this.updateCursorClass();
    this.map.off("mousemove", this.onDragMove);
    this.map.off("mouseup", this.onDragEnd);
  }

  private updateCursorClass(): void {
    const container = this.map.getContainer();
    const isEditingTrack = Boolean(this.activeEditingTrackId);
    const wantsCrosshair =
      (this.activeEditMode === "info" ||
        (isEditingTrack &&
          (this.activeEditMode !== "move" || this.isHoveringEditablePoint))) &&
      !this.isSpacePressed;
    const overlayMode = wantsCrosshair ? "crosshair" : "pan";
    const showCursorOverlay = this.isPointerInsideMap && !this.isPointerOverLegend;

    container.classList.toggle("is-editing-cursor", wantsCrosshair);
    container.classList.toggle("is-grab-cursor", !wantsCrosshair);
    container.classList.toggle("has-proxy-cursor", showCursorOverlay);

    this.spaceCursorElement.classList.toggle("is-hidden", !showCursorOverlay);
    this.spaceCursorElement.classList.toggle(
      "is-crosshair",
      showCursorOverlay && overlayMode === "crosshair"
    );
    this.spaceCursorElement.classList.toggle("is-pan", showCursorOverlay && overlayMode === "pan");

    if (showCursorOverlay) {
      this.spaceCursorElement.style.transform = `translate(${this.pointerX}px, ${this.pointerY}px)`;
    }
  }

  private updatePointerPosition(event: MouseEvent): void {
    const rect = this.map.getContainer().getBoundingClientRect();
    this.pointerX = event.clientX - rect.left;
    this.pointerY = event.clientY - rect.top;
  }
}
