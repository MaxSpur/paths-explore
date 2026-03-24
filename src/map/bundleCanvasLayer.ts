import L from "leaflet";
import { sampleColormapColor } from "../colormaps";
import type { BundleBounds, LoadedTrajectoryBundle } from "../model/bundles";
import { getOdEdgeMetricValue, isBundleBoundsValid, isOdEdgeBundle } from "../model/bundles";
import type { AnalysisMode, OdMetric } from "../model/types";

export interface BundleSelectionTarget {
  bundleId: string;
  trajectoryId: string;
}

interface BundleAnalysisContext {
  mode: AnalysisMode;
  colormapColors: Array<{ r: number; g: number; b: number }>;
  odMetric: OdMetric;
  selectedOdEdge?: BundleSelectionTarget;
}

function bundleBoundsToLeaflet(bounds: BundleBounds | undefined): L.LatLngBounds | null {
  if (!isBundleBoundsValid(bounds)) {
    return null;
  }

  return L.latLngBounds(
    [bounds.minLat, bounds.minLng],
    [bounds.maxLat, bounds.maxLng]
  );
}

function pointToSegmentDistanceSquared(point: L.Point, start: L.Point, end: L.Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    const deltaX = point.x - start.x;
    const deltaY = point.y - start.y;
    return deltaX * deltaX + deltaY * deltaY;
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))
  );
  const projectionX = start.x + t * dx;
  const projectionY = start.y + t * dy;
  const deltaX = point.x - projectionX;
  const deltaY = point.y - projectionY;
  return deltaX * deltaX + deltaY * deltaY;
}

export class BundleCanvasLayer extends L.Layer {
  private mapRef?: L.Map;
  private canvas?: HTMLCanvasElement;
  private bundles: LoadedTrajectoryBundle[] = [];
  private readonly hitTolerancePx: number;
  private analysisContext: BundleAnalysisContext = {
    mode: "off",
    colormapColors: [],
    odMetric: "weight"
  };

  constructor(hitTolerancePx = 10) {
    super();
    this.hitTolerancePx = hitTolerancePx;
  }

