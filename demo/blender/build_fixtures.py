"""Original bevelled coffee machine and checkout terminal; Blender -> GLB."""
import bpy
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

def mat(name,color,metallic=0,roughness=.45):
    m=bpy.data.materials.new(name);m.use_nodes=True
    m.node_tree.nodes.clear()
    p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    out=m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    m.node_tree.links.new(p.outputs[0],out.inputs[0])
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metallic;p.inputs['Roughness'].default_value=roughness
    return m
steel=mat('Brushed steel',(.40,.43,.46),.8,.27)
black=mat('Matte appliance',(.024,.029,.034),.3,.38)
chrome=mat('Chrome',(.6,.62,.64),.95,.16)
screen=mat('Screen',(.019,.065,.072),.15,.2)
glass=mat('Hopper glass',(.07,.065,.045),.1,.2)
beans=mat('Beans',(.06,.027,.013),0,.68)
white=mat('Porcelain',(.83,.81,.76),0,.3)
blue=mat('Interface light',(.19,.54,.62),0,.35)

def group(name):
    obj=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(obj);return obj
def box(name,loc,size,material,parent,bevel=.014):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);obj=bpy.context.object;obj.name=name
    obj.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=obj.modifiers.new('Machined bevels','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(material);obj.parent=parent
    for p in obj.data.polygons:p.use_smooth=True
    # Weighted normals preserve flat machined panels.
    norm=obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL');norm.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=norm.name)
    return obj
def cylinder(name,loc,radius,depth,material,parent):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=depth,location=loc)
    obj=bpy.context.object;obj.name=name;obj.data.materials.append(material);obj.parent=parent
    mod=obj.modifiers.new('Edge finish','BEVEL');mod.width=.006;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:p.use_smooth=True
    return obj

# Blender -Y faces the aisle; glTF conversion makes that +Z.
machine=group('CoffeeMachine')
box('Body',(0,0,.36),(.56,.53,.70),black,machine,.025)
box('FrontPanel',(0,-.278,.42),(.52,.025,.45),steel,machine)
box('BrewCavity',(0,-.296,.25),(.30,.016,.29),black,machine,.006)
box('Touchscreen',(0,-.30,.535),(.25,.018,.135),screen,machine,.01)
for i in range(3):
    box('TouchIcon',(-.077+i*.077,-.312,.53),(.036,.004,.032),blue,machine,.004)
for x in [-.074,.074]:
    cylinder('Spout',(x,-.337,.37),.022,.08,chrome,machine)
box('DripTray',(0,-.335,.10),(.39,.21,.034),steel,machine,.014)
for i in range(9):box('TrayGrille',(-.155+i*.039,-.346,.120),(.011,.15,.006),black,machine,.002)
for x in [-.19,.19]:
    knob=cylinder('ControlKnob',(x,-.312,.53),.029,.023,chrome,machine);knob.rotation_euler.x=math.pi/2
cylinder('BeanHopper',(0,.035,.765),.16,.18,glass,machine)
cylinder('HopperLid',(0,.035,.858),.168,.016,black,machine)
for i in range(25):
    angle=i*2.4;r=.12*math.sqrt((i+.5)/25)
    bean=cylinder('CoffeeBean',(r*math.cos(angle),.035+r*math.sin(angle),.831),.014,.009,beans,machine)
    bean.scale.y=.6
cylinder('Cup',(0,-.35,.19),.058,.12,white,machine)
cylinder('CoffeeSurface',(0,-.35,.254),.049,.002,beans,machine)

terminal=group('CheckoutTerminal');terminal.location.x=2
box('Base',(2,0,.035),(.40,.32,.06),black,terminal,.02)
box('Stand',(2,.04,.18),(.09,.10,.29),steel,terminal)
panel=box('Display',(2,0,.36),(.50,.06,.33),black,terminal,.018)
box('DisplayGlass',(2,-.037,.36),(.445,.008,.273),screen,terminal,.009)
for row in range(4):
    box('ReceiptLine',(1.895,-.044,.445-row*.045),(.20,.003,.012),white,terminal,.003)
for x in [2.07,2.17]:
    for z in [.40,.32]:box('CheckoutUI',(x,-.044,z),(.074,.003,.057),blue,terminal,.005)
box('CardReader',(2.37,-.03,.06),(.18,.24,.10),black,terminal,.016)
box('ReaderDisplay',(2.37,-.06,.12),(.13,.10,.008),screen,terminal,.006)
for x in [-.04,0,.04]:
    for y in [0,.035,.07]:box('Key',(2.37+x,.015+y,.115),(.025,.023,.006),steel,terminal,.003)

# Store each assembly in its own file at a shared origin.
for root,name in [(machine,'coffee-machine'),(terminal,'checkout-terminal')]:
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for child in root.children:child.select_set(True)
    bpy.context.view_layer.objects.active=root
    if root==terminal:
        # Children keep local transforms as assigned above, so move both parent origin and geometry.
        for child in root.children:child.location.x-=2
        root.location.x=0
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets'/(name+'.glb')),export_format='GLB',use_selection=True,export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender'/'fixtures.blend'))
print('FIXTURES COMPLETE')
