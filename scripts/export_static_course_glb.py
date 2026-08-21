"""
Export static Don't Be a Drag course as a GLB in native DCL coordinates
(Y-up, +X right, +Z forward). No Blender axis conversion — avoids mirroring.

Run: python3 scripts/export_static_course_glb.py
"""

from __future__ import annotations

import json
import math
import os
import struct
from typing import List, Tuple

OUT = os.path.join(
    os.path.dirname(__file__),
    "..",
    "models",
    "parkour-static-reference.glb",
)

SCENE_SIZE = 48.0
SCENE_HEIGHT = 66.4
PLATFORM_TOP = 12.0
START_WALL_H = 11.2

Color = Tuple[float, float, float, float]
Vec3 = Tuple[float, float, float]

C = {
    "void": (0.06, 0.045, 0.07, 1.0),
    "canyon": (0.42, 0.26, 0.17, 1.0),
    "canyonDark": (0.28, 0.16, 0.11, 1.0),
    "wood": (0.66, 0.44, 0.27, 1.0),
    "woodDark": (0.38, 0.24, 0.15, 1.0),
    "sand": (0.84, 0.7, 0.5, 1.0),
    "gold": (0.95, 0.78, 0.28, 1.0),
}


def quat_y(yaw_deg: float) -> Tuple[float, float, float, float]:
    """glTF quaternion (x,y,z,w) for yaw around +Y, matching DCL fromEulerDegrees(0,yaw,0)."""
    half = math.radians(yaw_deg) * 0.5
    return (0.0, math.sin(half), 0.0, math.cos(half))


def unit_box_mesh() -> Tuple[List[float], List[float], List[int]]:
    """Centered unit cube: positions (24 verts for hard edges), normals, indices."""
    # 6 faces * 4 verts
    faces = [
        # +X
        ((0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (0.5, 0.5, 0.5), (0.5, -0.5, 0.5), (1, 0, 0)),
        # -X
        ((-0.5, -0.5, 0.5), (-0.5, 0.5, 0.5), (-0.5, 0.5, -0.5), (-0.5, -0.5, -0.5), (-1, 0, 0)),
        # +Y
        ((-0.5, 0.5, -0.5), (-0.5, 0.5, 0.5), (0.5, 0.5, 0.5), (0.5, 0.5, -0.5), (0, 1, 0)),
        # -Y
        ((-0.5, -0.5, 0.5), (-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, -0.5, 0.5), (0, -1, 0)),
        # +Z
        ((-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5), (0, 0, 1)),
        # -Z
        ((0.5, -0.5, -0.5), (-0.5, -0.5, -0.5), (-0.5, 0.5, -0.5), (0.5, 0.5, -0.5), (0, 0, -1)),
    ]
    positions: List[float] = []
    normals: List[float] = []
    indices: List[int] = []
    for a, b, c, d, n in faces:
        base = len(positions) // 3
        for v in (a, b, c, d):
            positions.extend(v)
            normals.extend(n)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, normals, indices


def cylinder_mesh(segments: int = 16) -> Tuple[List[float], List[float], List[int]]:
    """Unit cylinder: radius 0.5, height 1, axis +Y (DCL/glTF)."""
    positions: List[float] = []
    normals: List[float] = []
    indices: List[int] = []
    # side
    for i in range(segments):
        a0 = (i / segments) * math.pi * 2
        a1 = ((i + 1) / segments) * math.pi * 2
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)
        x0, z0 = 0.5 * c0, 0.5 * s0
        x1, z1 = 0.5 * c1, 0.5 * s1
        base = len(positions) // 3
        for x, y, z, nx, nz in (
            (x0, -0.5, z0, c0, s0),
            (x1, -0.5, z1, c1, s1),
            (x1, 0.5, z1, c1, s1),
            (x0, 0.5, z0, c0, s0),
        ):
            positions.extend([x, y, z])
            normals.extend([nx, 0.0, nz])
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    # caps
    for y, ny in ((0.5, 1.0), (-0.5, -1.0)):
        center = len(positions) // 3
        positions.extend([0.0, y, 0.0])
        normals.extend([0.0, ny, 0.0])
        ring: List[int] = []
        for i in range(segments):
            a = (i / segments) * math.pi * 2
            positions.extend([0.5 * math.cos(a), y, 0.5 * math.sin(a)])
            normals.extend([0.0, ny, 0.0])
            ring.append(center + 1 + i)
        for i in range(segments):
            a = ring[i]
            b = ring[(i + 1) % segments]
            if ny > 0:
                indices.extend([center, a, b])
            else:
                indices.extend([center, b, a])
    return positions, normals, indices


