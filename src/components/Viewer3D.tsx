import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  resolveBlockParts,
  textureUrl,
  type ModelFaceName,
  type ResolvedBlockPart,
} from '../lib/minecraftModels';
import type { SchematicDimensions, SchematicModel, VoxelBlock } from '../lib/schematic';

interface Viewer3DProps {
  model: SchematicModel | null;
  visibleLayer: number;
  singleLayer: boolean;
  autoRotate: boolean;
  showGrid: boolean;
  selectedBlock: VoxelBlock | null;
  onBlockSelect?: (block: VoxelBlock | null) => void;
  onReady?: () => void;
}

type CameraPreset = 'front' | 'right' | 'back' | 'left' | 'top';

export interface Viewer3DHandle {
  setPreset: (preset: CameraPreset) => void;
  spinOnce: () => void;
}

interface InternalViewerProps extends Viewer3DProps {
  viewerRef: MutableRefObject<Viewer3DHandle | null>;
}

const faceOrder: ModelFaceName[] = ['east', 'west', 'up', 'down', 'south', 'north'];
const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();
const textureLoader = new THREE.TextureLoader();
const defaultFoliageTint = 0x48b518;
const birchFoliageTint = 0x80a755;
const spruceFoliageTint = 0x619961;
const hiddenMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});

export function Viewer3D(props: InternalViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const selectionBoxRef = useRef<THREE.LineSegments | null>(null);
  const frameRef = useRef<number | null>(null);
  const spinRef = useRef<{ start: number; duration: number; from: number; to: number } | null>(null);
  const latestModelRef = useRef<SchematicModel | null>(props.model);
  const onBlockSelectRef = useRef(props.onBlockSelect);

  const filteredBlocks = useMemo(() => {
    if (!props.model) return [];
    return props.model.blocks.filter((block) =>
      props.singleLayer ? block.y === props.visibleLayer : block.y <= props.visibleLayer,
    );
  }, [props.model, props.singleLayer, props.visibleLayer]);

  useEffect(() => {
    latestModelRef.current = props.model;
  }, [props.model]);

  useEffect(() => {
    onBlockSelectRef.current = props.onBlockSelect;
  }, [props.onBlockSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f0e8);
    scene.fog = new THREE.Fog(0xf3f0e8, 70, 180);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.set(24, 20, 28);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 240;
    controls.autoRotateSpeed = 1.4;
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xfffbef, 0x5f6f70, 2.8);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2d6, 3.4);
    key.position.set(28, 42, 24);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9eb8c0, 1.2);
    fill.position.set(-18, 16, -28);
    scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0xe0d8c6, roughness: 0.94, metalness: 0.02 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.56;
    floor.receiveShadow = true;
    scene.add(floor);

    const modelGroup = new THREE.Group();
    modelGroupRef.current = modelGroup;
    scene.add(modelGroup);

    const gridGroup = new THREE.Group();
    gridRef.current = gridGroup;
    scene.add(gridGroup);

    const selectionBox = createSelectionBox();
    selectionBoxRef.current = selectionBox;
    scene.add(selectionBox);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const pointerStart = { x: 0, y: 0 };
    const handlePointerDown = (event: PointerEvent) => {
      pointerStart.x = event.clientX;
      pointerStart.y = event.clientY;
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      if (distance > 5) return;

      const block = pickBlock(event, renderer, camera, modelGroup);
      onBlockSelectRef.current?.(block);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const animate = (time: number) => {
      if (controlsRef.current) {
        const latestModel = latestModelRef.current;
        if (spinRef.current && latestModel) {
          updateSpin(time, latestModel.dimensions, controlsRef.current, camera, spinRef);
        }
        controlsRef.current.update();
      }

      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };

    frameRef.current = window.requestAnimationFrame(animate);
    props.viewerRef.current = {
      setPreset: (preset) => {
        const latestModel = latestModelRef.current;
        if (latestModel) {
          setCameraPreset(preset, latestModel.dimensions, camera, controls);
        }
      },
      spinOnce: () => {
        spinRef.current = {
          start: performance.now(),
          duration: 4800,
          from: controls.getAzimuthalAngle(),
          to: controls.getAzimuthalAngle() + Math.PI * 2,
        };
      },
    };

    props.onReady?.();

    return () => {
      props.viewerRef.current = null;
      observer.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      disposeObject(scene);
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      selectionBoxRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.autoRotate = props.autoRotate;
  }, [props.autoRotate]);

  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;

    clearGroup(group, false);

    if (!props.model) return;

    let cancelled = false;

    void createBlockMeshes(filteredBlocks).then((meshes) => {
      if (cancelled) return;
      clearGroup(group, false);
      for (const mesh of meshes) {
        group.add(mesh);
      }
      centerGroup(group, props.model!.dimensions);
    });

    return () => {
      cancelled = true;
    };
  }, [filteredBlocks, props.model]);

  useEffect(() => {
    const gridGroup = gridRef.current;
    if (!gridGroup) return;

    clearGroup(gridGroup);

    if (!props.model || !props.showGrid) return;

    const helper = createFootprintGrid(props.model.dimensions);
    gridGroup.add(helper);
    centerGroup(gridGroup, props.model.dimensions);
  }, [props.model, props.showGrid]);

  useEffect(() => {
    const selectionBox = selectionBoxRef.current;
    if (!selectionBox) return;

    const block = props.selectedBlock;
    if (!props.model || !block) {
      selectionBox.visible = false;
      return;
    }

    const isVisible = props.singleLayer ? block.y === props.visibleLayer : block.y <= props.visibleLayer;
    if (!isVisible) {
      selectionBox.visible = false;
      return;
    }

    selectionBox.position.set(
      block.x - (props.model.dimensions.width - 1) / 2,
      block.y,
      block.z - (props.model.dimensions.length - 1) / 2,
    );
    selectionBox.visible = true;
  }, [props.model, props.selectedBlock, props.singleLayer, props.visibleLayer]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!props.model || !camera || !controls) return;

    fitCameraToModel(props.model.dimensions, camera, controls);
  }, [props.model]);

  return <div className="viewer-canvas" data-testid="viewer-canvas" ref={containerRef} />;
}

