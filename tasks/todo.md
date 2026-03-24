# Rich OD Metrics

- [x] Extend `weighted_od_graph` to emit OD metric catalogs and per-edge metric values.
- [x] Derive EMG OD metrics from `duree`, `heure_o`, `type_od`, `mode_principal`, `motif_o`, and `motif_d`.
- [x] Migrate analysis settings from one OD metric to independent color/rank and draw-order keys.
- [x] Draw visible OD edges in one globally sorted pass so heavy flows render on top.
- [x] Replace the OD metric toggle with catalog-driven `Color / Rank by` and `Draw on top by` selectors.
- [x] Keep legacy OD bundles compatible through runtime fallback to `weight` and `tripCount`.
- [x] Update bundle tests, sidebar regression, README, and project memo.
