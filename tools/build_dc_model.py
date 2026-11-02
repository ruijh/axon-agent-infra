"""AXON: deterministic metre-scale, fully detailed room -> glTF.
Run node tools/export-layout.mjs, then blender --background --factory-startup
--python tools/build_dc_model.py. Device IDs/U positions come only from layout.
"""
import bpy
import json
import math
import os
import hashlib
import numpy as np
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'models', 'dc-a2.glb')
with open(os.path.join(ROOT, 'tools', 'dc-layout.json'), encoding='utf-8') as f:
    L = json.load(f)
W, D = L['size']['w'], L['size']['d']
OX, OY = -W / 2, -D / 2
RW, RD, RH = (L['rackSize'][k] for k in ('w', 'd', 'h'))
U, U_BASE = .04445, .115
MANAGED = {r['id'] for r in L['managedRacks']}
X0, X1 = min(L['rackX']) - RW / 2, max(L['rackX']) + RW / 2
Y0, Y1 = L['rowY']['A'] + RD / 2, L['rowY']['B'] - RD / 2
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'


def shader(m):
    return next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def mat(name, color, metal=0, rough=.6, emission=0, alpha=1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = shader(m)
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Alpha'].default_value = alpha
    if emission:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emission
    return m


def image(name, rgb, data=False):
    h, w = rgb.shape[:2]
    im = bpy.data.images.new(name, width=w, height=h, alpha=rgb.shape[-1] == 4)
    if data:
        im.colorspace_settings.name = 'Non-Color'
    rgba = np.dstack((rgb, np.ones((h, w), dtype=np.float32))) if rgb.shape[-1] == 3 else rgb
    im.pixels.foreach_set(np.asarray(rgba, dtype=np.float32).ravel())
    im.pack()
    return im


def texture(m, im, socket):
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    n.image = im
    m.node_tree.links.new(n.outputs['Color'], shader(m).inputs[socket])
    return n


def surface_maps(m, name, height, roughness, metallic=0):
    # Deterministic, packed tangent normals + ORM. No procedural nodes at runtime.
    gy, gx = np.gradient(height)
    normal = np.dstack((-gx, -gy, np.ones_like(gx)))
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    n.image = image(name + '_Normal', normal * .5 + .5, True)
    nm = m.node_tree.nodes.new('ShaderNodeNormalMap')
    m.node_tree.links.new(n.outputs['Color'], nm.inputs['Color'])
    m.node_tree.links.new(nm.outputs['Normal'], shader(m).inputs['Normal'])
    orm = np.dstack((np.clip(.8 + height * .15, .35, 1), roughness, np.full_like(height, metallic)))
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = image(name + '_ORM', orm, True)
    separate = m.node_tree.nodes.new('ShaderNodeSeparateColor')
    m.node_tree.links.new(tex.outputs['Color'], separate.inputs['Color'])
    m.node_tree.links.new(separate.outputs['Green'], shader(m).inputs['Roughness'])
    m.node_tree.links.new(separate.outputs['Blue'], shader(m).inputs['Metallic'])
    group = bpy.data.node_groups.get('glTF Material Output')
    if not group:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    ao = m.node_tree.nodes.new('ShaderNodeGroup')
    ao.node_tree = group
    m.node_tree.links.new(separate.outputs['Red'], ao.inputs['Occlusion'])


FRAME = mat('M_Frame_CoatedSteel', (.032, .038, .045), rough=.52)
PANEL = mat('M_Panel_PowderCoat', (.07, .08, .09), rough=.58)
ALU = mat('M_BrushedAluminium', (.48, .52, .56), metal=1, rough=.34)
STEEL = mat('M_GalvanizedSteel', (.32, .36, .40), metal=1, rough=.48)
RUBBER = mat('M_Rubber', (.009, .012, .015), rough=.88)
FACE = mat('M_DeviceFace_CoatedMetal', (.13, .15, .17), rough=.48)
BLANK = mat('M_BlankPanels', (.045, .052, .06), rough=.6)
WALL = mat('M_Wall_Painted', (.49, .52, .54), rough=.86)
GLASS = mat('M_Glass_Clear', (.60, .69, .73), rough=.16, alpha=.10)
WHITE = mat('M_Identification_White', (.72, .77, .80), rough=.67)
BLUE = mat('M_Aisle_Marking', (.12, .28, .36), rough=.8)
AMBER = mat('M_Service_Marking', (.42, .30, .13), rough=.8)
LED = mat('M_StatusLED', (.26, .67, .43), emission=1.8)
LIGHT = mat('M_Luminaire_Diffuser', (.90, .88, .81), emission=1.8)
VENT = mat('M_Vent_PerforatedMetal', (.10, .12, .14), metal=1, rough=.65)

rng = np.random.default_rng(7)
noise = rng.normal(0, .025, (256, 256)).astype(np.float32)
surface_maps(PANEL, 'PowderCoat', noise, np.clip(.58 + noise, 0, 1))
yy, xx = np.mgrid[:512, :512]
rx, ry = xx % 16 - 8, yy % 16 - 8
holes = (rx * rx + ry * ry) < 20
height = np.where(holes, -1.0, .0).astype(np.float32)
vent_color = np.where(holes[..., None], [.008, .012, .016], [.32, .35, .38])
texture(VENT, image('Perforation_Base', vent_color), 'Base Color')
surface_maps(VENT, 'Perforation', height, np.where(holes, .94, .6), 0)

# Door perforation is an alpha mask, not thousands of geometric holes.
MESH = mat('M_Door_PerforatedMesh', (.045, .05, .055), metal=1, rough=.55)
door_holes = (rx * rx + ry * ry) < 45
rgba = np.dstack((np.full((512, 512, 3), .15), np.where(door_holes, .0, 1.0)))
tx = texture(MESH, image('Door_Perforation', rgba), 'Base Color')
m = shader(MESH)
cutoff = MESH.node_tree.nodes.new('ShaderNodeMath')
cutoff.operation = 'GREATER_THAN'
cutoff.inputs[1].default_value = .5
MESH.node_tree.links.new(tx.outputs['Alpha'], cutoff.inputs[0])
MESH.node_tree.links.new(cutoff.outputs[0], m.inputs['Alpha'])
# Threshold transparency exports as MASK, avoiding blended depth-order artefacts.
try:
    MESH.surface_render_method = 'DITHERED'
except (AttributeError, TypeError):
    pass

mesh_cache = {}

def empty(name, pos, parent=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob)
    ob.location = pos
    ob.parent = parent
    return ob


def box(name, size, pos, material, parent=None, bevel=0, dev=None):
    key = tuple(size)
    mesh = mesh_cache.get(key)
    if mesh is None:
        x, y, z = (v / 2 for v in size)
        vertices = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
        faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        uv = mesh.uv_layers.new()
        for poly in mesh.polygons:
            for j, li in enumerate(poly.loop_indices):
                uv.data[li].uv = [(0,0),(1,0),(1,1),(0,1)][j]
        mesh_cache[key] = mesh
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.location, ob.parent = pos, parent
    if not mesh.materials:
        mesh.materials.append(material)
    ob.material_slots[0].link = 'OBJECT'
    ob.material_slots[0].material = material
    if bevel:
        mod = ob.modifiers.new('Manufactured edge radius', 'BEVEL')
        mod.width, mod.segments = min(bevel, min(size) / 3), 2
        mod = ob.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    if dev:
        ob['devId'] = dev
    return ob


def face(name, size, pos, material, parent=None, dev=None):
    w, h = size
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(-w/2,0,-h/2),(w/2,0,-h/2),(w/2,0,h/2),(-w/2,0,h/2)], [], [(3,2,1,0)])
    uv = mesh.uv_layers.new()
    for li, coord in zip(mesh.polygons[0].loop_indices, [(0,1),(1,1),(1,0),(0,0)]):
        uv.data[li].uv = coord
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.location, ob.parent = pos, parent
    if dev:
        ob['devId'] = dev
    return ob


