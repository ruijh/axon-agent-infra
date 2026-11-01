# ═══════════════════════════════════════════════════════════
#  AXON · 数据中心 3D 模型构建（Blender 无头建模 → glTF/GLB）
#
#  输入：tools/dc-layout.json（由 node tools/export-layout.mjs 从 data.js 生成）
#  输出：assets/models/dc-a2.glb（被 assets/dc3d.js 用 three.js 加载渲染）
#
#  用法：
#    node tools/export-layout.mjs
#    blender --background --factory-startup --python tools/build_dc_model.py
#
#  命名约定（运行时按名字做数据映射）：
#    RACK_<机柜号>     机柜父级空物体（含 14 个柜位，未纳管也在内）
#    BODY_*            机柜骨架网格（拾取代理 + 悬停高亮目标）
#    DOOR_*            前门玻璃
#    DEV_<设备id>      服务器/网络设备 U 位块（26 台）
#    LED_<设备id>      设备面板 LED（运行时脉冲发光）
#    ENV_*             房间环境静态件（地板 / 墙 / 冷通道 / 桥架 / 空调）
# ═══════════════════════════════════════════════════════════
import bpy
import json
import math
import os
import random

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "dc-a2.glb")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

with open(os.path.join(ROOT, "tools", "dc-layout.json"), encoding="utf-8") as f:
    LAYOUT = json.load(f)

W = LAYOUT["size"]["w"]          # 22 m
D = LAYOUT["size"]["d"]          # 12 m
OX, OY = -W / 2, -D / 2          # 房间中心 → 世界原点（方便 three.js 环绕）
ROWY = LAYOUT["rowY"]
MANAGED = {r["id"] for r in LAYOUT["managedRacks"]}
DEVICES = LAYOUT["devices"]

random.seed(7)

# ── 机柜尺寸（42U 工业标准）───────────────────────────────
RACK_W, RACK_D, RACK_H = 0.62, 1.16, 2.05
U_H = 0.04445                    # 1U = 44.45 mm
U_BASE = 0.115                   # U01 底面离地（含底座）
COLD_Y0, COLD_Y1 = 4.4, 7.6      # 冷通道（含）范围

# ── 清空默认场景 ──────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)

# ── 材质工具 ──────────────────────────────────────────────
def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")