class GltfBuilder:
    def __init__(self) -> None:
        self.bin = bytearray()
        self.buffer_views: List[dict] = []
        self.accessors: List[dict] = []
        self.meshes: List[dict] = []
        self.materials: List[dict] = []
        self.nodes: List[dict] = []
        self.mat_index: dict[str, int] = {}
        self.box_mesh_index: int | None = None
        self.cyl_mesh_index: int | None = None

    def _pad4(self) -> None:
        while len(self.bin) % 4:
            self.bin.append(0)

    def _add_buffer(self, data: bytes, target: int | None = None) -> int:
        self._pad4()
        offset = len(self.bin)
        self.bin.extend(data)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        idx = len(self.buffer_views)
        self.buffer_views.append(view)
        return idx

    def _add_accessor(
        self,
        view: int,
        component_type: int,
        count: int,
        type_name: str,
        min_v: List[float] | None = None,
        max_v: List[float] | None = None,
    ) -> int:
        acc: dict = {
            "bufferView": view,
            "componentType": component_type,
            "count": count,
            "type": type_name,
        }
        if min_v is not None:
            acc["min"] = min_v
        if max_v is not None:
            acc["max"] = max_v
        idx = len(self.accessors)
        self.accessors.append(acc)
        return idx

    def ensure_material(self, name: str, rgba: Color) -> int:
        if name in self.mat_index:
            return self.mat_index[name]
        idx = len(self.materials)
        self.materials.append(
            {
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": list(rgba),
                    "metallicFactor": 0.05,
                    "roughnessFactor": 0.72,
                },
            }
        )
        self.mat_index[name] = idx
        return idx

    def ensure_box_mesh(self) -> int:
        if self.box_mesh_index is not None:
            return self.box_mesh_index
        pos, norms, inds = unit_box_mesh()
        self.box_mesh_index = self._mesh_from_arrays("unit_box", pos, norms, inds)
        return self.box_mesh_index

    def ensure_cyl_mesh(self) -> int:
        if self.cyl_mesh_index is not None:
            return self.cyl_mesh_index
        pos, norms, inds = cylinder_mesh()
        self.cyl_mesh_index = self._mesh_from_arrays("unit_cylinder", pos, norms, inds)
        return self.cyl_mesh_index

    def _mesh_from_arrays(
        self, name: str, pos: List[float], norms: List[float], inds: List[int]
    ) -> int:
        pos_bytes = struct.pack("<%sf" % len(pos), *pos)
        norm_bytes = struct.pack("<%sf" % len(norms), *norms)
        ind_bytes = struct.pack("<%sH" % len(inds), *inds)

        pos_view = self._add_buffer(pos_bytes, 34962)
        norm_view = self._add_buffer(norm_bytes, 34962)
        ind_view = self._add_buffer(ind_bytes, 34963)

        xs = pos[0::3]
        ys = pos[1::3]
        zs = pos[2::3]
        pos_acc = self._add_accessor(
            pos_view, 5126, len(pos) // 3, "VEC3", [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]
        )
        norm_acc = self._add_accessor(norm_view, 5126, len(norms) // 3, "VEC3")
        ind_acc = self._add_accessor(ind_view, 5123, len(inds), "SCALAR")

        mesh_idx = len(self.meshes)
        self.meshes.append(
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": pos_acc, "NORMAL": norm_acc},
                        "indices": ind_acc,
                        "mode": 4,
                    }
                ],
            }
        )
        return mesh_idx

    def add_instance(
        self,
        name: str,
        mesh_idx: int,
        mat_idx: int,
        translation: Vec3,
        scale: Vec3,
        yaw_deg: float = 0.0,
    ) -> None:
        # Per-node material: clone mesh primitive with material (glTF mesh can share)
        # Simpler: one mesh entry per material variant via extras on node — use mesh copy with material
        prim = dict(self.meshes[mesh_idx]["primitives"][0])
        prim["material"] = mat_idx
        node_mesh = len(self.meshes)
        self.meshes.append({"name": name + "_mesh", "primitives": [prim]})
        node = {
            "name": name,
            "mesh": node_mesh,
            "translation": list(translation),
            "scale": list(scale),
        }
        if abs(yaw_deg) > 1e-6:
            node["rotation"] = list(quat_y(yaw_deg))
        self.nodes.append(node)

    def add_box(
        self,
        name: str,
        x: float,
        y: float,
        z: float,
        sx: float,
        sy: float,
        sz: float,
        color_key: str,
        yaw_deg: float = 0.0,
    ) -> None:
        mat = self.ensure_material(color_key, C[color_key])
        mesh = self.ensure_box_mesh()
        self.add_instance(name, mesh, mat, (x, y, z), (sx, sy, sz), yaw_deg)

    def add_cylinder(
        self,
        name: str,
        x: float,
        y: float,
        z: float,
        sx: float,
        sy: float,
        sz: float,
        color_key: str,
        yaw_deg: float = 0.0,
    ) -> None:
        mat = self.ensure_material(color_key, C[color_key])
        mesh = self.ensure_cyl_mesh()
        self.add_instance(name, mesh, mat, (x, y, z), (sx, sy, sz), yaw_deg)

    def add_empty(self, name: str, x: float, y: float, z: float) -> None:
        self.nodes.append({"name": name, "translation": [x, y, z]})

    def write(self, path: str) -> None:
        root_children = list(range(len(self.nodes)))
        self.nodes.append({"name": "Course_Static_Reference", "children": root_children})
        root = len(self.nodes) - 1

        # Fix: children were all nodes including those we want under root — rebuild
        # Actually we appended root AFTER collecting children of all prior nodes. Good.

        gltf = {
            "asset": {
                "version": "2.0",
                "generator": "dontbeadrag-static-export",
                "copyright": "DCL Y-up reference: +X right, +Y up, +Z forward",
            },
            "scene": 0,
            "scenes": [{"name": "Scene", "nodes": [root]}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.buffer_views,
            "buffers": [{"byteLength": len(self.bin)}],
        }

        json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        while len(json_bytes) % 4:
            json_bytes += b" "
        bin_bytes = bytes(self.bin)
        while len(bin_bytes) % 4:
            bin_bytes += b"\x00"

        total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
        with open(path, "wb") as f:
            f.write(struct.pack("<4sII", b"glTF", 2, total))
            f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
            f.write(json_bytes)
            f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
            f.write(bin_bytes)


def platform(g: GltfBuilder, name: str, x: float, z: float, width: float, depth: float, color: str, top: float = PLATFORM_TOP) -> None:
    thickness = 0.5
    g.add_box(name, x, top - thickness / 2, z, width, thickness, depth, color)


def plank(g: GltfBuilder, name: str, x1: float, z1: float, x2: float, z2: float, top: float, width: float, color: str) -> None:
    dx = x2 - x1
    dz = z2 - z1
    length = math.hypot(dx, dz)
    yaw = math.degrees(math.atan2(dx, dz))
    g.add_box(name, (x1 + x2) / 2, top - 0.25, (z1 + z2) / 2, width, 0.5, length, color, yaw)


def overlay(g: GltfBuilder, name: str, x: float, z: float, width: float, depth: float, color: str, top: float = PLATFORM_TOP) -> None:
    g.add_box(name, x, top + 0.08, z, width, 0.06, depth, color)


def lantern(g: GltfBuilder, name: str, x: float, z: float, top: float = PLATFORM_TOP) -> None:
    g.add_cylinder(f"{name}_pole", x, top + 0.7, z, 0.12, 1.4, 0.12, "woodDark")
    g.add_box(f"{name}_lamp", x, top + 1.55, z, 0.38, 0.38, 0.38, "gold")


def pillar(g: GltfBuilder, name: str, x: float, z: float, height: float = 3.2, top: float = PLATFORM_TOP) -> None:
    g.add_box(name, x, top + height / 2, z, 0.55, height, 0.55, "canyon")


def arch(g: GltfBuilder, name: str, x: float, z: float, width: float, top: float = PLATFORM_TOP) -> None:
    h = 4.2
    g.add_box(f"{name}_L", x - width / 2, top + h / 2, z, 0.55, h, 0.55, "canyon")
    g.add_box(f"{name}_R", x + width / 2, top + h / 2, z, 0.55, h, 0.55, "canyon")
    g.add_box(f"{name}_beam", x, top + h + 0.2, z, width + 1.1, 0.45, 0.7, "woodDark")


def rock(g: GltfBuilder, name: str, x: float, y: float, z: float, s: float, dark: bool = False) -> None:
    g.add_box(name, x, y, z, s, s * 0.7, s * 0.85, "canyonDark" if dark else "canyon")


def stacked_wall(g: GltfBuilder, name: str, x: float, z: float, sx: float, sz: float, height: float, color: str) -> None:
    slab = 8.0
    y0 = 0.0
    i = 0
    while y0 < height - 0.01:
        h = min(slab, height - y0)
        g.add_box(f"{name}_{i}", x, y0 + h / 2, z, sx, h, sz, color)
        y0 += h
        i += 1


def build() -> GltfBuilder:
    g = GltfBuilder()

    g.add_box("ground", SCENE_SIZE / 2, -0.2, SCENE_SIZE / 2, SCENE_SIZE, 0.4, SCENE_SIZE, "void")
    wall_h = SCENE_HEIGHT
    stacked_wall(g, "wall_south", SCENE_SIZE / 2, 0.3, SCENE_SIZE, 0.6, wall_h, "canyonDark")
    stacked_wall(g, "wall_north", SCENE_SIZE / 2, SCENE_SIZE - 0.3, SCENE_SIZE, 0.6, wall_h, "canyonDark")
    stacked_wall(g, "wall_west", 0.3, SCENE_SIZE / 2, 0.6, SCENE_SIZE, wall_h, "canyonDark")
    stacked_wall(g, "wall_east", SCENE_SIZE - 0.3, SCENE_SIZE / 2, 0.6, SCENE_SIZE, wall_h, "canyonDark")

    rocks = [
        (6, 0.4, 22, 1.6),
        (14, 0.5, 22, 1.2),
        (22, 0.35, 12, 1.8),
        (28, 0.55, 18, 2.1),
        (20, 0.3, 28, 1.4),
        (12, 0.45, 38, 1.7),
        (6, 0.5, 40, 2.0),
        (24, 0.4, 40, 1.3),
        (36, 0.5, 20, 1.9),
        (40, 0.35, 12, 1.5),
        (30, 0.45, 8, 1.6),
        (38, 0.4, 28, 1.4),
        (16, 0.5, 44, 1.8),
        (8, 0.35, 28, 1.2),
        (26, 0.4, 24, 1.5),
    ]
    for i, (x, y, z, s) in enumerate(rocks):
        rock(g, f"rock_{i}", x, y, z, s, dark=(i % 2 == 1))

    platform(g, "lobby_floor", 10, 9, 16, 12, "wood")
    overlay(g, "lobby_carpet", 10, 9, 4.5, 11.6, "sand")
    arch(g, "lobby_arch", 10, 14.6, 5.5)
    pillar(g, "lobby_pillar_SW", 3.2, 4.2)
    pillar(g, "lobby_pillar_SE", 16.8, 4.2)
    pillar(g, "lobby_pillar_NW", 3.2, 13.8)
    pillar(g, "lobby_pillar_NE", 16.8, 13.8)
    lantern(g, "lobby_lantern_SW", 4.2, 5.2)
    lantern(g, "lobby_lantern_SE", 15.8, 5.2)
    lantern(g, "lobby_lantern_NW", 4.2, 12.6)
    lantern(g, "lobby_lantern_NE", 15.8, 12.6)

    start_y = PLATFORM_TOP + START_WALL_H / 2
    g.add_box("start_cage_south", 10, start_y, 2.8, 18, START_WALL_H, 1.2, "canyon")
    g.add_box("start_cage_east", 18.15, start_y, 9.4, 1.2, START_WALL_H, 13.4, "canyon")
    g.add_box("start_cage_west", 1.85, start_y, 9.4, 1.2, START_WALL_H, 13.4, "canyon")
    g.add_box("start_cage_roof", 10, start_y + START_WALL_H / 2 + 0.15, 9.35, 17.6, 0.45, 13.5, "canyonDark")

    platform(g, "path_01", 10, 18.1, 5.2, 6.2, "wood")
    platform(g, "path_02", 10, 24.9, 1.55, 7.4, "woodDark")
    platform(g, "path_03", 10, 31.6, 6.0, 6.0, "wood")
    lantern(g, "path_lantern_L", 7.4, 28.9)
    lantern(g, "path_lantern_R", 12.6, 28.9)

    y3 = 16.8
    platform(g, "stair_landing", 20.2, 33.2, 2.7, 2.8, "wood", y3)
    platform(g, "after_ferry", 30.6, 33.2, 3.2, 3.4, "wood", y3)
    platform(g, "corridor_sweepers", 36.4, 33.2, 7.6, 3.6, "woodDark", y3)
    platform(g, "before_spiral", 42.5, 33.2, 3.2, 3.4, "wood", y3)

    CX, CZ = 24.0, 24.0
    STEPS = 36
    Y0, Y1 = 21.0, 60.85
    R0, R1 = 21.0, 6.5
    A0 = math.atan2(38.4 - CZ, 44.0 - CX)
    TURNS = (A0 + math.pi / 2) / (math.pi * 2) + 2
    ferries = {7, 16, 26}
    flips = {3, 5, 28, 31}

    def spiral_at(i: int):
        t = i / (STEPS - 1)
        ang = A0 - t * TURNS * math.pi * 2
        r = R0 + (R1 - R0) * t
        return {
            "x": CX + math.cos(ang) * r,
            "z": CZ + math.sin(ang) * r,
            "y": Y0 + (Y1 - Y0) * t,
            "ang": ang,
        }

    first_raw = spiral_at(0)
    entry_dx = first_raw["x"] - 44.0
    entry_dz = first_raw["z"] - 35.8
    entry_dist = math.hypot(entry_dx, entry_dz) or 1.0
    entry_ux = entry_dx / entry_dist
    entry_uz = entry_dz / entry_dist
    first = {
        **first_raw,
        "x": first_raw["x"] + entry_ux * 1.3,
        "z": first_raw["z"] + entry_uz * 1.3,
        "y": first_raw["y"] - 1.0,
    }

    sweep_x = -math.sin(first["ang"])
    sweep_z = math.cos(first["ang"])
    c = math.cos(math.radians(135))
    s = math.sin(math.radians(135))
    sweep_x, sweep_z = sweep_x * c - sweep_z * s, sweep_x * s + sweep_z * c
    par_x, par_z = -sweep_z, sweep_x
    along_sign = -1 if par_x * entry_ux + par_z * entry_uz < 0 else 1
    along_x = par_x * along_sign
    along_z = par_z * along_sign

    beam_y = first_raw["y"] + 2.7
    p1x = first["x"] + along_x * 3.8
    p1z = first["z"] + along_z * 3.8
    p2x = first["x"] + along_x * 19.7
    p2z = first["z"] + along_z * 19.7
    plank(g, "spiral_beam_1", p1x, p1z, p2x, p2z, beam_y, 1.45, "woodDark")

    dest = spiral_at(2)
    plank2_y = beam_y + 2.6
    to_dest_x = dest["x"] - p2x
    to_dest_z = dest["z"] - p2z
    to_dest = math.hypot(to_dest_x, to_dest_z) or 1.0
    su, sz = to_dest_x / to_dest, to_dest_z / to_dest
    plank(
        g,
        "spiral_beam_2",
        p2x + su * 0.4,
        p2z + sz * 0.4,
        dest["x"] - su * 2.3,
        dest["z"] - sz * 2.3,
        plank2_y,
        0.68,
        "woodDark",
    )

    for i in range(STEPS):
        p = first if i == 0 else spiral_at(i)
        size = 2.9 if i > STEPS - 4 else 2.7
        color = "wood" if i % 2 == 0 else "sand"
        is_ferry = i in ferries
        is_ferry_land = (i - 1) in ferries
        is_flip = i in flips
        if i == 21 or is_flip or is_ferry:
            continue
        if is_ferry_land or i in (1, 30, 33, 35) or (i >= 32 and i % 2 == 0):
            continue
        platform(g, f"spiral_{i:02d}", p["x"], p["z"], size, size, color, p["y"])
        if i % 6 == 0 and i != 0 and not is_ferry and not is_ferry_land and not is_flip and i != 30:
            inset = size / 2 - 0.32
            lantern(
                g,
                f"spiral_lantern_{i:02d}",
                p["x"] + math.cos(p["ang"]) * inset + math.sin(p["ang"]) * inset,
                p["z"] + math.sin(p["ang"]) * inset - math.cos(p["ang"]) * inset,
                p["y"],
            )

    mid = spiral_at(21)
    mid_top = mid["y"]
    platform(g, "mid_plaza", mid["x"], mid["z"], 5.0, 5.0, "wood", mid_top)
    lantern(g, "mid_lantern_A", mid["x"] + 2.15, mid["z"] + 2.15, mid_top)
    lantern(g, "mid_lantern_B", mid["x"] - 2.15, mid["z"] - 2.15, mid_top)

    slot = spiral_at(33)
    prev = spiral_at(31)
    along = math.hypot(slot["x"] - prev["x"], slot["z"] - prev["z"]) or 1.0
    fux = (slot["x"] - prev["x"]) / along
    fuz = (slot["z"] - prev["z"]) / along
    finish_yaw = math.degrees(math.atan2(fux, fuz))
    finish_top = slot["y"] - 2.4
    fx, fz = slot["x"], slot["z"]

    def local_xz(ox: float, oz: float):
        return (fx + ox * fuz + oz * fux, fz - ox * fux + oz * fuz)

    plaza_w = plaza_l = 13.2
    plaza_oz = 3.0
    plaza_x, plaza_z = local_xz(0, plaza_oz)
    g.add_box("finish_plaza", plaza_x, finish_top - 0.45, plaza_z, plaza_w, 0.9, plaza_l, "wood", finish_yaw)

    pole_top = finish_top - 0.9
    pole_y = 8.0
    pi = 0
    while pole_y < pole_top - 0.01:
        h = min(8.0, pole_top - pole_y)
        g.add_cylinder(f"finish_pole_{pi}", plaza_x, pole_y + h / 2, plaza_z, 0.72, h, 0.72, "canyonDark")
        pole_y += h
        pi += 1

    for tag, ox, oz in [("SW", -5.4, -2.4), ("SE", 5.4, -2.4), ("NW", -5.4, 8.2), ("NE", 5.4, 8.2)]:
        lx, lz = local_xz(ox, oz)
        lantern(g, f"finish_lantern_{tag}", lx, lz, finish_top)

    wall_t = 0.8
    room_h = min(START_WALL_H, SCENE_HEIGHT - 0.55 - finish_top)
    half_w = plaza_w / 2
    half_l = plaza_l / 2

    def place_wall(name: str, ox: float, oz: float, sx: float, sz: float) -> None:
        px, pz = local_xz(ox, oz)
        g.add_box(name, px, finish_top + room_h / 2, pz, sx, room_h, sz, "canyon", finish_yaw)

    place_wall("finish_wall_L", -(half_w + wall_t / 2), plaza_oz, wall_t, plaza_l + wall_t)
    place_wall("finish_wall_R", half_w + wall_t / 2, plaza_oz, wall_t, plaza_l + wall_t)
    place_wall("finish_wall_back", 0, plaza_oz + half_l + wall_t / 2, plaza_w + wall_t * 2, wall_t)

    door_w, door_h = 11.6, 7.2
    front_oz = plaza_oz - half_l - wall_t / 2
    jamb_w = (plaza_w + wall_t * 2 - door_w) / 2
    jamb_ox = half_w + wall_t - jamb_w / 2
    place_wall("finish_jamb_L", -jamb_ox, front_oz, jamb_w, wall_t)
    place_wall("finish_jamb_R", jamb_ox, front_oz, jamb_w, wall_t)
    lintel_h = max(0.8, room_h - door_h)
    lx, lz = local_xz(0, front_oz)
    g.add_box("finish_lintel", lx, finish_top + door_h + lintel_h / 2, lz, door_w, lintel_h, wall_t, "canyon", finish_yaw)
    rx, rz = local_xz(0, plaza_oz)
    g.add_box(
        "finish_roof",
        rx,
        finish_top + room_h + 0.22,
        rz,
        plaza_w + wall_t * 2 + 0.15,
        0.45,
        plaza_l + wall_t * 2 + 0.15,
        "canyonDark",
        finish_yaw,
    )
    gx, gz = local_xz(0, 5.0)
    g.add_box("finish_gold", gx, finish_top + 0.08, gz, 3.2, 0.06, 2.8, "gold", finish_yaw)

    for i, (sx, sz) in enumerate([(7.6, 8.1), (8.9, 9.5), (11.1, 8.1), (12.4, 9.5)]):
        g.add_empty(f"spawn_slot_{i}", sx, PLATFORM_TOP + 0.2, sz)
    g.add_empty("ORIGIN_0_0_0_DCL", 0.0, 0.0, 0.0)
    g.add_empty("SCENE_CORNER_48_0_48", SCENE_SIZE, 0.0, SCENE_SIZE)

    return g


def main() -> None:
    path = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    g = build()
    g.write(path)
    print(f"Wrote {path}")
    print("Coords: DCL/glTF Y-up, +X right, +Z forward (same as live scene).")


if __name__ == "__main__":
    main()
