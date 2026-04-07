// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COLORMAP_ID } from "../src/colormaps";
import { SidebarView } from "../src/ui/sidebar";
import type { AppState, ImportSummary } from "../src/model/types";
import type { BundleState } from "../src/model/bundles";

function createSidebar() {
  const root = document.createElement("div");
  document.body.appendChild(root);

  const callbacks = {
    onImportFiles: async () => undefined,
    onToggleVisibility: vi.fn(),
    onToggleBundleVisibility: vi.fn(),
    onToggleBundleOverlays: vi.fn(),
    onToggleBundleExtraction: vi.fn(),
    onTogglePoints: vi.fn(),
    onToggleSegments: vi.fn(),
    onMoveTrackUp: vi.fn(),
    onMoveTrackDown: vi.fn(),
    onFocusTrack: vi.fn(),
    onFocusBundle: vi.fn(),
    onExportTrack: vi.fn(),
    onDeleteTrack: vi.fn(),
    onDeleteBundle: vi.fn(),
    onToggleEdit: vi.fn(),
    onEditModeChange: vi.fn(),
    onAnalysisModeChange: vi.fn(),
    onAnalysisVelocityScaleModeChange: vi.fn(),
    onAnalysisVelocityFixedMaxChange: vi.fn(),
    onAnalysisColormapChange: vi.fn(),
    onAnalysisOdColorMetricKeyChange: vi.fn(),
    onAnalysisOdDrawOrderMetricKeyChange: vi.fn(),
    onAnalysisOdLinkMetricSelectionsChange: vi.fn(),
    onAnalysisOdLinkVariantValueSelectionsChange: vi.fn(),
    onMapBaseStyleChange: vi.fn(),
    onMapDarkenChange: vi.fn(),
    onMapDesaturateChange: vi.fn()
  };

  return {
    root,
    callbacks,
    sidebar: new SidebarView(root, callbacks)
  };
}