def make_mat(name, base, metallic=0.0, roughness=0.6,
             emission=None, emission_strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = principled(m)
    b.inputs["Base Color"].default_value = (*base, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
    if emission is not None:
        for nm in ("Emission Color", "Emission"):      # 4.x+ / 旧版 兼容
            if nm in b.inputs:
                b.inputs[nm].default_value = (*emission, 1.0)
        if "Emission Strength" in b.inputs:
            b.inputs["Emission Strength"].default_value = emission_strength
    return m

CYAN = (0.216, 0.886, 1.0)

MAT_FRAME   = make_mat("M_Frame",   (0.020, 0.022, 0.028), metallic=0.85, roughness=0.38)
MAT_PANEL_M = make_mat("M_PanelManaged",   (0.068, 0.105, 0.200), metallic=0.72, roughness=0.44)
MAT_PANEL_U = make_mat("M_PanelUnmanaged", (0.045, 0.050, 0.075), metallic=0.55, roughness=0.62)
MAT_GLASS   = make_mat("M_DoorGlass", (0.03, 0.05, 0.09), metallic=0.10, roughness=0.06, alpha=0.34)
MAT_CONTAIN = make_mat("M_ContainGlass", (0.35, 0.85, 1.0), metallic=0.0, roughness=0.05, alpha=0.13)
MAT_ALU     = make_mat("M_Aluminium", (0.42, 0.45, 0.50), metallic=0.90, roughness=0.35)
MAT_WALL    = make_mat("M_Wall", (0.028, 0.040, 0.070), roughness=0.92)
MAT_TRAY    = make_mat("M_Galv", (0.30, 0.32, 0.36), metallic=0.85, roughness=0.42)
MAT_CRAC    = make_mat("M_CRAC", (0.100, 0.120, 0.150), metallic=0.40, roughness=0.55)
MAT_CRAC_V  = make_mat("M_CRACVent", (0.05, 0.06, 0.08), metallic=0.30, roughness=0.75)
MAT_LED     = make_mat("M_LED", (0.02, 0.02, 0.02), emission=(0.60, 0.95, 1.00), emission_strength=4.0)
MAT_STRIP   = make_mat("M_Strip", (0.02, 0.02, 0.02), emission=CYAN, emission_strength=2.6)
# 设备面板（运行时按 kind/state 覆盖发光色）
MAT_DEV = {
    "server": make_mat("M_DevServer", (0.085, 0.125, 0.255), metallic=0.55, roughness=0.50,
                       emission=(0.10, 0.24, 0.75), emission_strength=0.5),
    "net":    make_mat("M_DevNet",    (0.165, 0.100, 0.055), metallic=0.55, roughness=0.50,
                       emission=(0.85, 0.38, 0.10), emission_strength=0.5),
    "bmc":    make_mat("M_DevBmc",    (0.130, 0.090, 0.200), metallic=0.55, roughness=0.50,
                       emission=(0.55, 0.32, 0.90), emission_strength=0.5),
}
MAT_BLANK = make_mat("M_BlankPanel", (0.030, 0.036, 0.050), metallic=0.45, roughness=0.65)

# ── 建模工具 ──────────────────────────────────────────────
def add_box(name, size, loc, mat, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.data.materials.append(mat)
    if parent is not None:
        ob.parent = parent
    return ob

def add_cyl(name, radius, depth, loc, mat):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob

def add_empty(name, loc, rot_z=0.0):
    bpy.ops.object.empty_add(location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_euler[2] = rot_z
    return ob

# ── 防静电地板纹理（程序化生成）──────────────────────────
def make_floor_texture():
    PX = 30                                   # 像素/米
    w, h = int(W * PX), int(D * PX)
    tile = int(0.6 * PX)                      # 0.6 m 地板砖
    rng = np.random.default_rng(7)
    img3 = np.zeros((h, w, 3), dtype=np.float32)
    # 逐砖亮度抖动（深蓝灰基调）
    for ty in range(0, h, tile):
        for tx in range(0, w, tile):
            v = 0.052 + rng.normal(0.0, 0.005)
            img3[ty:ty + tile, tx:tx + tile] = (v * 1.00, v * 1.12, v * 1.45)
    # 砖缝
    img3[tile::tile, :] *= 0.50
    img3[:, tile::tile] *= 0.50
    # 随机划痕（低透明度亮线）
    for _ in range(70):
        x0, y0 = rng.integers(0, w), rng.integers(0, h)
        length = rng.integers(12, 70)
        ang = rng.uniform(0, math.pi)
        dx, dy = int(math.cos(ang) * length), int(math.sin(ang) * length)
        steps = max(abs(dx), abs(dy), 1)
        for s in range(steps):
            xx = int(x0 + dx * s / steps) % w
            yy = int(y0 + dy * s / steps) % h
            img3[yy, xx] += 0.018
    img3 = np.clip(img3, 0.0, 1.0)
    img4 = np.dstack([img3, np.ones((h, w), dtype=np.float32)])
    img = bpy.data.images.new("FloorTiles", width=w, height=h)
    img.pixels.foreach_set(img4.ravel())
    img.pack()
    return img

def make_floor_mat():
    m = bpy.data.materials.new("M_Floor")
    m.use_nodes = True
    b = principled(m)
    b.inputs["Metallic"].default_value = 0.05
    b.inputs["Roughness"].default_value = 0.82
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = make_floor_texture()
    m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    return m

# ── 房间环境 ──────────────────────────────────────────────
def build_room():
    # 地板（薄板，顶面贴纹理）
    add_box("ENV_Floor", (W, D, 0.04), (0, 0, -0.02), make_floor_mat())
    # 三面矮沿 + 两面整墙（+x / +y 方向开放，便于环视）
    t = 0.12
    add_box("ENV_WallBack", (W + 2 * t, t, 3.0), (0, OY - t / 2, 1.5), MAT_WALL)
    add_box("ENV_WallLeft", (t, D, 3.0), (OX - t / 2, 0, 1.5), MAT_WALL)
    add_box("ENV_CurbRight", (t * 0.6, D, 0.35), (-OX - t * 0.3, 0, 0.175), MAT_WALL)
    add_box("ENV_CurbFront", (W, t * 0.6, 0.35), (0, -OY - t * 0.3, 0.175), MAT_WALL)
    # 墙面 LED 灯带（青色 · Bloom 高光）
    add_box("ENV_StripBack", (W - 1.0, 0.03, 0.03), (0, OY + 0.10, 2.52), MAT_STRIP)
    add_box("ENV_StripLeft", (0.03, D - 1.0, 0.03), (OX + 0.10, 0, 2.52), MAT_STRIP)

# ── 冷通道封闭（玻璃 + 框架 + 顶部灯带）──────────────────
def build_containment():
    x0, x1 = 2.2, 19.8
    z_top = 2.22
    # 立柱（两侧 · 间距 2.8 m）
    n = int((x1 - x0) // 2.8) + 1
    for i in range(n):
        x = x0 + i * 2.8
        add_box(f"ENV_ContainPostA{i}", (0.05, 0.05, z_top),
                (x + OX, COLD_Y0 + OY, z_top / 2), MAT_ALU)
        add_box(f"ENV_ContainPostB{i}", (0.05, 0.05, z_top),
                (x + OX, COLD_Y1 + OY, z_top / 2), MAT_ALU)
    # 顶部玻璃 + 两端玻璃
    add_box("ENV_ContainRoof", (x1 - x0, COLD_Y1 - COLD_Y0, 0.012),
            ((x0 + x1) / 2 + OX, (COLD_Y0 + COLD_Y1) / 2 + OY, z_top), MAT_CONTAIN)
    add_box("ENV_ContainEndL", (0.012, COLD_Y1 - COLD_Y0, z_top - 0.05),
            (x0 + OX, (COLD_Y0 + COLD_Y1) / 2 + OY, (z_top - 0.05) / 2), MAT_CONTAIN)
    add_box("ENV_ContainEndR", (0.012, COLD_Y1 - COLD_Y0, z_top - 0.05),
            (x1 + OX, (COLD_Y0 + COLD_Y1) / 2 + OY, (z_top - 0.05) / 2), MAT_CONTAIN)
    # 顶部边缘发光条
    add_box("ENV_ContainGlowA", (x1 - x0, 0.025, 0.025),
            ((x0 + x1) / 2 + OX, COLD_Y0 + OY, z_top + 0.02), MAT_STRIP)
    add_box("ENV_ContainGlowB", (x1 - x0, 0.025, 0.025),
            ((x0 + x1) / 2 + OX, COLD_Y1 + OY, z_top + 0.02), MAT_STRIP)
    # 冷通道地面穿孔地板（微发光）
    cold = make_mat("M_ColdFloor", (0.05, 0.10, 0.16), roughness=0.75,
                    emission=(0.05, 0.22, 0.30), emission_strength=0.55)
    add_box("ENV_ColdFloor", (x1 - x0, COLD_Y1 - COLD_Y0, 0.008),
            ((x0 + x1) / 2 + OX, (COLD_Y0 + COLD_Y1) / 2 + OY, 0.012), cold)

# ── 精密空调 CRAC ────────────────────────────────────────
def build_crac():
    for i, c in enumerate(LAYOUT["crac"]):
        x, y = c["x"] + OX, c["y"] + OY
        face = 1 if c["x"] < W / 2 else -1     # 面向机房内
        g = add_empty(f"CRAC_{i + 1}", (x, y, 0))
        add_box(f"CRAC_{i + 1}_body", (0.80, 0.80, 2.20), (x, y, 1.10), MAT_CRAC, g)
        for k in range(6):                      # 前格栅
            add_box(f"CRAC_{i + 1}_vent{k}", (0.02, 0.66, 0.05),
                    (x + face * 0.41, y, 0.55 + k * 0.11), MAT_CRAC_V, g)
        add_box(f"CRAC_{i + 1}_bar", (0.02, 0.50, 0.04),
                (x + face * 0.41, y, 2.02), MAT_STRIP, g)   # 状态灯条

# ── 机柜（42U · 前门朝 +y，B 排整体旋转 180°）────────────
def build_rack(rid, x, y, facing):
    managed = rid in MANAGED
    g = add_empty(f"RACK_{rid}", (x + OX, y + OY, 0), rot_z=0.0 if facing > 0 else math.pi)
    panel = MAT_PANEL_M if managed else MAT_PANEL_U

    # 四立柱
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box(f"BODY_{rid}_post", (0.06, 0.06, RACK_H),
                    (sx * (RACK_W / 2 - 0.03), sy * (RACK_D / 2 - 0.03), RACK_H / 2), MAT_FRAME, g)
    # 侧板 / 后板 / 顶板 / 底座（同材质 · 合并为一个 BODY 名便于拾取识别）
    add_box(f"BODY_{rid}_sideL", (0.012, RACK_D - 0.06, RACK_H - 0.08),
            (-(RACK_W / 2 + 0.006), 0, RACK_H / 2), panel, g)
    add_box(f"BODY_{rid}_sideR", (0.012, RACK_D - 0.06, RACK_H - 0.08),
            ((RACK_W / 2 + 0.006), 0, RACK_H / 2), panel, g)
    add_box(f"BODY_{rid}_back", (RACK_W - 0.06, 0.012, RACK_H - 0.08),
            (0, -(RACK_D / 2 + 0.006), RACK_H / 2), panel, g)
    add_box(f"BODY_{rid}_top", (RACK_W, RACK_D, 0.014),
            (0, 0, RACK_H + 0.007), MAT_FRAME, g)
    add_box(f"BODY_{rid}_plinth", (RACK_W - 0.04, RACK_D - 0.04, 0.10),
            (0, 0, 0.05), MAT_FRAME, g)
    # 前门玻璃 + 立柱导轨
    add_box(f"DOOR_{rid}", (RACK_W - 0.10, 0.008, RACK_H - 0.10),
            (0, RACK_D / 2 + 0.012, RACK_H / 2), MAT_GLASS, g)
    for sx in (-1, 1):
        add_box(f"BODY_{rid}_rail", (0.03, 0.02, 1.92),
                (sx * 0.235, RACK_D / 2 - 0.05, 0.10 + 1.92 / 2), MAT_ALU, g)
    # 纳管柜：按 U 位放置设备；未纳管柜：上部一块盲板示意
    if managed:
        for dv in [d for d in DEVICES if d["rack"] == rid]:
            u0, u1 = dv["u"]
            z0 = U_BASE + (u0 - 1) * U_H + 0.002
            hh = (u1 - u0 + 1) * U_H - 0.004
            front = RACK_D / 2 - 0.03
            add_box(f"DEV_{dv['id']}", (0.44, 0.62, hh),
                    (0, front - 0.31, z0 + hh / 2), MAT_DEV[dv["kind"]], g)
            bez = make_mat(f"MAT_BEZ_{dv['id']}", (0.03, 0.035, 0.05), metallic=0.60, roughness=0.45)
            add_box(f"DEV_{dv['id']}_bez", (0.448, 0.012, hh * 0.96),
                    (0, front + 0.006, z0 + hh / 2), bez, g)
            add_box(f"LED_{dv['id']}", (0.018, 0.014, hh * 0.82),
                    (-0.198, front + 0.012, z0 + hh / 2), MAT_LED, g)
    else:
        add_box(f"BODY_{rid}_blank", (0.44, 0.02, 0.9),
                (0, RACK_D / 2 - 0.05, 1.35), MAT_BLANK, g)

# ── 桥架 + 下线管 ────────────────────────────────────────
def build_trays():
    for row in ("A", "B"):
        y = ROWY[row] + (0.62 if row == "B" else -0.62)   # 机柜后侧
        z = 2.62
        add_box(f"ENV_Tray{row}_base", (17.6, 0.30, 0.015), (0, y + OY, z), MAT_TRAY)
        for sy in (-1, 1):
            add_box(f"ENV_Tray{row}_rail{sy}", (17.6, 0.012, 0.055),
                    (0, y + OY + sy * 0.145, z + 0.035), MAT_TRAY)
        for i in (1, 3, 5):                               # 下线管
            x = 2.6 + i * 2.8 + OX
            add_cyl(f"ENV_Conduit{row}{i}", 0.016, 0.52, (x, y + OY, z - 0.26), MAT_TRAY)

# ── 构建 ─────────────────────────────────────────────────
build_room()
build_containment()
build_crac()
build_trays()
for row in LAYOUT["rows"]:
    y = ROWY[row["id"]]
    facing = 1 if row["id"] == "A" else -1
    for i, rid in enumerate(row["racks"]):
        build_rack(rid, 2.6 + i * 2.8, y, facing)

bpy.context.view_layer.update()

# ── 导出 GLB ─────────────────────────────────────────────
try:
    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
except Exception:
    pass

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_animations=False,
    export_skins=False,
    export_extras=False,
)

n_obj = len(bpy.data.objects)
size = os.path.getsize(OUT)
print(f"[build_dc_model] 场景对象 {n_obj} · 机柜 {len(LAYOUT['rows'][0]['racks']) + len(LAYOUT['rows'][1]['racks'])} 位"
      f"（纳管 {len(MANAGED)}）· 设备 {len(DEVICES)} 台")
print(f"[build_dc_model] 导出 {OUT} · {size / 1024:.0f} KB")