  onAdd(map: L.Map): this {
    this.mapRef = map;

    if (!this.canvas) {
      this.canvas = L.DomUtil.create("canvas", "bundle-canvas-layer") as HTMLCanvasElement;
      this.canvas.style.position = "absolute";
      this.canvas.style.inset = "0";
      this.canvas.style.pointerEvents = "none";
    }

    const pane = map.getPane("bundlePane") ?? map.getPane("overlayPane");
    if (!pane) {
      throw new Error("Missing bundle pane.");
    }

    pane.appendChild(this.canvas);
    map.on("moveend zoomend resize viewreset", this.redraw, this);
    this.redraw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("moveend zoomend resize viewreset", this.redraw, this);
    if (this.canvas?.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.mapRef = undefined;
    return this;
  }

  setBundles(bundles: LoadedTrajectoryBundle[]): void {
    this.bundles = bundles;
    this.redraw();
  }

  setAnalysisContext(context: BundleAnalysisContext): void {
    this.analysisContext = context;
    this.redraw();
  }

  getBoundsForBundle(bundleId: string): L.LatLngBounds | null {
    const bundle = this.bundles.find((candidate) => candidate.id === bundleId);
    if (!bundle) {
      return null;
    }

    return bundleBoundsToLeaflet(bundle.bundle.manifest.bounds);
  }

  getBoundsForVisibleBundles(): L.LatLngBounds | null {
    let merged: L.LatLngBounds | null = null;

    for (const bundle of this.bundles) {
      if (!bundle.visible) {
        continue;
      }

      const bounds = bundleBoundsToLeaflet(bundle.bundle.manifest.bounds);
      if (!bounds) {
        continue;
      }

      merged = merged ? merged.extend(bounds) : bounds;
    }

    return merged;
  }

  getBoundsForTrajectory(bundleId: string, trajectoryId: string): L.LatLngBounds | null {
    const bundle = this.bundles.find((candidate) => candidate.id === bundleId);
    if (!bundle) {
      return null;
    }

    const referenceBounds = bundle.bundle.trajectoryRefById.get(trajectoryId)?.bounds;
    const boundsFromReference = bundleBoundsToLeaflet(referenceBounds);
    if (boundsFromReference) {
      return boundsFromReference;
    }

    const trajectory = bundle.bundle.renderTrajectoryById.get(trajectoryId);
    if (!trajectory || trajectory.path.length === 0) {
      return null;
    }

    return L.latLngBounds(trajectory.path as L.LatLngBoundsLiteral);
  }

  findNearestTrajectory(
    latLng: L.LatLng,
    trajectoryKind: "path" | "od-edge"
  ): BundleSelectionTarget | null {
    if (!this.mapRef) {
      return null;
    }

    const clickPoint = this.mapRef.latLngToContainerPoint(latLng);
    const north = this.mapRef.containerPointToLatLng([
      clickPoint.x,
      clickPoint.y - this.hitTolerancePx
    ]);
    const south = this.mapRef.containerPointToLatLng([
      clickPoint.x,
      clickPoint.y + this.hitTolerancePx
    ]);
    const east = this.mapRef.containerPointToLatLng([
      clickPoint.x + this.hitTolerancePx,
      clickPoint.y
    ]);
    const west = this.mapRef.containerPointToLatLng([
      clickPoint.x - this.hitTolerancePx,
      clickPoint.y
    ]);
    const latPadding = Math.max(Math.abs(north.lat - latLng.lat), Math.abs(south.lat - latLng.lat));
    const lngPadding = Math.max(Math.abs(east.lng - latLng.lng), Math.abs(west.lng - latLng.lng));

    let bestMatch: BundleSelectionTarget | null = null;
    let bestDistanceSquared = this.hitTolerancePx * this.hitTolerancePx;

    for (const bundle of this.bundles) {
      const bundleIsOd = isOdEdgeBundle(bundle);
      const matchesKind = trajectoryKind === "od-edge" ? bundleIsOd : !bundleIsOd;
      if (!bundle.visible || !matchesKind || (trajectoryKind === "path" && !bundle.extractionEnabled)) {
        continue;
      }

      for (const trajectory of bundle.bundle.renderTrajectories) {
        const reference = bundle.bundle.trajectoryRefById.get(trajectory.id);
        if (
          reference?.bounds &&
          (latLng.lat < reference.bounds.minLat - latPadding ||
            latLng.lat > reference.bounds.maxLat + latPadding ||
            latLng.lng < reference.bounds.minLng - lngPadding ||
            latLng.lng > reference.bounds.maxLng + lngPadding)
        ) {
          continue;
        }

        for (let index = 0; index < trajectory.path.length - 1; index += 1) {
          const start = trajectory.path[index];
          const end = trajectory.path[index + 1];
          if (!start || !end) {
            continue;
          }

          const startPoint = this.mapRef.latLngToContainerPoint(start);
          const endPoint = this.mapRef.latLngToContainerPoint(end);
          const distanceSquared = pointToSegmentDistanceSquared(clickPoint, startPoint, endPoint);

          if (distanceSquared <= bestDistanceSquared) {
            bestDistanceSquared = distanceSquared;
            bestMatch = {
              bundleId: bundle.id,
              trajectoryId: trajectory.id
            };
          }
        }
      }
    }

    return bestMatch;
  }

  private redraw = (): void => {
    if (!this.mapRef || !this.canvas) {
      return;
    }

    const size = this.mapRef.getSize();
    const topLeft = this.mapRef.containerPointToLayerPoint([0, 0]);
    const devicePixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(size.x * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(size.y * devicePixelRatio));
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, topLeft);

    const context = this.canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    const odScaleMax = this.getVisibleOdMetricScaleMax();

    for (const bundle of this.bundles) {
      if (!bundle.visible) {
        continue;
      }

      this.drawTrajectories(context, bundle, odScaleMax);

      if (bundle.overlaysVisible) {
        this.drawOverlays(context, bundle);
      }
    }
  };

