#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

try:
    import pyarrow.parquet as pq
except ImportError as exc:  # pragma: no cover - exercised at runtime
    raise SystemExit(
        "pyarrow is required for parquet conversion. Install it with `python3 -m pip install pyarrow`."
    ) from exc


EARTH_RADIUS_METERS = 6_371_008.8


@dataclass(frozen=True)
class Bounds:
    min_lat: float
    min_lng: float
    max_lat: float
    max_lng: float

    def to_json(self) -> dict[str, float]:
        return {
            "minLat": self.min_lat,
            "minLng": self.min_lng,
            "maxLat": self.max_lat,
            "maxLng": self.max_lng,
        }


def to_json_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return value.hex()
    if hasattr(value, "as_py"):
        return to_json_scalar(value.as_py())
    return str(value)


def ensure_float(value: Any, field_name: str) -> float:
    if value is None:
        raise ValueError(f"Missing required numeric field `{field_name}`.")

    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Field `{field_name}` must be numeric, got {value!r}.") from exc

    if not math.isfinite(parsed):
        raise ValueError(f"Field `{field_name}` must be finite, got {value!r}.")

    return parsed


def optional_float(value: Any, default: float, field_name: str) -> float:
    if value is None:
        return default
    return ensure_float(value, field_name)


def normalize_sort_token(value: Any) -> tuple[int, str, float | str]:
    if value is None:
        return (1, "none", "")
    if isinstance(value, (int, float)):
        return (0, "number", float(value))
    if isinstance(value, (datetime, date, time)):
        return (0, "string", value.isoformat())
    if hasattr(value, "as_py"):
        return normalize_sort_token(value.as_py())
    return (0, "string", str(value))


def update_bounds(bounds: Bounds | None, lat: float, lng: float) -> Bounds:
    if bounds is None:
        return Bounds(lat, lng, lat, lng)

    return Bounds(
        min(bounds.min_lat, lat),
        min(bounds.min_lng, lng),
        max(bounds.max_lat, lat),
        max(bounds.max_lng, lng),
    )


def merge_bounds(left: Bounds | None, right: Bounds | None) -> Bounds | None:
    if left is None:
        return right
    if right is None:
        return left
    return Bounds(
        min(left.min_lat, right.min_lat),
        min(left.min_lng, right.min_lng),
        max(left.max_lat, right.max_lat),
        max(left.max_lng, right.max_lng),
    )


def bounds_from_points(points: list[tuple[float, float]]) -> Bounds | None:
    bounds: Bounds | None = None
    for lat, lng in points:
        bounds = update_bounds(bounds, lat, lng)
    return bounds


def project_point(lat: float, lng: float, ref_lat: float) -> tuple[float, float]:
    return (
        math.radians(lng) * EARTH_RADIUS_METERS * math.cos(math.radians(ref_lat)),
        math.radians(lat) * EARTH_RADIUS_METERS,
    )


def point_segment_distance_meters(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    ref_lat = (point[0] + start[0] + end[0]) / 3.0
    px, py = project_point(point[0], point[1], ref_lat)
    sx, sy = project_point(start[0], start[1], ref_lat)
    ex, ey = project_point(end[0], end[1], ref_lat)
    dx = ex - sx
    dy = ey - sy

    if dx == 0.0 and dy == 0.0:
        return math.hypot(px - sx, py - sy)

    t = max(0.0, min(1.0, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)))
    proj_x = sx + t * dx
    proj_y = sy + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def simplify_points(points: list[tuple[float, float]], tolerance_meters: float) -> list[tuple[float, float]]:
    if tolerance_meters <= 0 or len(points) <= 2:
        return points[:]

    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True

    def recurse(start_index: int, end_index: int) -> None:
        max_distance = 0.0
        split_index = -1
        start = points[start_index]
        end = points[end_index]

        for candidate_index in range(start_index + 1, end_index):
            distance = point_segment_distance_meters(points[candidate_index], start, end)
            if distance > max_distance:
                max_distance = distance
                split_index = candidate_index

        if split_index >= 0 and max_distance > tolerance_meters:
            keep[split_index] = True
            recurse(start_index, split_index)
            recurse(split_index, end_index)

    recurse(0, len(points) - 1)
    return [point for index, point in enumerate(points) if keep[index]]


