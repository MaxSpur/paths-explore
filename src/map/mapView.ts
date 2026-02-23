import L from "leaflet";
import { getColormapById, sampleColormapColor } from "../colormaps";
import {
  computeTrackSegmentAccelerations,
  computeTrackSegmentVelocities,
  computeVelocityScaleInfo,
  normalizeVelocity,
  type SegmentColorScaleInfo
} from "./velocity";
import type {
  EditInteractionMode,
  PointCoordinateUpdate,
  SegmentColorMetric,
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

type LegendHistogramMode = "standard" | "precision" | "hidden";
type LegendHistogramAxisMode = "lin-lin" | "lin-log" | "log-lin" | "log-log";
interface LegendResizeContext {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  wasMapDraggingEnabled: boolean;
}

const DEFAULT_LEGEND_WIDTH_PX = 220;
const DEFAULT_LEGEND_HEIGHT_PX = 200;
const MIN_LEGEND_WIDTH_PX = 220;
const MIN_LEGEND_HEIGHT_HIDDEN_PX = 176;
const MIN_LEGEND_HEIGHT_STANDARD_PX = 232;
const MIN_LEGEND_HEIGHT_PRECISION_PX = 248;
const HISTOGRAM_LOG_X_STRETCH = 45;

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
  private layerGroup: L.LayerGroup;
  private velocityLegendElement?: HTMLDivElement;
  private spaceCursorElement: HTMLDivElement;
  private callbacks: MapViewCallbacks;
  private draggingPoint?: DraggingPointContext;
  private marqueeSelection?: MarqueeSelectionContext;
  private lassoSelection?: LassoSelectionContext;
  private latestTracks: Track[] = [];
  private activeEditingTrackId?: string;
  private activeEditMode: EditInteractionMode = "move";
  private suppressNextMapClick = false;
  private isSpacePressed = false;
  private isPointerInsideMap = false;
  private isHoveringEditablePoint = false;
  private pointerX = 0;
  private pointerY = 0;
  private rankedMetricSegments: RankedMetricSegment[] = [];
  private rankedMetricCursor = -1;
  private activeInfoPopup?: L.Popup;
  private legendHistogramMode: LegendHistogramMode = "standard";
  private legendHistogramAxisMode: LegendHistogramAxisMode = "lin-lin";
  private lastLegendEnabled = false;
  private lastLegendSettings?: VelocityViewSettings;
  private lastLegendColormap?: LegendColormap;
  private lastLegendScaleInfo?: SegmentColorScaleInfo;
  private legendResize?: LegendResizeContext;
  private legendWidthPx = DEFAULT_LEGEND_WIDTH_PX;
  private legendHeightPx = DEFAULT_LEGEND_HEIGHT_PX;
  private legendHasCustomSize = false;

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

  renderTracks(tracks: Track[], options: RenderOptions = {}): void {
    this.latestTracks = tracks;
    this.activeEditingTrackId = options.editingTrackId;
    this.activeEditMode = options.editMode ?? "move";
    this.isHoveringEditablePoint = false;
    this.clearInfoPopup();
    this.resetDragState();
    this.resetMarqueeSelection();
    this.resetLassoSelection();
    this.layerGroup.clearLayers();

    const selectedPointIdSet = new Set(options.selectedPointIds ?? []);
    const velocitySettings = options.velocitySettings;
    const renderVelocity = velocitySettings?.enabled ?? false;
    const colormap = velocitySettings ? getColormapById(velocitySettings.colormapId) : undefined;
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
      const polyline = showSegments
        ? renderVelocity
          ? this.renderVelocityTrackPolyline(
              track,
              lineCoords,
              velocitySettings?.metric ?? "velocity",
              colormap?.colors ?? [],
              velocityScaleInfo,
              rankedSegments
            )
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
          this.callbacks.onPointSelected?.(track.id, point.id, additive);
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

    this.setRankedMetricSegments(rankedSegments);
    this.updateVelocityLegend(renderVelocity, velocitySettings, colormap, velocityScaleInfo);
    this.updateCursorClass();
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
    metric: SegmentColorMetric,
    colormapColors: { r: number; g: number; b: number }[],
    velocityScaleInfo: SegmentColorScaleInfo | undefined,
    rankedSegments: RankedMetricSegment[]
  ): L.Polyline {
    const hiddenPolyline = L.polyline(lineCoords, {
      color: "#000000",
      weight: 0,
      opacity: 0,
      interactive: false
    });

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

    return hiddenPolyline;
  }

  private updateVelocityLegend(
    enabled: boolean,
    settings: VelocityViewSettings | undefined,
    colormap: LegendColormap | undefined,
    velocityScaleInfo: SegmentColorScaleInfo | undefined
  ): void {
    this.lastLegendEnabled = enabled;
    this.lastLegendSettings = settings;
    this.lastLegendColormap = colormap;
    this.lastLegendScaleInfo = velocityScaleInfo;

    if (!this.velocityLegendElement) {
      return;
    }

    if (!enabled || !settings || !colormap) {
      if (this.legendResize) {
        this.onLegendPointerUp(undefined, false);
      }
      this.velocityLegendElement.classList.add("is-hidden");
      this.velocityLegendElement.innerHTML = "";
      this.rankedMetricCursor = -1;
      return;
    }

    const maxDisplayValue = velocityScaleInfo ? Math.max(0, velocityScaleInfo.maxDisplayValue) : 0;
    const unitLabel = velocityScaleInfo?.unitLabel ?? "";
    const metricLabel = velocityScaleInfo?.metricLabel ?? "Velocity";
    const gradient = this.buildLegendGradient(colormap.colors);
    const histogramMarkup = this.buildLegendHistogramMarkup(colormap.colors, velocityScaleInfo);
    const axisModeControlMarkup = this.buildLegendAxisModeControlMarkup();
    const scaleLabel =
      settings.scaleMode === "fixed"
        ? `Fixed scale (max ${Math.max(0, Math.round(settings.fixedMax * 10) / 10)} ${unitLabel})`
        : "Auto scale (across visible tracks)";
    const availability =
      maxDisplayValue <= 0
        ? "No timed segments available."
        : `Current max: ${Math.round(maxDisplayValue * 10) / 10} ${unitLabel}`;
    const currentRank = this.rankedMetricCursor >= 0 ? this.rankedMetricCursor + 1 : 0;
    const totalRanks = this.rankedMetricSegments.length;

    this.velocityLegendElement.classList.remove("is-hidden");
    this.velocityLegendElement.innerHTML = `
      <button
        type="button"
        data-action="resize-legend"
        class="velocity-legend-resize-handle"
        title="Drag top-left corner to resize legend"
        aria-label="Resize legend"
      ></button>
      <div class="velocity-legend-header">
        <div class="velocity-legend-title">${metricLabel}</div>
        ${axisModeControlMarkup}
      </div>
      ${histogramMarkup}
      <div class="velocity-legend-bar" style="--legend-gradient: ${gradient};"></div>
      <div class="velocity-legend-scale"><span>0 ${unitLabel}</span><span>${
        Math.round(maxDisplayValue * 10) / 10
      } ${unitLabel}</span></div>
      <div class="velocity-legend-note">${scaleLabel}</div>
      <div class="velocity-legend-note">${availability}</div>
      <div class="velocity-legend-actions">
        <button
          type="button"
          data-action="cycle-top-segment"
          class="velocity-legend-cycle-btn"
          ${totalRanks === 0 ? "disabled" : ""}
        >
          Next Peak
        </button>
        <span class="velocity-legend-cycle-status">${currentRank}/${totalRanks}</span>
      </div>
    `;
    this.applyLegendSizeStyles();
    this.velocityLegendElement.classList.toggle("is-resizing", Boolean(this.legendResize));
  }

  private buildLegendAxisModeControlMarkup(): string {
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
    velocityScaleInfo: SegmentColorScaleInfo | undefined
  ): string {
    const isPrecisionMode = this.legendHistogramMode === "precision";
    const binCount = this.getHistogramBinCount(isPrecisionMode);
    const histogramMinHeightRem = isPrecisionMode ? 4.1 : 3.0;
    const histogramGapPx = isPrecisionMode ? 0 : 1;
    const barRadiusStyle = isPrecisionMode ? "0" : "0.08rem 0.08rem 0 0";
    const counts = new Array<number>(binCount).fill(0);

    if (velocityScaleInfo && velocityScaleInfo.maxBaseValue > 0) {
      for (const segment of this.rankedMetricSegments) {
        const normalizedValue = normalizeVelocity(segment.baseValue, velocityScaleInfo);
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

  private setRankedMetricSegments(segments: RankedMetricSegment[]): void {
    this.rankedMetricSegments = [...segments].sort((a, b) => b.baseValue - a.baseValue);
    this.rankedMetricCursor = -1;
    this.updateLegendCycleStatus();
  }

  private applyLegendSizeStyles(): void {
    if (!this.velocityLegendElement) {
      return;
    }

    const minHeight = this.getLegendMinimumHeightPx();
    const width = this.legendHasCustomSize ? this.legendWidthPx : DEFAULT_LEGEND_WIDTH_PX;
    const requestedHeight = this.legendHasCustomSize ? this.legendHeightPx : DEFAULT_LEGEND_HEIGHT_PX;
    const height = Math.max(minHeight, requestedHeight);

    this.velocityLegendElement.style.width = `${Math.round(width)}px`;
    this.velocityLegendElement.style.minHeight = `${Math.round(minHeight)}px`;
    this.velocityLegendElement.style.height = `${Math.round(height)}px`;

    if (this.legendHasCustomSize) {
      this.legendHeightPx = height;
    }
  }

  private getLegendMinimumHeightPx(): number {
    if (this.legendHistogramMode === "hidden") {
      return MIN_LEGEND_HEIGHT_HIDDEN_PX;
    }

    if (this.legendHistogramMode === "precision") {
      return MIN_LEGEND_HEIGHT_PRECISION_PX;
    }

    return MIN_LEGEND_HEIGHT_STANDARD_PX;
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
    if (!resizeHandle || !this.velocityLegendElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const legendRect = this.velocityLegendElement.getBoundingClientRect();
    const minHeight = this.getLegendMinimumHeightPx();
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
    const minHeight = this.getLegendMinimumHeightPx();
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
      this.legendHistogramMode =
        this.legendHistogramMode === "standard"
          ? "precision"
          : this.legendHistogramMode === "precision"
            ? "hidden"
            : "standard";
      this.rerenderLegendFromLastContext();
      return;
    }

    const button = target.closest<HTMLButtonElement>('button[data-action="cycle-top-segment"]');
    if (!button) {
      return;
    }

    event.preventDefault();
    this.focusNextTopSegment();
  };

  private onPopupClose = (event: L.PopupEvent): void => {
    if (this.activeInfoPopup && event.popup === this.activeInfoPopup) {
      this.activeInfoPopup = undefined;
    }
  };

  private focusNextTopSegment(): void {
    if (this.rankedMetricSegments.length === 0) {
      return;
    }

    this.rankedMetricCursor = (this.rankedMetricCursor + 1) % this.rankedMetricSegments.length;
    const segment = this.rankedMetricSegments[this.rankedMetricCursor];
    const bounds = L.latLngBounds(segment.latLngs);
    this.map.fitBounds(bounds.pad(3));
    this.openSegmentInfoPopup(segment);
    this.updateLegendCycleStatus();
  }

  private openSegmentInfoPopup(segment: RankedMetricSegment): void {
    const midpoint = L.latLng(
      (segment.startPoint.lat + segment.endPoint.lat) / 2,
      (segment.startPoint.lng + segment.endPoint.lng) / 2
    );

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
      .setLatLng(midpoint)
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
    if (status) {
      const currentRank = this.rankedMetricCursor >= 0 ? this.rankedMetricCursor + 1 : 0;
      status.textContent = `${currentRank}/${this.rankedMetricSegments.length}`;
    }

    const button = this.velocityLegendElement.querySelector<HTMLButtonElement>(
      'button[data-action="cycle-top-segment"]'
    );
    if (button) {
      button.disabled = this.rankedMetricSegments.length === 0;
    }
  }

  private rerenderLegendFromLastContext(): void {
    this.updateVelocityLegend(
      this.lastLegendEnabled,
      this.lastLegendSettings,
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
    const showCursorOverlay = this.isPointerInsideMap;

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