  private drawTrajectories(
    context: CanvasRenderingContext2D,
    bundle: LoadedTrajectoryBundle,
    odScaleMax: number
  ): void {
    if (!this.mapRef) {
      return;
    }

    const trajectories = bundle.bundle.renderTrajectories.filter(
      (trajectory) => trajectory.path.length >= 2
    );
    if (trajectories.length === 0) {
      return;
    }

    if (this.analysisContext.mode !== "od" || !isOdEdgeBundle(bundle) || odScaleMax <= 0) {
      context.save();
      context.beginPath();
      context.lineWidth = 1.35;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = bundle.color;
      context.globalAlpha = isOdEdgeBundle(bundle) ? 0.34 : 0.53;

      for (const trajectory of trajectories) {
        this.traceTrajectoryPath(context, trajectory.path);
      }

      context.stroke();
      context.restore();
      return;
    }

    const selectedTarget = this.analysisContext.selectedOdEdge;
    const selectedId =
      selectedTarget && selectedTarget.bundleId === bundle.id ? selectedTarget.trajectoryId : undefined;

    for (const trajectory of trajectories) {
      if (trajectory.id === selectedId) {
        continue;
      }

      context.save();
      context.beginPath();
      context.lineWidth = 2.15;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = this.getOdEdgeStrokeColor(bundle, trajectory.id, odScaleMax);
      context.globalAlpha = 0.72;
      this.traceTrajectoryPath(context, trajectory.path);
      context.stroke();
      context.restore();
    }

    if (!selectedId) {
      return;
    }

    const selectedTrajectory = bundle.bundle.renderTrajectoryById.get(selectedId);
    if (!selectedTrajectory || selectedTrajectory.path.length < 2) {
      return;
    }

    context.save();
    context.beginPath();
    context.lineWidth = 7.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(12, 18, 24, 0.9)";
    context.globalAlpha = 1;
    this.traceTrajectoryPath(context, selectedTrajectory.path);
    context.stroke();
    context.restore();

    context.save();
    context.beginPath();
    context.lineWidth = 4.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = this.getOdEdgeStrokeColor(bundle, selectedId, odScaleMax);
    context.globalAlpha = 1;
    this.traceTrajectoryPath(context, selectedTrajectory.path);
    context.stroke();
    context.restore();
  }

  private drawOverlays(context: CanvasRenderingContext2D, bundle: LoadedTrajectoryBundle): void {
    if (!this.mapRef) {
      return;
    }

    for (const layer of bundle.bundle.overlays) {
      if (layer.geometryType === "polygon") {
        context.save();
        context.beginPath();
        context.fillStyle = `${bundle.color}18`;
        context.strokeStyle = `${bundle.color}55`;
        context.lineWidth = 1;

        for (const feature of layer.features) {
          if (feature.kind !== "polygon") {
            continue;
          }

          for (const ring of feature.rings) {
            ring.forEach(([lat, lng], index) => {
              const point = this.mapRef!.latLngToLayerPoint([lat, lng]);
              const canvasPoint = this.mapRef!.latLngToContainerPoint([lat, lng]);
              if (index === 0) {
                context.moveTo(canvasPoint.x, canvasPoint.y);
              } else {
                context.lineTo(canvasPoint.x, canvasPoint.y);
              }
            });
            context.closePath();
          }
        }

        context.fill("evenodd");
        context.stroke();
        context.restore();
        continue;
      }

      context.save();
      context.fillStyle = `${bundle.color}6b`;

      for (const feature of layer.features) {
        if (feature.kind !== "point") {
          continue;
        }

        const [lat, lng] = feature.coordinates;
        const point = this.mapRef.latLngToContainerPoint([lat, lng]);
        context.beginPath();
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        context.fill();
      }

      context.restore();
    }
  }

  private getVisibleOdMetricScaleMax(): number {
    if (this.analysisContext.mode !== "od") {
      return 0;
    }

    let maxMetric = 0;
    for (const bundle of this.bundles) {
      if (!bundle.visible || !isOdEdgeBundle(bundle)) {
        continue;
      }

      for (const trajectory of bundle.bundle.renderTrajectories) {
        const value = getOdEdgeMetricValue(
          bundle.bundle,
          trajectory.id,
          this.analysisContext.odMetric
        );
        if (value && value > maxMetric) {
          maxMetric = value;
        }
      }
    }

    return maxMetric;
  }

  private getOdEdgeStrokeColor(
    bundle: LoadedTrajectoryBundle,
    trajectoryId: string,
    scaleMax: number
  ): string {
    const value = getOdEdgeMetricValue(
      bundle.bundle,
      trajectoryId,
      this.analysisContext.odMetric
    );
    const normalized = scaleMax > 0 && value ? Math.max(0, Math.min(1, value / scaleMax)) : 0;
    if (this.analysisContext.colormapColors.length === 0) {
      return bundle.color;
    }

    return sampleColormapColor(this.analysisContext.colormapColors, normalized);
  }

  private traceTrajectoryPath(
    context: CanvasRenderingContext2D,
    path: Array<[lat: number, lng: number]>
  ): void {
    if (!this.mapRef || path.length < 2) {
      return;
    }

    for (let index = 0; index < path.length; index += 1) {
      const [lat, lng] = path[index];
      const point = this.mapRef.latLngToContainerPoint([lat, lng]);

      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    }
  }
}