class WkbReader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def read_geometry(self) -> dict[str, Any]:
        if self.offset >= len(self.data):
            raise ValueError("Unexpected end of WKB data.")

        byte_order = self.data[self.offset]
        endian = "<" if byte_order == 1 else ">"
        self.offset += 1
        geometry_type = struct.unpack_from(f"{endian}I", self.data, self.offset)[0]
        self.offset += 4
        base_type = (geometry_type & 0x0FFFFFFF) % 1000

        if base_type == 1:
            return self.read_point(endian)
        if base_type == 3:
            return self.read_polygon(endian)
        if base_type == 6:
            return self.read_multi_polygon()

        raise ValueError(f"Unsupported WKB geometry type {geometry_type}.")

    def read_point(self, endian: str) -> dict[str, Any]:
        x, y = struct.unpack_from(f"{endian}dd", self.data, self.offset)
        self.offset += 16
        return {"kind": "point", "coordinates": (y, x)}

    def read_polygon(self, endian: str) -> dict[str, Any]:
        ring_count = struct.unpack_from(f"{endian}I", self.data, self.offset)[0]
        self.offset += 4
        rings: list[list[tuple[float, float]]] = []
        for _ in range(ring_count):
            point_count = struct.unpack_from(f"{endian}I", self.data, self.offset)[0]
            self.offset += 4
            ring: list[tuple[float, float]] = []
            for _ in range(point_count):
                x, y = struct.unpack_from(f"{endian}dd", self.data, self.offset)
                self.offset += 16
                ring.append((y, x))
            rings.append(ring)
        return {"kind": "polygon", "rings": rings}

    def read_multi_polygon(self) -> dict[str, Any]:
        endian = "<" if self.data[self.offset - 5] == 1 else ">"
        polygon_count = struct.unpack_from(f"{endian}I", self.data, self.offset)[0]
        self.offset += 4
        polygons: list[list[list[tuple[float, float]]]] = []
        for _ in range(polygon_count):
            geometry = self.read_geometry()
            if geometry["kind"] != "polygon":
                raise ValueError("MultiPolygon contained a non-polygon geometry.")
            polygons.append(geometry["rings"])
        return {"kind": "multi_polygon", "polygons": polygons}


def decode_wkb(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, memoryview):
        raw = value.tobytes()
    elif isinstance(value, bytearray):
        raw = bytes(value)
    elif isinstance(value, bytes):
        raw = value
    elif hasattr(value, "as_py"):
        return decode_wkb(value.as_py())
    else:
        raise ValueError(f"Unsupported geometry payload type: {type(value)!r}")

    return WkbReader(raw).read_geometry()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    output = []
    last_dash = False
    for char in lowered:
        if char.isalnum():
            output.append(char)
            last_dash = False
        elif not last_dash:
            output.append("-")
            last_dash = True
    slug = "".join(output).strip("-")
    return slug or "bundle"


def table_to_rows(path: Path, columns: list[str]) -> list[dict[str, Any]]:
    table = pq.read_table(path, columns=columns)
    return table.to_pylist()


