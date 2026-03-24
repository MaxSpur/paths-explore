// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COLORMAP_ID } from "../src/colormaps";
import { SidebarView } from "../src/ui/sidebar";
import type { AppState, ImportSummary } from "../src/model/types";
import type { BundleState } from "../src/model/bundles";

function createSidebar(): SidebarView {
  const root = document.createElement("div");
  document.body.appendChild(root);

  return new SidebarView(root, {
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
    onMapBaseStyleChange: vi.fn(),
    onMapDarkenChange: vi.fn(),
    onMapDesaturateChange: vi.fn()
  });
}

describe("sidebar analysis integration", () => {
  it("rerenders cached state after track collapse without losing map controls", () => {
    const sidebar = createSidebar();
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
        odDrawOrderMetricKey: "weight"
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
    expect(document.querySelector<HTMLElement>("#map-darken-value")?.textContent).toBe("18%");
    expect(document.querySelector<HTMLElement>("#map-desaturate-value")?.textContent).toBe("22%");
  });
});