async function createBlockMeshes(blocks: VoxelBlock[]): Promise<THREE.InstancedMesh[]> {
  const groups = new Map<
    string,
    {
      part: ResolvedBlockPart;
      fallbackColor: number;
      blocks: VoxelBlock[];
    }
  >();
  const states = Array.from(new Set(blocks.map((block) => block.stateKey)));
  const resolvedStates = await Promise.all(states.map(async (state) => [state, await resolveBlockParts(state)] as const));
  const partsByState = new Map(resolvedStates);

  for (const block of blocks) {
    const parts = partsByState.get(block.stateKey) ?? [];

    for (const part of parts) {
      const key = part.isFallback ? `${part.key}::${block.color}` : part.key;
      const group = groups.get(key);

      if (group) {
        group.blocks.push(block);
      } else {
        groups.set(key, {
          part,
          fallbackColor: block.color,
          blocks: [block],
        });
      }
    }
  }

  const matrix = new THREE.Matrix4();
  const meshes: THREE.InstancedMesh[] = [];

  for (const group of groups.values()) {
    const geometry = geometryForPart(group.part);
    const materials = materialsForPart(group.part, group.fallbackColor);
    const mesh = new THREE.InstancedMesh(geometry, materials, group.blocks.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(group.part.variantRotation.x),
        THREE.MathUtils.degToRad(variantYRotation(group.part)),
        0,
      ),
    );
    const scale = new THREE.Vector3(1, 1, 1);

    group.blocks.forEach((block, index) => {
      matrix.compose(new THREE.Vector3(block.x, block.y, block.z), quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.blocks = group.blocks;
    meshes.push(mesh);
  }

  return meshes;
}

function createSelectionBox(): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08));
  const material = new THREE.LineBasicMaterial({
    color: 0xf7c948,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const box = new THREE.LineSegments(geometry, material);
  box.renderOrder = 20;
  box.visible = false;
  return box;
}

function pickBlock(
  event: PointerEvent,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  modelGroup: THREE.Group,
): VoxelBlock | null {
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObjects(modelGroup.children, false);
  const hit = intersections.find((intersection) => intersection.instanceId !== undefined);
  if (!hit || hit.instanceId === undefined) return null;

  const mesh = hit.object as THREE.InstancedMesh;
  const blocks = mesh.userData.blocks as VoxelBlock[] | undefined;
  return blocks?.[hit.instanceId] ?? null;
}

function geometryForPart(part: ResolvedBlockPart): THREE.BufferGeometry {
  const key = `${part.from.join(',')}::${part.to.join(',')}::${
    part.elementRotation
      ? `${part.elementRotation.axis}:${part.elementRotation.angle}:${part.elementRotation.origin.join(',')}`
      : 'none'
  }`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const width = Math.max(0.001, (part.to[0] - part.from[0]) / 16);
  const height = Math.max(0.001, (part.to[1] - part.from[1]) / 16);
  const depth = Math.max(0.001, (part.to[2] - part.from[2]) / 16);
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(
    (part.from[0] + part.to[0]) / 32 - 0.5,
    (part.from[1] + part.to[1]) / 32 - 0.5,
    (part.from[2] + part.to[2]) / 32 - 0.5,
  );

  if (part.elementRotation) {
    const origin = new THREE.Vector3(
      part.elementRotation.origin[0] / 16 - 0.5,
      part.elementRotation.origin[1] / 16 - 0.5,
      part.elementRotation.origin[2] / 16 - 0.5,
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const radians = THREE.MathUtils.degToRad(part.elementRotation.angle);
    if (part.elementRotation.axis === 'x') rotation.makeRotationX(radians);
    if (part.elementRotation.axis === 'y') rotation.makeRotationY(radians);
    if (part.elementRotation.axis === 'z') rotation.makeRotationZ(radians);

    matrix.makeTranslation(origin.x, origin.y, origin.z);
    matrix.multiply(rotation);
    matrix.multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
    geometry.applyMatrix4(matrix);
  }

  geometryCache.set(key, geometry);
  return geometry;
}

function materialsForPart(part: ResolvedBlockPart, fallbackColor: number): THREE.Material[] {
  return faceOrder.map((face) => {
    const textureId = part.faceTextures[face];
    if (!textureId) {
      return part.isFallback ? colorMaterial(fallbackColor) : hiddenMaterial;
    }

    return textureMaterial(textureId, tintColorForPart(textureId, part.faceTints[face], part));
  });
}

function textureMaterial(textureId: string, tintColor: number | null): THREE.Material {
  const key = `texture::${textureId}::${tintColor ?? 'none'}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const texture = textureLoader.load(textureUrl(textureId));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: tintColor ?? 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
  });
  materialCache.set(key, material);
  return material;
}

function tintColorForPart(textureId: string, tintIndex: number | null, part: ResolvedBlockPart): number | null {
  if (tintIndex === null) return null;
  const path = textureId.replace(/^minecraft:/, '');

  if (part.blockId === 'minecraft:redstone_wire' && tintIndex === 0) {
    return redstoneWireColor(part.blockProperties.power);
  }

  if (path.includes('spruce_leaves')) return spruceFoliageTint;
  if (path.includes('birch_leaves')) return birchFoliageTint;
  if (path.includes('leaves') || path.includes('vine') || path.includes('grass') || path.includes('fern')) {
    return defaultFoliageTint;
  }

  return null;
}

function redstoneWireColor(powerValue: string | undefined): number {
  const power = Math.max(0, Math.min(15, Number.parseInt(powerValue ?? '0', 10) || 0));
  const strength = power / 15;
  const red = power === 0 ? 0.3 : strength * 0.6 + 0.4;
  const green = Math.max(0, strength * strength * 0.7 - 0.5);
  const blue = Math.max(0, strength * strength * 0.6 - 0.7);

  return (
    (Math.round(red * 255) << 16) |
    (Math.round(green * 255) << 8) |
    Math.round(blue * 255)
  );
}

function variantYRotation(part: ResolvedBlockPart): number {
  if (part.blockId === 'minecraft:redstone_wire') {
    return -part.variantRotation.y;
  }

  return part.variantRotation.y;
}

function colorMaterial(color: number): THREE.Material {
  const key = `color::${color}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.86,
    metalness: 0.02,
  });
  materialCache.set(key, material);
  return material;
}