def select_trajectory_groups(
    groups: list[dict[str, Any]],
    trajectory_limit: int | None,
    sampling_mode: str,
) -> list[dict[str, Any]]:
    if trajectory_limit is None or trajectory_limit >= len(groups):
        return groups

    if trajectory_limit <= 0:
        raise ValueError("`trajectory_limit` must be a positive integer.")

    if sampling_mode == "first":
        return groups[:trajectory_limit]

    if sampling_mode != "decimate":
        raise ValueError(
            f"Unsupported `trajectory_sampling_mode`: {sampling_mode!r}. Use `decimate` or `first`."
        )

    if trajectory_limit == 1:
        return [groups[len(groups) // 2]]

    last_index = len(groups) - 1
    selected_indexes = [
        round((sample_index * last_index) / (trajectory_limit - 1))
        for sample_index in range(trajectory_limit)
    ]
    return [groups[group_index] for group_index in selected_indexes]


def select_weighted_edges(
    edges: list[dict[str, Any]],
    edge_limit: int | None,
    sampling_mode: str,
) -> list[dict[str, Any]]:
    if edge_limit is None or edge_limit >= len(edges):
        return edges

    if edge_limit <= 0:
        raise ValueError("`edge_limit` must be a positive integer.")

    if sampling_mode == "top_weight":
        return edges[:edge_limit]

    if sampling_mode != "decimate":
        raise ValueError(
            f"Unsupported `edge_sampling_mode`: {sampling_mode!r}. Use `top_weight` or `decimate`."
        )

    if edge_limit == 1:
        return [edges[0]]

    last_index = len(edges) - 1
    selected_indexes = [
        round((sample_index * last_index) / (edge_limit - 1))
        for sample_index in range(edge_limit)
    ]
    return [edges[edge_index] for edge_index in selected_indexes]


def decode_point_geometry(value: Any, field_name: str) -> tuple[float, float] | None:
    geometry = decode_wkb(value)
    if geometry is None:
        return None
    if geometry["kind"] != "point":
        raise ValueError(f"Field `{field_name}` must contain WKB Point geometry.")
    return geometry["coordinates"]


def build_trajectory_input(
    input_config: dict[str, Any],
    simplification_tolerance_meters: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], Bounds | None]:
    path = Path(str(input_config["path"]))
    trajectory_id_column = str(input_config["trajectory_id_column"])
    lat_column = str(input_config["lat_column"])
    lng_column = str(input_config["lng_column"])
    order_column = input_config.get("order_column")
    time_column = input_config.get("time_column")
    elevation_column = input_config.get("elevation_column")
    name_column = input_config.get("name_column")
    metadata_columns = [str(column) for column in input_config.get("metadata_columns", [])]
    trajectory_limit_raw = input_config.get("trajectory_limit")
    trajectory_limit = (
        int(trajectory_limit_raw) if trajectory_limit_raw is not None else None
    )
    trajectory_sampling_mode = str(input_config.get("trajectory_sampling_mode", "decimate"))

    selected_columns = [trajectory_id_column, lat_column, lng_column]
    for optional_column in [
        order_column,
        time_column,
        elevation_column,
        name_column,
        *metadata_columns,
    ]:
        if optional_column and optional_column not in selected_columns:
            selected_columns.append(str(optional_column))

    rows = table_to_rows(path, selected_columns)
    grouped_rows: dict[str, dict[str, Any]] = {}

    for index, row in enumerate(rows):
        raw_trajectory_id = row.get(trajectory_id_column)
        if raw_trajectory_id is None:
            continue

        trajectory_id = str(raw_trajectory_id)
        lat = ensure_float(row.get(lat_column), lat_column)
        lng = ensure_float(row.get(lng_column), lng_column)
        time_value = row.get(time_column) if time_column else None
        elevation_value = row.get(elevation_column) if elevation_column else None
        name_value = row.get(name_column) if name_column else None

        properties = {
            column: to_json_scalar(row.get(column))
            for column in metadata_columns
            if to_json_scalar(row.get(column)) is not None
        }

        group = grouped_rows.setdefault(
            trajectory_id,
            {
                "id": trajectory_id,
                "name": str(name_value) if name_value not in (None, "") else trajectory_id,
                "properties": properties,
                "entries": [],
            },
        )
        if group["name"] == trajectory_id and name_value not in (None, ""):
            group["name"] = str(name_value)
        if properties and not group["properties"]:
            group["properties"] = properties

        group["entries"].append(
            (
                (
                    normalize_sort_token(row.get(order_column) if order_column else None),
                    normalize_sort_token(time_value),
                    index,
                ),
                {
                    "lat": lat,
                    "lng": lng,
                    **({"ele": ensure_float(elevation_value, str(elevation_column))} if elevation_value is not None else {}),
                    **({"time": to_json_scalar(time_value)} if time_value is not None else {}),
                },
            )
        )

    manifest_refs: list[dict[str, Any]] = []
    render_trajectories: list[dict[str, Any]] = []
    extraction_trajectories: list[dict[str, Any]] = []
    overall_bounds: Bounds | None = None

    selected_groups = select_trajectory_groups(
        list(grouped_rows.values()),
        trajectory_limit,
        trajectory_sampling_mode,
    )

    for group in selected_groups:
        sorted_points = [entry for _, entry in sorted(group["entries"], key=lambda item: item[0])]
        if len(sorted_points) < 2:
            continue

        latlng_points = [(point["lat"], point["lng"]) for point in sorted_points]
        simplified = simplify_points(latlng_points, simplification_tolerance_meters)
        bounds = bounds_from_points(latlng_points)
        overall_bounds = merge_bounds(overall_bounds, bounds)

        manifest_refs.append(
            {
                "id": group["id"],
                "name": group["name"],
                "pointCount": len(sorted_points),
                "simplifiedPointCount": len(simplified),
                **({"bounds": bounds.to_json()} if bounds else {}),
                **({"properties": group["properties"]} if group["properties"] else {}),
            }
        )
        render_trajectories.append({"id": group["id"], "path": simplified})
        extraction_trajectories.append(
            {
                "id": group["id"],
                "name": group["name"],
                "points": sorted_points,
                **({"properties": group["properties"]} if group["properties"] else {}),
            }
        )

    return manifest_refs, render_trajectories, extraction_trajectories, overall_bounds


def build_weighted_od_input(
    input_config: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], Bounds | None]:
    path = Path(str(input_config["path"]))
    origin_code_column = str(input_config["origin_code_column"])
    destination_code_column = str(input_config["destination_code_column"])
    centroid_column = str(input_config.get("centroid_column", input_config.get("origin_centroid_column", "centroid_o")))
    origin_name_column = input_config.get("origin_name_column")
    destination_name_column = input_config.get("destination_name_column")
    weight_column = input_config.get("weight_column")
    edge_limit_raw = input_config.get("edge_limit")
    edge_limit = int(edge_limit_raw) if edge_limit_raw is not None else None
    edge_sampling_mode = str(input_config.get("edge_sampling_mode", "top_weight"))
    minimum_weight_raw = input_config.get("minimum_weight")
    minimum_weight = (
        ensure_float(minimum_weight_raw, "minimum_weight")
        if minimum_weight_raw is not None
        else None
    )
    exclude_self_loops = bool(input_config.get("exclude_self_loops", True))

    selected_columns = [origin_code_column, destination_code_column, centroid_column]
    for optional_column in [origin_name_column, destination_name_column, weight_column]:
        if optional_column and str(optional_column) not in selected_columns:
            selected_columns.append(str(optional_column))

    rows = table_to_rows(path, selected_columns)

    centroid_lookup: dict[str, dict[str, Any]] = {}
    for row in rows:
        raw_origin_code = row.get(origin_code_column)
        if raw_origin_code in (None, ""):
            continue

        coordinates = decode_point_geometry(row.get(centroid_column), centroid_column)
        if coordinates is None:
            continue

        origin_code = str(raw_origin_code)
        centroid_lookup.setdefault(
            origin_code,
            {
                "coordinates": coordinates,
                "name": (
                    str(row.get(origin_name_column))
                    if origin_name_column and row.get(origin_name_column) not in (None, "")
                    else origin_code
                ),
            },
        )

    edges_by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        raw_origin_code = row.get(origin_code_column)
        raw_destination_code = row.get(destination_code_column)
        if raw_origin_code in (None, "") or raw_destination_code in (None, ""):
            continue

        origin_code = str(raw_origin_code)
        destination_code = str(raw_destination_code)
        origin = centroid_lookup.get(origin_code)
        destination = centroid_lookup.get(destination_code)
        if origin is None or destination is None:
            continue

        origin_coordinates = origin["coordinates"]
        destination_coordinates = destination["coordinates"]
        if exclude_self_loops and origin_coordinates == destination_coordinates:
            continue

        origin_name = (
            str(row.get(origin_name_column))
            if origin_name_column and row.get(origin_name_column) not in (None, "")
            else origin["name"]
        )
        destination_name = (
            str(row.get(destination_name_column))
            if destination_name_column and row.get(destination_name_column) not in (None, "")
            else destination.get("name", destination_code)
        )
        edge_id = f"od-{origin_code}-{destination_code}"
        edge = edges_by_id.setdefault(
            edge_id,
            {
                "id": edge_id,
                "name": f"{origin_name} -> {destination_name}",
                "originCode": origin_code,
                "originName": origin_name,
                "destinationCode": destination_code,
                "destinationName": destination_name,
                "originCoordinates": origin_coordinates,
                "destinationCoordinates": destination_coordinates,
                "weight": 0.0,
                "tripCount": 0,
            },
        )
        if edge["originName"] == origin_code and origin_name != origin_code:
            edge["originName"] = origin_name
        if edge["destinationName"] == destination_code and destination_name != destination_code:
            edge["destinationName"] = destination_name
        edge["name"] = f"{edge['originName']} -> {edge['destinationName']}"
        edge["weight"] += optional_float(
            row.get(weight_column) if weight_column else None,
            0.0 if weight_column else 1.0,
            str(weight_column) if weight_column else "weight",
        )
        edge["tripCount"] += 1

    weighted_edges = list(edges_by_id.values())
    weighted_edges.sort(key=lambda edge: (-edge["weight"], edge["id"]))

    if minimum_weight is not None:
        weighted_edges = [edge for edge in weighted_edges if edge["weight"] >= minimum_weight]

    selected_edges = select_weighted_edges(weighted_edges, edge_limit, edge_sampling_mode)

    manifest_refs: list[dict[str, Any]] = []
    render_trajectories: list[dict[str, Any]] = []
    extraction_trajectories: list[dict[str, Any]] = []
    overall_bounds: Bounds | None = None

    for edge in selected_edges:
        path_points = [edge["originCoordinates"], edge["destinationCoordinates"]]
        bounds = bounds_from_points(path_points)
        overall_bounds = merge_bounds(overall_bounds, bounds)
        properties = {
            "weight": edge["weight"],
            "tripCount": edge["tripCount"],
            "originCode": edge["originCode"],
            "originName": edge["originName"],
            "destinationCode": edge["destinationCode"],
            "destinationName": edge["destinationName"],
        }

        manifest_refs.append(
            {
                "id": edge["id"],
                "name": edge["name"],
                "pointCount": 2,
                "simplifiedPointCount": 2,
                **({"bounds": bounds.to_json()} if bounds else {}),
                "properties": properties,
            }
        )
        render_trajectories.append(
            {
                "id": edge["id"],
                "path": path_points,
            }
        )
        extraction_trajectories.append(
            {
                "id": edge["id"],
                "name": edge["name"],
                "points": [
                    {"lat": path_points[0][0], "lng": path_points[0][1]},
                    {"lat": path_points[1][0], "lng": path_points[1][1]},
                ],
                "properties": properties,
            }
        )

    return manifest_refs, render_trajectories, extraction_trajectories, overall_bounds