describe("sidebar analysis integration", () => {
  it("rerenders cached state after track collapse without losing map controls", () => {
    const { sidebar } = createSidebar();
    const state: AppState = {
      tracks: [
        {
          id: "track-1",
          name: "Track 1",
          sourceFile: "track-1.gpx",
          format: "gpx",
          color: "#2274a5",
          visible: true,
          showSegments: true,
          showPoints: false,
          points: [
            { id: "p1", lat: 48.85, lng: 2.35 },
            { id: "p2", lat: 48.86, lng: 2.36 }
          ]
        }
      ],
      selectedPointIds: []
    };
    const bundleState: BundleState = { bundles: [] };
    const summary: ImportSummary | undefined = undefined;

    sidebar.render(
      state,
      bundleState,
      summary,
      undefined,
      "move",
      {
        mode: "od",
        colormapId: DEFAULT_COLORMAP_ID,
        velocityScaleMode: "auto",
        velocityFixedMax: 60,
        odColorMetricKey: "weight",
        odDrawOrderMetricKey: "weight",
        odLinkMetricSelections: false,
        odLinkVariantValueSelections: false
      },
      25,
      {
        baseStyle: "carto-light",
        darkenPercent: 18,
        desaturatePercent: 22
      }
    );

    const collapseButton = document.querySelector<HTMLButtonElement>(
      'button[data-action="toggle-collapse"][data-track-id="track-1"]'
    );
    expect(collapseButton).not.toBeNull();

    expect(() => {
      collapseButton?.click();
    }).not.toThrow();

    const mapStyleSelect = document.querySelector<HTMLSelectElement>('select[data-action="map-style"]');
    expect(mapStyleSelect?.value).toBe("carto-light");
    expect(document.querySelector<HTMLElement>("#map-darken-value")?.textContent).toBe("Darken 18%");
    expect(document.querySelector<HTMLElement>("#map-desaturate-value")?.textContent).toBe("22%");
  });

  it("shows lighten, darken, and neutral labels for the signed brightness slider", () => {
    const { sidebar, root } = createSidebar();
    const state: AppState = { tracks: [], selectedPointIds: [] };
    const bundleState: BundleState = { bundles: [] };

    sidebar.render(
      state,
      bundleState,
      undefined,
      undefined,
      "move",
      {
        mode: "off",
        colormapId: DEFAULT_COLORMAP_ID,
        velocityScaleMode: "auto",
        velocityFixedMax: 60,
        odColorMetricKey: "weight",
        odDrawOrderMetricKey: "weight",
        odLinkMetricSelections: false,
        odLinkVariantValueSelections: false
      },
      0,
      {
        baseStyle: "osm-standard",
        darkenPercent: -24,
        desaturatePercent: 0
      }
    );

    const darkenInput = root.querySelector<HTMLInputElement>('input[data-action="map-darken"]');
    expect(darkenInput?.value).toBe("-24");
    expect(root.querySelector<HTMLElement>("#map-darken-value")?.textContent).toBe("Lighten 24%");

    sidebar.render(
      state,
      bundleState,
      undefined,
      undefined,
      "move",
      {
        mode: "off",
        colormapId: DEFAULT_COLORMAP_ID,
        velocityScaleMode: "auto",
        velocityFixedMax: 60,
        odColorMetricKey: "weight",
        odDrawOrderMetricKey: "weight",
        odLinkMetricSelections: false,
        odLinkVariantValueSelections: false
      },
      0,
      {
        baseStyle: "osm-standard",
        darkenPercent: 0,
        desaturatePercent: 0
      }
    );

    expect(root.querySelector<HTMLElement>("#map-darken-value")?.textContent).toBe("Neutral");
  });

  it("snaps small brightness slider adjustments back to neutral", () => {
    const { sidebar, root, callbacks } = createSidebar();
    const state: AppState = { tracks: [], selectedPointIds: [] };
    const bundleState: BundleState = { bundles: [] };

    sidebar.render(
      state,
      bundleState,
      undefined,
      undefined,
      "move",
      {
        mode: "off",
        colormapId: DEFAULT_COLORMAP_ID,
        velocityScaleMode: "auto",
        velocityFixedMax: 60,
        odColorMetricKey: "weight",
        odDrawOrderMetricKey: "weight",
        odLinkMetricSelections: false,
        odLinkVariantValueSelections: false
      },
      0,
      {
        baseStyle: "osm-standard",
        darkenPercent: 0,
        desaturatePercent: 0
      }
    );

    const darkenInput = root.querySelector<HTMLInputElement>('input[data-action="map-darken"]');
    expect(darkenInput).not.toBeNull();

    darkenInput!.value = "6";
    darkenInput!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(callbacks.onMapDarkenChange).toHaveBeenCalledWith(0);
    expect(darkenInput!.value).toBe("0");
    expect(root.querySelector<HTMLElement>("#map-darken-value")?.textContent).toBe("Neutral");
  });

  it("links OD draw-order changes to color metric when metric linking is enabled", () => {
    const { sidebar, root, callbacks } = createSidebar();
    const state: AppState = { tracks: [], selectedPointIds: [] };
    const bundleState: BundleState = { bundles: [] };

    sidebar.render(
      state,
      bundleState,
      undefined,
      undefined,
      "move",
      {
        mode: "od",
        colormapId: DEFAULT_COLORMAP_ID,
        velocityScaleMode: "auto",
        velocityFixedMax: 60,
        odColorMetricKey: "weight",
        odDrawOrderMetricKey: "weight",
        odLinkMetricSelections: true,
        odLinkVariantValueSelections: false
      },
      0,
      {
        baseStyle: "osm-standard",
        darkenPercent: 0,
        desaturatePercent: 0
      }
    );

    const drawSourceSelect = root.querySelector<HTMLSelectElement>(
      'select[data-action="analysis-od-draw-source"]'
    );
    expect(drawSourceSelect).not.toBeNull();
    drawSourceSelect!.value = "tripCount";
    drawSourceSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(callbacks.onAnalysisOdDrawOrderMetricKeyChange).toHaveBeenCalledWith("tripCount");
    expect(callbacks.onAnalysisOdColorMetricKeyChange).toHaveBeenCalledWith("tripCount");
  });
});