function fitCameraToModel(
  dimensions: SchematicDimensions,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const target = new THREE.Vector3(0, Math.max(0, dimensions.height / 2 - 0.5), 0);
  const radius = Math.max(dimensions.width, dimensions.length, dimensions.height, 8);
  controls.target.copy(target);
  camera.position.set(radius * 1.35, radius * 0.95 + dimensions.height * 0.4, radius * 1.45);
  camera.near = Math.max(0.1, radius / 100);
  camera.far = Math.max(500, radius * 12);
  camera.updateProjectionMatrix();
  controls.update();
}

function setCameraPreset(
  preset: CameraPreset,
  dimensions: SchematicDimensions,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const radius = Math.max(dimensions.width, dimensions.length, dimensions.height, 8) * 1.85;
  const target = new THREE.Vector3(0, Math.max(0, dimensions.height / 2 - 0.5), 0);
  const y = preset === 'top' ? radius : radius * 0.48;

  const positions: Record<CameraPreset, THREE.Vector3> = {
    front: new THREE.Vector3(0, y, radius),
    right: new THREE.Vector3(radius, y, 0),
    back: new THREE.Vector3(0, y, -radius),
    left: new THREE.Vector3(-radius, y, 0),
    top: new THREE.Vector3(0.01, radius, 0.01),
  };

  controls.target.copy(target);
  camera.position.copy(positions[preset]);
  camera.lookAt(target);
  controls.update();
}