def load_geo_metadata(path: Path) -> dict[str, Any]:
    schema = pq.read_schema(path)
    metadata = schema.metadata or {}
    raw_geo = metadata.get(b"geo")
    if not raw_geo:
        return {}
    return json.loads(raw_geo.decode("utf-8"))


def infer_geometry_columns(path: Path, input_config: dict[str, Any]) -> list[str]:
    configured = input_config.get("geometry_columns")
    if configured:
        return [str(column) for column in configured]

    geo_metadata = load_geo_metadata(path)
    columns = geo_metadata.get("columns")
    if isinstance(columns, dict) and columns:
        return [str(column_name) for column_name in columns.keys()]

    raise ValueError(
        f"No geometry columns configured for {path}. Add `geometry_columns` or use GeoParquet metadata."
    )


def geometry_column_kind(path: Path, geometry_column: str) -> str:
    geo_metadata = load_geo_metadata(path)
    column_metadata = geo_metadata.get("columns", {}).get(geometry_column, {})
    geometry_types = column_metadata.get("geometry_types", []) or []
    if any(geometry_type == "Point" for geometry_type in geometry_types):
        return "point"
    if any(geometry_type in {"Polygon", "MultiPolygon"} for geometry_type in geometry_types):
        return "polygon"
    return "polygon" if geometry_column.startswith("geom") else "point"