def lettering(name, text, size, pos, parent=None, material=WHITE):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body, curve.size, curve.align_x, curve.align_y = text, size, 'CENTER', 'CENTER'
    curve.extrude = .00015
    curve.resolution_u = 2
    ob = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(ob)
    ob.location, ob.parent = pos, parent
    ob.rotation_euler = (math.pi / 2, 0, math.pi)
    curve.materials.append(material)
    # Text -> mesh makes the exported identity plate independent of installed fonts.
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob.select_set(False)
    return ob


def floor_material():
    h, w = 600, 1100
    y, x = np.mgrid[:h, :w]
    tile_noise = rng.normal(0, .008, (21, 38))
    base = .36 + tile_noise[y // 30, x // 30] + rng.normal(0, .002, (h, w))
    seams = (x % 30 == 0) | (y % 30 == 0)
    base[seams] = .19
    rgb = np.dstack((base * .97, base, base * 1.015))
    m = mat('M_Floor_Antistatic600', (.36,.36,.36), rough=.82)
    texture(m, image('Floor_600mm', rgb), 'Base Color')
    return m


def build_room():
    box('ENV_Floor', (W,D,.08), (0,0,-.04), floor_material())
    box('ENV_WallBack', (W,.12,3), (0,OY-.06,1.5), WALL)
    box('ENV_WallLeft', (.12,D,3), (OX-.06,0,1.5), WALL)
    for z in (.08, 2.88):
        box('ENV_WallTrim', (W,.03,.035), (0,OY+.015,z), ALU)
        box('ENV_WallTrimLeft', (.03,D,.035), (OX+.015,0,z), ALU)
    for x in np.arange(OX+.9, W/2, 1.2):
        box('ENV_WallPanelJoint', (.006,.006,2.7), (x,OY+.003,1.5), STEEL)
    for x in (-6,0,6):
        box('ENV_LightHousing', (3.2,.15,.05), (x,OY+.12,2.65), FRAME, bevel=.006)
        box('ENV_StripBack', (3.05,.016,.045), (x,OY+.205,2.64), LIGHT)
    # Ceiling assemblies are a single cutaway layer in overview/inspection.
    ceiling = empty('ENV_CeilingFixtures',(0,0,0))
    for x in (-6,0,6):
        for y in (-2.7,3.6):
            box('ENV_RoomLuminaire', (2.4,.13,.055), (x,y,2.9), FRAME,ceiling,bevel=.006)
            box('ENV_StripRoom', (2.3,.10,.012), (x,y,2.866), LIGHT,ceiling)
            for sx in (-.85,.85):
                box('ENV_LuminaireSuspension',(.008,.008,.35),(x+sx,y,3.1),STEEL,ceiling)
    wall_sign = empty('ENV_RoomIdentity', (1.9,OY+.075,2.23))
    box('ENV_RoomSignPanel', (2.5,.025,.42), (0,0,0), BLUE,wall_sign,.008)
    lettering('ENV_RoomSignText', 'A2  /  COMPUTE HALL', .18, (0,.019,0),wall_sign)
    # Precision AC: children are local, so the parent's offset is applied once.
    for i, ac in enumerate(L['crac']):
        g = empty(f'CRAC_{i+1}', (ac['x']+OX,ac['y']+OY,0))
        sign = 1 if ac['x'] < W/2 else -1
        box(f'CRAC_{i+1}_body', (.8,.8,2.2), (0,0,1.1), PANEL, g, .015)
        for j in range(12):
            box(f'CRAC_{i+1}_vent{j}', (.014,.66,.027), (sign*.408,0,.4+j*.085), RUBBER, g)
        box(f'CRAC_{i+1}_display', (.014,.16,.09), (sign*.41,0,1.82), BLUE, g)
        box(f'CRAC_{i+1}_bar', (.015,.04,.012), (sign*.42,0,1.94), LED, g)
        box(f'CRAC_{i+1}_plinth',(.84,.84,.07),(0,0,.035),FRAME,g,.008)
        for sy in (-1,1):
            box(f'CRAC_{i+1}_seam',(.012,.012,2.02),(sign*.41,sy*.33,1.12),STEEL,g)
        box(f'CRAC_{i+1}_handle',(.036,.014,.16),(sign*.42,.23,1.2),ALU,g,.003)


def build_aisle():
    x0,x1,y0,y1 = X0+OX-.06,X1+OX+.06,Y0+OY,Y1+OY
    length, width = x1-x0, y1-y0
    for x in (x0,x1):
        for y in (y0,y1):
            box('ENV_ContainPost', (.04,.04,2.35), (x,y,1.175), ALU, bevel=.003)
    for y in (y0,y1):
        box('ENV_ContainRail', (length,.04,.055), ((x0+x1)/2,y,2.32), ALU, bevel=.003)
    for x in np.arange(x0,x1,.68):
        box('ENV_ContainCrossbar', (.025,width,.025), (x,(y0+y1)/2,2.33), ALU)
    # Segmented roof glazing: cut away in overhead view, retained from the aisle.
    box('ENV_ContainRoof', (length,width,.008), ((x0+x1)/2,(y0+y1)/2,2.35), GLASS)
    for x in (-1.5,0,1.5):
        box('ENV_Luminaire', (.9,.12,.035), (x,(y0+y1)/2,2.30), FRAME, bevel=.006)
        box('ENV_StripAisle', (.84,.09,.01), (x,(y0+y1)/2,2.276), LIGHT)
    for y in (y0+.06,y1-.06):
        box('ENV_AisleSafetyLine', (length,.025,.002), ((x0+x1)/2,y,.004), BLUE)
    # Actual tiled perforated floor modules and expansion joints, full aisle.
    for x in np.arange(x0+.32,x1-.2,.6):
        for y in (y0+.32,y0+.94):
            ob = face('ENV_AirTile', (.57,.57), (x,y,.006), VENT)
            ob.rotation_euler.x = math.pi / 2
            for sx in (-.29,.29):
                box('ENV_TileFrame', (.008,.58,.004), (x+sx,y,.005), STEEL)
    for row in L['rows']:
        y = L['rowY'][row['id']]+OY + (-.65 if row['id']=='A' else .65)
        for sy in (-.15,.15):
            box('ENV_TrayRail', (length,.018,.09), (0,y+sy,2.6), STEEL, bevel=.003)
        for x in np.arange(x0,x1,.22):
            box('ENV_TrayRung', (.025,.30,.018), (x,y,2.565), STEEL)
        for x in (-1.6,0,1.6):
            box('ENV_TraySupport', (.018,.018,.5), (x,y,2.35), STEEL)
        # Restrained, colour-coded cable bundles, seated inside the ladder tray.
        for k in range(4):
            box('ENV_CableBundle', (length,.025,.018), (0,y-.08+k*.05,2.59),BLUE if k<2 else RUBBER)
        rear = y + (-.65 if row['id']=='A' else .65)
        for yy in (rear-.5,rear+.5):
            box('ENV_ServiceBoundary',(length,.025,.002),((x0+x1)/2,yy,.004),AMBER)
        for x in (x0,x1):
            box('ENV_ServiceEnd',(.025,1,.002),(x,rear,.004),AMBER)
        ceiling = bpy.data.objects['ENV_CeilingFixtures']
        box('ENV_ServiceLight',(length,.12,.045),((x0+x1)/2,rear,2.78),FRAME,ceiling,bevel=.004)
        box('ENV_StripService',(length-.12,.08,.008),((x0+x1)/2,rear,2.751),LIGHT,ceiling)
    for side,x in enumerate((x0,x1)):
        # End portals and two glazed sliding leaves, shown parked open.
        end = empty('ENV_AisleEnd_'+str(side),(x,(y0+y1)/2,0))
        end.rotation_euler.z = math.pi/2
        box('ENV_EndHeader',(width+.12,.09,.17),(0,0,2.23),FRAME,end,.008)
        for s in (-1,1):
            cx=s*(width/2-.16)
            for dx in (-.14,.14):
                box('ENV_EndDoorStile',(.024,.025,2.06),(cx+dx,0,1.06),ALU,end,.002)
            for z in (.04,2.08):
                box('ENV_EndDoorCross',(.30,.025,.025),(cx,0,z),ALU,end,.002)
            face('ENV_EndGlass',(.26,2.0),(cx,0,1.06),GLASS,end)
            box('ENV_EndHandle',(.012,.04,.18),(cx-s*.10,.02,1.04),ALU,end,.003)
        lettering('ENV_AisleSignText','A2  /  COLD AISLE',.065,(0,.05,2.23),end)


def detail_device(d, parent, front, z, height):
    ident=d['id']
    # Each component keeps the same device ID for picking and asset navigation.
    for x in (-.222,.222):
        box(f'DETAIL_{ident}_ear', (.025,.018,height*.95), (x,front+.014,z), ALU, parent, .001, ident)
        for zz in (z-height*.32,z+height*.32):
            box(f'DETAIL_{ident}_fastener', (.009,.007,.009), (x,front+.025,zz), STEEL, parent, .002, ident)
    if d['kind']=='server':
        # Replace a flat glowing block with tray banks, vent field and handles.
        face(f'DETAIL_{ident}_vent', (.37,height*.43), (0,front+.014,z-height*.17), VENT, parent, ident)
        for k in range(6):
            x=-.164+k*.065
            box(f'DETAIL_{ident}_drive', (.059,.016,height*.30), (x,front+.020,z+height*.26), RUBBER, parent, .002, ident)
            box(f'DETAIL_{ident}_latch', (.049,.009,.012), (x,front+.032,z+height*.27), ALU, parent, .001, ident)
        for x in (-.192,.192):
            for zz in (z-height*.25,z+height*.25):
                box(f'DETAIL_{ident}_handleFoot', (.012,.034,.013), (x,front+.03,zz), FRAME, parent, .002, ident)
            box(f'DETAIL_{ident}_handle', (.013,.012,height*.55), (x,front+.052,z), ALU, parent, .003, ident)
    else:
        for k in range(16):
            x=-.18+k*.023
            box(f'DETAIL_{ident}_port', (.017,.009,.014), (x,front+.018,z), RUBBER, parent, .001, ident)
    box(f'LED_{ident}', (.006,.005,.009), (-.207,front+.031,z), LED, parent, .001, ident)


def build_rack(rid,x,y,facing):
    g = empty('RACK_'+rid, (x+OX,y+OY,0))
    g['rackId'] = rid
    g['detailStandard'] = 'room-v2'
    g.rotation_euler.z = 0 if facing>0 else math.pi
    panel = PANEL
    for sx in (-1,1):
        for sy in (-1,1):
            box(f'BODY_{rid}_post', (.045,.045,RH), (sx*(RW/2-.025),sy*(RD/2-.025),RH/2), FRAME,g,.004)
        box(f'BODY_{rid}_side', (.014,RD-.075,RH-.12), (sx*(RW/2-.006),0,RH/2), panel,g,.003)
        box(f'BODY_{rid}_rail', (.024,.025,1.91), (sx*.235,RD/2-.05,1.055), STEEL,g,.002)
    # Split rear service doors share the same metal and vent standard as fronts.
    for sx in (-1,1):
        box(f'BODY_{rid}_back', ((RW-.06)/2-.004,.014,RH-.12), (sx*(RW-.06)/4,-RD/2+.01,RH/2), panel,g,.003)
        rear = face(f'BODY_{rid}_rearVent', (.22,1.62), (sx*.145,-RD/2-.002,1.04),VENT,g)
        rear.rotation_euler.z = math.pi
        box(f'BODY_{rid}_rearHandle',(.012,.024,.13),(sx*.035,-RD/2-.01,1.02),ALU,g,.003)
    box(f'BODY_{rid}_top', (RW,RD,.025), (0,0,RH), FRAME,g,.005)
    box(f'BODY_{rid}_plinth', (RW-.04,RD-.04,.08), (0,0,.045), FRAME,g,.006)
    for sx in (-1,1):
        for sy in (-1,1):
            box(f'BODY_{rid}_foot', (.05,.05,.024), (sx*.24,sy*.49,.012), RUBBER,g,.004)
    # Openable perforated door. Coordinates are relative to its hinge.
    pivot=empty('DOOR_PIVOT_'+rid, (-RW/2+.022,RD/2+.033,0),g)
    for x in (0,RW-.044):
        box(f'DOOR_{rid}_stile', (.025,.035,RH-.08), (x,0,RH/2), FRAME,pivot,.004)
    for z in (.06,RH-.06):
        box(f'DOOR_{rid}_cross', (RW-.044,.035,.035), ((RW-.044)/2,0,z),FRAME,pivot,.004)
    face(f'DOOR_{rid}_mesh', (RW-.08,RH-.15), ((RW-.044)/2,.001,RH/2),MESH,pivot)
    box(f'DOOR_{rid}_handle', (.016,.042,.17), (RW-.095,.026,1.02), ALU,pivot,.004)
    for z in (.28,1.05,1.82):
        box(f'BODY_{rid}_hinge', (.03,.035,.09), (-RW/2+.017,RD/2+.022,z),STEEL,g,.006)
    box(f'BODY_{rid}_plate', (.32,.009,.062), (0,RD/2+.037,1.995),BLUE if rid in MANAGED else STEEL,g,.003)
    lettering(f'BODY_{rid}_id',rid+' / '+('42U' if rid in MANAGED else 'RESERVE'),.029,(0,RD/2+.043,1.995),g)
    detail = empty('MECHANICS_'+rid,(0,0,0),g)
    detail['detailLevel'] = 'near'
    for unit in range(1,43):
        zz=U_BASE+(unit-.5)*U
        for sx in (-1,1):
            box(f'MICRO_{rid}_railHole',(.006,.002,.009),(sx*.235,RD/2-.035,zz),RUBBER,detail)
        if unit%2==0:
            lettering(f'MICRO_{rid}_u'+str(unit),str(unit),.013,(-.262,RD/2-.033,zz),detail)
    # Rear dual PDU strips and cable retention, visible through the open sample.
    for sx in (-1,1):
        box(f'MICRO_{rid}_PDU',(.035,.04,1.72),(sx*.245,-.47,1.0),RUBBER,detail,.003)
    occupied=set()
    for dv in [d for d in L['devices'] if d['rack']==rid]:
        u0,u1=dv['u']; occupied.update(range(u0,u1+1))
        hh=(u1-u0+1)*U-.004; z=U_BASE+(u0-1)*U+.002+hh/2
        front=RD/2-.03
        box('DEV_'+dv['id'],(.44,.62,hh),(0,front-.31,z),PANEL,g,.003,dv['id'])
        box('DEV_'+dv['id']+'_bez',(.448,.012,hh*.96),(0,front+.006,z),FACE,g,.002,dv['id'])
        detail_device(dv,g,front,z,hh)
    # Fill unused units: an airflow barrier, rather than empty glowing cabinets.
    for unit in range(1,43):
        if unit not in occupied:
            box(f'BODY_{rid}_blank{unit}',(.445,.012,U-.0015),(0,RD/2-.035,U_BASE+(unit-.5)*U),BLANK,g)


build_room()
build_aisle()
for row in L['rows']:
    for i,rid in enumerate(row['racks']):
        build_rack(rid,L['rackX'][i],L['rowY'][row['id']],1 if row['id']=='A' else -1)
bpy.context.view_layer.update()
# Export guard: precision AC units and rack equipment must remain inside the room.
for ob in bpy.data.objects:
    if ob.type=='MESH' and (ob.name.startswith('CRAC_') or ob.name.startswith('DEV_')):
        for corner in ob.bound_box:
            p=ob.matrix_world @ Vector(corner)
            assert -W/2 <= p.x <= W/2 and -D/2 <= p.y <= D/2, 'Out of room: '+ob.name

# Collapse decorative parts by parent/material/device. Business objects, LEDs,
# door hinge and transparent roof remain independent for picking and controls.
def batch_parts():
    groups = {}
    for ob in list(bpy.data.objects):
        if ob.type != 'MESH':
            continue
        material = ob.material_slots[0].material
        category = ob.name.split('_')[0]
        if ob.name.startswith('ENV_'):
            category = 'roof' if 'Roof' in ob.name else ('light' if 'Strip' in ob.name else 'environment')
        key = (ob.parent, material, ob.get('devId'), category)
        groups.setdefault(key, []).append(ob)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for (parent, material, dev, category), objects in groups.items():
        if len(objects) < 2:
            continue
        verts, faces, uvs, normals = [], [], [], []
        parent_inv = parent.matrix_world.inverted() if parent else None
        for ob in objects:
            evaluated = ob.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            transform = parent_inv @ ob.matrix_world if parent else ob.matrix_world
            normal_transform = transform.to_3x3().inverted().transposed()
            start = len(verts)
            verts.extend(tuple(transform @ v.co) for v in mesh.vertices)
            for poly in mesh.polygons:
                faces.append(tuple(start+i for i in poly.vertices))
                for li in poly.loop_indices:
                    uv = mesh.uv_layers.active.data[li].uv if mesh.uv_layers.active else (0,0)
                    uvs.append(tuple(uv))
                    normals.append(tuple((normal_transform @ mesh.corner_normals[li].vector).normalized()))
            evaluated.to_mesh_clear()
        name = objects[0].name
        for ob in objects:
            bpy.data.objects.remove(ob, do_unlink=True)
        mesh = bpy.data.meshes.new(name+'_batched')
        mesh.from_pydata(verts, [], faces)
        uv = mesh.uv_layers.new()
        for li, value in enumerate(uvs):
            uv.data[li].uv = value
        mesh.normals_split_custom_set(normals)
        mesh.materials.append(material)
        ob = bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(ob)
        ob.parent = parent
        if dev:
            ob['devId'] = dev

batch_parts()
# glTF can reference one mesh from many nodes. Reuse identical cabinet parts
# after batching instead of embedding the same door/rail geometry fourteen times.
def reuse_meshes():
    cache = {}
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or ob.modifiers:
            continue
        mesh = ob.data
        h = hashlib.sha256()
        for collection, attribute, width in ((mesh.vertices,'co',3),(mesh.loops,'vertex_index',1),
                                              (mesh.corner_normals,'vector',3)):
            a = np.empty(len(collection)*width,dtype=np.int32 if width==1 else np.float32)
            collection.foreach_get(attribute,a)
            h.update(np.round(a,6).tobytes())
        if mesh.uv_layers.active:
            a = np.empty(len(mesh.loops)*2,dtype=np.float32)
            mesh.uv_layers.active.data.foreach_get('uv',a)
            h.update(np.round(a,6).tobytes())
        h.update(str([(p.loop_start,p.loop_total) for p in mesh.polygons]).encode())
        h.update(str([m.name for m in mesh.materials]).encode())
        key = h.digest()
        if key in cache:
            ob.data = cache[key]
        else:
            cache[key] = mesh

reuse_meshes()
os.makedirs(os.path.dirname(OUT),exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',export_apply=True,
    export_yup=True,export_animations=False,export_skins=False,export_extras=True)
print(f'[build_dc_model] {len(bpy.data.objects)} objects, room standard, {len(L["devices"])} devices; {os.path.getsize(OUT)/1024:.0f} KB')