function updateSpin(
  time: number,
  dimensions: SchematicDimensions,
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
  spinRef: MutableRefObject<{ start: number; duration: number; from: number; to: number } | null>,
) {
  const spin = spinRef.current;
  if (!spin) return;

  const progress = Math.min(1, (time - spin.start) / spin.duration);
  const eased = 1 - Math.pow(1 - progress, 4);
  const angle = spin.from + (spin.to - spin.from) * eased;
  const radius = Math.max(dimensions.width, dimensions.length, dimensions.height, 8) * 1.85;
  const target = new THREE.Vector3(0, Math.max(0, dimensions.height / 2 - 0.5), 0);

  camera.position.set(Math.sin(angle) * radius, radius * 0.52, Math.cos(angle) * radius);
  controls.target.copy(target);
  camera.lookAt(target);

  if (progress >= 1) {
    spinRef.current = null;
  }
}

function centerGroup(group: THREE.Group, dimensions: SchematicDimensions) {
  group.position.set(-(dimensions.width - 1) / 2, 0, -(dimensions.length - 1) / 2);
}

function createFootprintGrid(dimensions: SchematicDimensions): THREE.LineSegments {
  const vertices: number[] = [];
  const material = new THREE.LineBasicMaterial({ color: 0x4d5b54, transparent: true, opacity: 0.28 });

  for (let x = -0.5; x <= dimensions.width - 0.5; x += 1) {
    vertices.push(x, -0.02, -0.5, x, -0.02, dimensions.length - 0.5);
  }

  for (let z = -0.5; z <= dimensions.length - 0.5; z += 1) {
    vertices.push(-0.5, -0.02, z, dimensions.width - 0.5, -0.02, z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, material);
}

function clearGroup(group: THREE.Group, dispose = true) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    if (dispose) {
      disposeObject(child);
    }
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}