def feature_id_for_row(row: dict[str, Any], feature_id_column: str | None, fallback: str) -> str:
    if feature_id_column:
        value = row.get(feature_id_column)
        if value not in (None, ""):
            return str(value)
    return fallback


def build_overlay_input(
    input_config: dict[str, Any],
    input_index: int,
) -> tuple[list[dict[str, Any]], Bounds | None]:
    path = Path(str(input_config["path"]))
    geometry_columns = infer_geometry_columns(path, input_config)
    metadata_columns = [str(column) for column in input_config.get("metadata_columns", [])]
    feature_id_column = input_config.get("feature_id_column")
    layer_name_prefix = str(input_config.get("layer_name_prefix", path.stem))

    selected_columns = list(geometry_columns)
    if feature_id_column and str(feature_id_column) not in selected_columns:
        selected_columns.append(str(feature_id_column))
    for metadata_column in metadata_columns:
        if metadata_column not in selected_columns:
            selected_columns.append(metadata_column)

    rows = table_to_rows(path, selected_columns)
    layers: list[dict[str, Any]] = []
    overall_bounds: Bounds | None = None

    for geometry_column in geometry_columns:
        geometry_kind = geometry_column_kind(path, geometry_column)
        features: list[dict[str, Any]] = []
        layer_bounds: Bounds | None = None

        for row_index, row in enumerate(rows):
            decoded_geometry = decode_wkb(row.get(geometry_column))
            if decoded_geometry is None:
                continue

            properties = {
                column: to_json_scalar(row.get(column))
                for column in metadata_columns
                if to_json_scalar(row.get(column)) is not None
            }
            feature_base_id = feature_id_for_row(
                row,
                str(feature_id_column) if feature_id_column else None,
                f"{geometry_column}-{row_index}",
            )

            if decoded_geometry["kind"] == "point":
                lat, lng = decoded_geometry["coordinates"]
                layer_bounds = update_bounds(layer_bounds, lat, lng)
                features.append(
                    {
                        "id": feature_base_id,
                        "kind": "point",
                        "coordinates": [lat, lng],
                        **({"properties": properties} if properties else {}),
                    }
                )
                continue

            polygons = (
                [decoded_geometry["rings"]]
                if decoded_geometry["kind"] == "polygon"
                else decoded_geometry["polygons"]
            )
            for polygon_index, rings in enumerate(polygons):
                for ring in rings:
                    for lat, lng in ring:
                        layer_bounds = update_bounds(layer_bounds, lat, lng)

                features.append(
                    {
                        "id": feature_base_id
                        if len(polygons) == 1
                        else f"{feature_base_id}-{polygon_index + 1}",
                        "kind": "polygon",
                        "rings": rings,
                        **({"properties": properties} if properties else {}),
                    }
                )

        if not features:
            continue

        layers.append(
            {
                "id": f"overlay-{input_index}-{geometry_column}",
                "name": f"{layer_name_prefix}: {geometry_column}",
                "geometryType": geometry_kind,
                "featureCount": len(features),
                **({"bounds": layer_bounds.to_json()} if layer_bounds else {}),
                "features": features,
            }
        )
        overall_bounds = merge_bounds(overall_bounds, layer_bounds)

    return layers, overall_bounds


