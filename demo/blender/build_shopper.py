"""Rebuild the original Shelfville skinned shopper and motion library with Blender 5.

Run: Blender --background --python blender/build_shopper.py
No external models, add-ons or downloaded motion files are used.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
scene = bpy.context.scene
scene.render.fps = 30
scene.unit_settings.system = 'METRIC'

def material(name, color, roughness=.65, metallic=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    p = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    output = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    m.node_tree.links.new(p.outputs[0], output.inputs['Surface'])
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    return m

skin = material('Skin', (.63,.40,.27), .58)
top = material('Outerwear', (.18,.27,.31), .87)
inner = material('Cotton', (.83,.82,.73), .95)
pants = material('Trousers', (.07,.09,.12), .88)
hair = material('Hair', (.026,.019,.016), .82)
shoes = material('Shoes', (.07,.075,.07), .55)
sole = material('Sole', (.72,.70,.65), .78)
eye = material('Eyes', (.025,.021,.020), .45)
eye_white = material('EyeWhite', (.68,.65,.57), .5)
lips = material('Lips', (.35,.15,.11), .65)
metal = material('Metal', (.32,.35,.36), .35,.7)

armature = bpy.data.armatures.new('ShopperSkeleton')
rig = bpy.data.objects.new('ShopperRig', armature)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bones = [
    ('hips',(0,0,.91),(0,0,1.05),None),
    ('spine',(0,0,1.05),(0,0,1.28),'hips'),
    ('chest',(0,0,1.28),(0,0,1.46),'spine'),
    ('neck',(0,0,1.46),(0,0,1.55),'chest'),
    ('head',(0,0,1.55),(0,0,1.75),'neck'),
]
for side, x in [('L',1),('R',-1)]:
    bones += [
        ('shoulder.'+side,(0,0,1.43),(x*.22,0,1.43),'chest'),
        ('upper_arm.'+side,(x*.22,0,1.43),(x*.29,0,1.13),'shoulder.'+side),
        ('forearm.'+side,(x*.29,0,1.13),(x*.30,-.01,.88),'upper_arm.'+side),
        ('hand.'+side,(x*.30,-.01,.88),(x*.30,-.018,.77),'forearm.'+side),
        ('thigh.'+side,(x*.105,0,.94),(x*.108,-.014,.53),'hips'),
        ('shin.'+side,(x*.108,-.014,.53),(x*.108,0,.12),'thigh.'+side),
        ('foot.'+side,(x*.108,0,.12),(x*.108,-.15,.075),'shin.'+side),
    ]
for name, head, tail, parent in bones:
    b = armature.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
for bone in rig.pose.bones:
    bone.rotation_mode = 'XYZ'
rig.select_set(False)
pieces = []

def bind(obj, bone, mat):
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    pieces.append(obj)
    return obj

def ellipsoid(name, center, scale, mat, bone, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return bind(obj, bone, mat)

def rounded(name, center, scale, mat, bone, bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = obj.modifiers.new('Tailored edges','BEVEL')
    mod.width = bevel
    mod.segments = 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return bind(obj,bone,mat)

def tube(name, rings, mat, weights, resolution=16):
    """Ring loft with per-height blended skin weights across knees and elbows."""
    verts, faces = [], []
    for x,y,z,rx,ry in rings:
        for j in range(resolution):
            angle = j/resolution*math.tau
            verts.append((x+rx*math.cos(angle), y+ry*math.sin(angle),z))
    for i in range(len(rings)-1):
        for j in range(resolution):
            a=i*resolution+j;b=i*resolution+(j+1)%resolution
            faces.append((a,b,b+resolution,a+resolution))
    faces += [tuple(reversed(range(resolution))),tuple((len(rings)-1)*resolution+j for j in range(resolution))]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);mesh.materials.append(mat)
    groups={}
    for i,v in enumerate(verts):
        for bone,weight in weights(v[2]).items():
            if bone not in groups:groups[bone]=obj.vertex_groups.new(name=bone)
            if weight>0:groups[bone].add([i],weight,'REPLACE')
    for p in mesh.polygons:p.use_smooth=True
    pieces.append(obj)
    return obj

def blend(z, joint, upper, lower, width=.07):
    weight=max(0,min(1,(z-joint+width)/(2*width)))
    return {upper:weight,lower:1-weight}

# Anatomical proportions: 1.76 m, 7.5 heads. Silhouettes have a waist, shoulders,
# knees, shoes, separate fingers, eyelids, ears and a slightly asymmetric fringe.
tube('Jacket',[(0,0,.93,.14,.10),(0,0,1.0,.165,.113),(0,0,1.16,.145,.11),
              (0,0,1.31,.19,.125),(0,0,1.41,.217,.115),(0,0,1.455,.15,.088)],
     top,lambda z:blend(z,1.28,'chest','spine',.12))
rounded('TShirt', (0,-.116,1.29),(.19,.024,.31),inner,'chest',.02)
for x in [-1,1]:
    lapel=rounded('Lapel',(x*.11,-.128,1.36),(.072,.023,.22),top,'chest',.01)
    lapel.rotation_euler.y=x*.18
    rounded('Pocket',(x*.115,-.117,1.075),(.072,.015,.082),top,'spine',.01)
    for z in [1.13,1.23,1.33]:
        ellipsoid('Button',(x*.035,-.139,z),(.006,.006,.006),metal,'spine',8,6)
ellipsoid('Neck',(0,0,1.505),(.058,.053,.095),skin,'neck')
ellipsoid('Face',(0,-.003,1.635),(.102,.088,.132),skin,'head',24,16)
ellipsoid('Jaw',(0,-.024,1.575),(.071,.067,.061),skin,'head')
ellipsoid('Nose',(0,-.09,1.63),(.02,.027,.031),skin,'head')
ellipsoid('NoseTip',(0,-.109,1.616),(.019,.012,.014),skin,'head')
ellipsoid('Mouth',(0,-.088,1.583),(.029,.006,.006),lips,'head')
for x in [-1,1]:
    ellipsoid('Ear',(x*.099,0,1.632),(.014,.024,.04),skin,'head')
    ellipsoid('EyeWhite',(x*.038,-.081,1.653),(.022,.007,.009),eye_white,'head')
    ellipsoid('Iris',(x*.038,-.087,1.653),(.007,.003,.007),eye,'head')
    brow=rounded('Brow',(x*.038,-.081,1.674),(.035,.008,.005),hair,'head',.002)
    brow.rotation_euler.y=x*.12
ellipsoid('HairCap',(0,.005,1.706),(.104,.09,.066),hair,'head',24,12)
for i in range(7):
    fringe=ellipsoid('Fringe',(-.074+i*.024,-.06,1.714-i*.002),(.036,.043,.028),hair,'head')
    fringe.rotation_euler.y=-.24
ellipsoid('HairBack',(0,.065,1.66),(.087,.036,.094),hair,'head')

for side,x in [('L',1),('R',-1)]:
    upper='upper_arm.'+side;fore='forearm.'+side;hand='hand.'+side
    tube('Sleeve.'+side,[(x*.223,0,1.43,.066,.078),(x*.25,0,1.34,.064,.066),
         (x*.277,0,1.20,.051,.051),(x*.29,0,1.13,.053,.05),(x*.297,-.005,1.05,.046,.044),
         (x*.30,-.01,.92,.04,.037)],top,lambda z,u=upper,f=fore:blend(z,1.13,u,f))
    ellipsoid('Wrist',(x*.30,-.01,.90),(.034,.032,.034),skin,hand)
    ellipsoid('Palm',(x*.30,-.013,.843),(.039,.023,.058),skin,hand)
    for finger in range(4):
        ellipsoid('Finger',(x*(.273+finger*.018),-.018,.785+abs(finger-1.4)*.004),
                  (.009,.012,.032),skin,hand,10,8)
    ellipsoid('Thumb',(x*.257,-.028,.834),(.014,.015,.031),skin,hand,10,8)
    thigh='thigh.'+side;shin='shin.'+side;foot='foot.'+side
    tube('TrouserLeg.'+side,[(x*.10,0,.96,.095,.106),(x*.106,0,.84,.088,.096),
         (x*.108,-.008,.65,.07,.072),(x*.108,-.014,.53,.068,.07),
         (x*.108,-.008,.42,.061,.065),(x*.108,0,.24,.05,.053),(x*.108,0,.13,.052,.052)],
         pants,lambda z,t=thigh,s=shin:blend(z,.53,t,s,.075))
    ellipsoid('Sneaker',(x*.108,-.062,.085),(.066,.14,.064),shoes,foot)
    rounded('Sole',(x*.108,-.067,.035),(.135,.27,.037),sole,foot,.016)
    for lace in range(4):
        rounded('Lace',(x*.108,-.04-lace*.026,.137-lace*.006),(.072,.009,.008),inner,foot,.003)

# All pieces share one skinned mesh / armature, rather than independent rigid boxes.
bpy.ops.object.select_all(action='DESELECT')
for obj in pieces:obj.select_set(True)
bpy.context.view_layer.objects.active=pieces[0]
bpy.ops.object.join()
body=bpy.context.object;body.name='ShopperBody'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
modifier=body.modifiers.new('Skinning','ARMATURE');modifier.object=rig
body.parent=rig

rig.animation_data_create()
def reset_pose():
    for b in rig.pose.bones:
        b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
def rx(name,value):rig.pose.bones[name].rotation_euler.x=value
def ry(name,value):rig.pose.bones[name].rotation_euler.y=value
clips=[('Idle',90),('Walk',32),('Carry',32),('Browse',90),('ReachMiddle',66),('ReachLow',66),('ReachHigh',66),('Pay',72)]
for clip,length in clips:
    action=bpy.data.actions.new(clip);rig.animation_data.action=action
    for frame in range(1,length+2,2):
        t=(frame-1)/length;wave=math.sin(t*math.tau);pulse=math.sin(t*math.pi)**2
        reset_pose()
        if clip in ['Walk','Carry']:
            for side,sign in [('L',1),('R',-1)]:
                rx('thigh.'+side,.33*wave*sign)
                rx('shin.'+side,-max(0,wave*sign)*.50)
                rx('foot.'+side,-.12*wave*sign)
                rx('upper_arm.'+side,-.24*wave*sign)
                rx('forearm.'+side,.12)
            rig.pose.bones['hips'].location.y=.012*abs(wave)
            ry('chest',wave*.045)
            if clip=='Carry':
                rx('upper_arm.L',-.10);rx('forearm.L',-.28)
        elif clip in ['ReachMiddle','ReachLow','ReachHigh']:
            low=clip=='ReachLow';high=clip=='ReachHigh'
            rx('upper_arm.R',-pulse*(2.35 if high else 1.03))
            rx('forearm.R',-pulse*.3)
            ry('chest',-pulse*.08)
            rx('spine',pulse*(.38 if low else .05))
            rx('head',pulse*(.32 if low else -.12 if high else .04))
            if low:
                rig.pose.bones['hips'].location.y=-pulse*.22
                for side in ['L','R']:
                    rx('thigh.'+side,pulse*.63);rx('shin.'+side,-pulse*1.1);rx('foot.'+side,pulse*.45)
        elif clip=='Browse':
            ry('head',wave*.22);rx('head',.12+.055*wave)
            rx('forearm.R',-.35-.18*pulse);rx('upper_arm.R',-.12*pulse)
        elif clip=='Pay':
            rx('upper_arm.R',-.65*pulse);rx('forearm.R',-.7*pulse);rx('head',.2*pulse)
        else:
            rx('chest',wave*.012);ry('head',wave*.045)
            rx('forearm.R',-.08);rx('forearm.L',-.06)
        for b in rig.pose.bones:
            b.keyframe_insert(data_path='rotation_euler',frame=frame,group=b.name)
            b.keyframe_insert(data_path='location',frame=frame,group=b.name)
    action.use_fake_user=True
    track=rig.animation_data.nla_tracks.new();track.name=clip
    track.strips.new(clip,1,action)
    rig.animation_data.action=None
reset_pose()
scene.frame_set(1)
for track in rig.animation_data.nla_tracks:track.mute=True

ROOT.joinpath('assets').mkdir(exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender'/'shopper.blend'))
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets'/'shopper.glb'),export_format='GLB',
    use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',
    export_force_sampling=True,export_skins=True,export_def_bones=True)
print('SHELFVILLE ASSET COMPLETE', len(body.data.vertices), 'vertices;', len(bones), 'bones;', len(clips),'clips')