def convert_config_to_bundle(config: dict[str, Any], output_path: Path) -> dict[str, Any]:
    inputs = config.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise ValueError("Config must contain a non-empty `inputs` array.")

    bundle_name = str(config.get("bundle_name", output_path.stem))
    bundle_id = str(config.get("bundle_id", slugify(bundle_name)))
    simplification_tolerance_meters = float(config.get("simplification_tolerance_meters", 25.0))

    manifest_refs: list[dict[str, Any]] = []
    render_trajectories: list[dict[str, Any]] = []
    extraction_trajectories: list[dict[str, Any]] = []
    overlay_layers: list[dict[str, Any]] = []
    overall_bounds: Bounds | None = None
    source_files: list[str] = []
    trajectory_kind = "path"

    for input_index, raw_input in enumerate(inputs):
        if not isinstance(raw_input, dict):
            raise ValueError(f"Input {input_index} must be an object.")

        kind = raw_input.get("kind")
        path = Path(str(raw_input["path"]))
        source_files.append(str(path))

        if kind == "trajectory_points":
            refs, render_payload, extraction_payload, bounds = build_trajectory_input(
                raw_input,
                simplification_tolerance_meters,
            )
            manifest_refs.extend(refs)
            render_trajectories.extend(render_payload)
            extraction_trajectories.extend(extraction_payload)
            overall_bounds = merge_bounds(overall_bounds, bounds)
            continue

        if kind == "weighted_od_graph":
            refs, render_payload, extraction_payload, bounds = build_weighted_od_input(raw_input)
            manifest_refs.extend(refs)
            render_trajectories.extend(render_payload)
            extraction_trajectories.extend(extraction_payload)
            overall_bounds = merge_bounds(overall_bounds, bounds)
            trajectory_kind = "od-edge"
            continue

        if kind == "geoparquet_overlay":
            layers, bounds = build_overlay_input(raw_input, input_index)
            overlay_layers.extend(layers)
            overall_bounds = merge_bounds(overall_bounds, bounds)
            continue

        raise ValueError(f"Unsupported input kind: {kind!r}")

    if not manifest_refs and not overlay_layers:
        raise ValueError("Conversion produced no trajectories or overlays.")

    manifest = {
        "version": 1,
        "id": bundle_id,
        "name": bundle_name,
        "sourceFiles": source_files,
        "trajectoryKind": trajectory_kind,
        **({"bounds": overall_bounds.to_json()} if overall_bounds else {}),
        "counts": {
            "trajectoryCount": len(manifest_refs),
            "overlayLayerCount": len(overlay_layers),
            "overlayFeatureCount": sum(layer["featureCount"] for layer in overlay_layers),
        },
        "simplification": {
            "algorithm": "rdp",
            "toleranceMeters": simplification_tolerance_meters,
        },
        "trajectories": manifest_refs,
        "overlays": [
            {
                "id": layer["id"],
                "name": layer["name"],
                "geometryType": layer["geometryType"],
                "featureCount": layer["featureCount"],
                **({"bounds": layer["bounds"]} if "bounds" in layer else {}),
            }
            for layer in overlay_layers
        ],
        "renderFile": "render-trajectories.json",
        "extractionFile": "extraction-trajectories.json",
        **({"overlayFile": "overlays.json"} if overlay_layers else {}),
    }

    return {
        "manifest.json": manifest,
        "render-trajectories.json": {"trajectories": render_trajectories},
        "extraction-trajectories.json": {"trajectories": extraction_trajectories},
        **({"overlays.json": {"layers": overlay_layers}} if overlay_layers else {}),
    }


def write_bundle(output_path: Path, archive_entries: dict[str, Any]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for entry_name, payload in archive_entries.items():
            archive.writestr(entry_name, json.dumps(payload, separators=(",", ":"), ensure_ascii=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert parquet inputs into a Path Segments runtime bundle.")
    parser.add_argument("--config", required=True, help="Path to the converter config JSON file.")
    parser.add_argument("--output", required=True, help="Output .psbundle.zip path.")
    args = parser.parse_args()

    config_path = Path(args.config)
    output_path = Path(args.output)
    config = read_json(config_path)
    archive_entries = convert_config_to_bundle(config, output_path)
    write_bundle(output_path, archive_entries)

    manifest = archive_entries["manifest.json"]
    print(
        json.dumps(
            {
                "output": str(output_path),
                "bundle_id": manifest["id"],
                "bundle_name": manifest["name"],
                "trajectory_count": manifest["counts"]["trajectoryCount"],
                "overlay_layer_count": manifest["counts"]["overlayLayerCount"],
                "overlay_feature_count": manifest["counts"]["overlayFeatureCount"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
