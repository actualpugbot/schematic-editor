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
  hiddenMaterialIds: Set<string>;
  playerHeadSelections: Record<string, string>;
  autoRotate: boolean;
  showGrid: boolean;
  selectedBlock: VoxelBlock | null;
  onBlockSelect?: (block: VoxelBlock | null) => void;
  onReady?: () => void;
}

export interface Viewer3DHandle {
  spinOnce: () => void;
}

interface InternalViewerProps extends Viewer3DProps {
  viewerRef: MutableRefObject<Viewer3DHandle | null>;
}

const faceOrder: ModelFaceName[] = ['east', 'west', 'up', 'down', 'south', 'north'];
const faceOffsets: Record<ModelFaceName, [number, number, number]> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};
const oppositeFaces: Record<ModelFaceName, ModelFaceName> = {
  down: 'up',
  up: 'down',
  north: 'south',
  south: 'north',
  west: 'east',
  east: 'west',
};
const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');
const defaultFoliageTint = 0x48b518;
const birchFoliageTint = 0x80a755;
const spruceFoliageTint = 0x619961;
const waterTint = 0x4f9dff;
const hiddenMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});
const horizontalFaces = new Set<ModelFaceName>(['north', 'south', 'west', 'east']);

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
      !props.hiddenMaterialIds.has(blockMaterialId(block))
      && (props.singleLayer ? block.y === props.visibleLayer : block.y <= props.visibleLayer),
    );
  }, [props.hiddenMaterialIds, props.model, props.singleLayer, props.visibleLayer]);

  useEffect(() => {
    latestModelRef.current = props.model;
  }, [props.model]);

  useEffect(() => {
    onBlockSelectRef.current = props.onBlockSelect;
  }, [props.onBlockSelect]);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.fog = null;
    }
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f0e8);
    scene.fog = null;
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

    void createBlockMeshes(filteredBlocks, props.playerHeadSelections).then((meshes) => {
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
  }, [filteredBlocks, props.model, props.playerHeadSelections]);

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

    const isVisible =
      !props.hiddenMaterialIds.has(blockMaterialId(block))
      && (props.singleLayer ? block.y === props.visibleLayer : block.y <= props.visibleLayer);
    if (!isVisible) {
      selectionBox.visible = false;
      return;
    }

    let cancelled = false;
    selectionBox.visible = false;

    void createSelectionBoxGeometry(block, filteredBlocks, props.playerHeadSelections).then((geometry) => {
      if (cancelled) {
        geometry.dispose();
        return;
      }

      selectionBox.geometry.dispose();
      selectionBox.geometry = geometry;
      selectionBox.position.set(
        block.x - (props.model!.dimensions.width - 1) / 2,
        block.y,
        block.z - (props.model!.dimensions.length - 1) / 2,
      );
      selectionBox.visible = true;
    });

    return () => {
      cancelled = true;
    };
  }, [
    filteredBlocks,
    props.hiddenMaterialIds,
    props.model,
    props.playerHeadSelections,
    props.selectedBlock,
    props.singleLayer,
    props.visibleLayer,
  ]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!props.model || !camera || !controls) return;

    fitCameraToModel(props.model.dimensions, camera, controls);
  }, [props.model]);

  return <div className="viewer-canvas" data-testid="viewer-canvas" ref={containerRef} />;
}

async function createBlockMeshes(
  blocks: VoxelBlock[],
  playerHeadSelections: Record<string, string>,
): Promise<THREE.InstancedMesh[]> {
  const groups = new Map<
    string,
    {
      part: ResolvedBlockPart;
      fallbackColor: number;
      hiddenFaces: Set<ModelFaceName>;
      blocks: VoxelBlock[];
    }
  >();
  const states = Array.from(new Set(blocks.map((block) => renderStateKeyForBlock(block, playerHeadSelections))));
  const resolvedStates = await Promise.all(states.map(async (state) => [state, await resolveBlockParts(state)] as const));
  const partsByState = new Map(resolvedStates);
  const occludingFacesByBlock = new Map<string, Set<ModelFaceName>>();
  const boundaryFacesByBlock = new Map<string, Set<ModelFaceName>>();
  const translucentBoundaryFacesByBlock = new Map<string, Set<ModelFaceName>>();
  const partsByBlock = new Map<string, ResolvedBlockPart[]>();

  for (const block of blocks) {
    const parts = partsByState.get(renderStateKeyForBlock(block, playerHeadSelections)) ?? [];
    partsByBlock.set(blockPositionKey(block), parts);
    occludingFacesByBlock.set(blockPositionKey(block), occludingFacesForParts(parts));
    boundaryFacesByBlock.set(blockPositionKey(block), boundaryFacesForParts(parts));
    translucentBoundaryFacesByBlock.set(blockPositionKey(block), boundaryFacesForParts(parts, true));
  }

  for (const block of blocks) {
    const parts = partsByState.get(renderStateKeyForBlock(block, playerHeadSelections)) ?? [];

    for (const part of parts) {
      const hiddenFaces = hiddenFacesForPart(
        block,
        part,
        occludingFacesByBlock,
        boundaryFacesByBlock,
        translucentBoundaryFacesByBlock,
        partsByBlock,
      );
      const hiddenFaceKey = hiddenFaceCacheKey(hiddenFaces);
      const key = `${part.isFallback ? `${part.key}::${block.color}` : part.key}::hidden:${hiddenFaceKey}`;
      const group = groups.get(key);

      if (group) {
        group.blocks.push(block);
      } else {
        groups.set(key, {
          part,
          fallbackColor: block.color,
          hiddenFaces,
          blocks: [block],
        });
      }
    }
  }

  const matrix = new THREE.Matrix4();
  const meshes: THREE.InstancedMesh[] = [];

  for (const group of groups.values()) {
    const geometry = geometryForPart(group.part);
    const materials = materialsForPart(group.part, group.fallbackColor, group.hiddenFaces);
    const mesh = new THREE.InstancedMesh(geometry, materials, group.blocks.length);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = partHasTranslucentFaces(group.part) ? 10 : 0;

    const quaternion = new THREE.Quaternion().setFromEuler(variantEuler(group.part));
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

function blockPositionKey(block: VoxelBlock): string {
  return `${block.x},${block.y},${block.z}`;
}

function renderStateKeyForBlock(block: VoxelBlock, playerHeadSelections: Record<string, string>): string {
  if (!block.playerHeadTexture && block.name !== 'minecraft:player_head' && block.name !== 'minecraft:player_wall_head') {
    return block.stateKey;
  }

  const textureId = playerHeadSelections[blockPositionKey(block)] ?? block.playerHeadTexture?.id;
  if (!textureId) return block.stateKey;

  return setBlockStateProperty(block.stateKey, 'schemview_head', textureId);
}

function setBlockStateProperty(stateKey: string, key: string, value: string): string {
  const match = /^(?<id>[^\[]+)(?:\[(?<properties>.*)\])?$/.exec(stateKey);
  if (!match?.groups) return stateKey;

  const properties = new Map<string, string>();
  const rawProperties = match.groups.properties;
  if (rawProperties) {
    for (const pair of rawProperties.split(',')) {
      const [propertyKey, propertyValue] = pair.split('=');
      if (propertyKey && propertyValue !== undefined && propertyKey !== key) {
        properties.set(propertyKey, propertyValue);
      }
    }
  }
  properties.set(key, value);

  return `${match.groups.id}[${Array.from(properties.entries()).map(([propertyKey, propertyValue]) => `${propertyKey}=${propertyValue}`).join(',')}]`;
}

function blockMaterialId(block: VoxelBlock): string {
  return block.stateKey.split('[', 1)[0];
}

function hiddenFacesForPart(
  block: VoxelBlock,
  part: ResolvedBlockPart,
  occludingFacesByBlock: Map<string, Set<ModelFaceName>>,
  boundaryFacesByBlock: Map<string, Set<ModelFaceName>>,
  translucentBoundaryFacesByBlock: Map<string, Set<ModelFaceName>>,
  partsByBlock: Map<string, ResolvedBlockPart[]>,
): Set<ModelFaceName> {
  const hiddenFaces = new Set<ModelFaceName>();

  for (const face of faceOrder) {
    const cullface = part.faceCullfaces[face];
    if (!cullface) continue;

    const worldCullface = rotatedFace(cullface, part);
    const [x, y, z] = faceOffsets[worldCullface];
    const neighborKey = `${block.x + x},${block.y + y},${block.z + z}`;
    const neighborParts = partsByBlock.get(neighborKey) ?? [];
    if (waterNeighborHidesFace(part, face, worldCullface, neighborParts)) {
      hiddenFaces.add(face);
      continue;
    }

    const neighborFaces = occludingFacesByBlock.get(neighborKey);
    if (neighborFaces?.has(oppositeFaces[worldCullface])) {
      hiddenFaces.add(face);
      continue;
    }

    const neighborBoundaryFaces = boundaryFacesByBlock.get(neighborKey);
    const neighborTranslucentBoundaryFaces = translucentBoundaryFacesByBlock.get(neighborKey);
    if (
      neighborBoundaryFaces?.has(oppositeFaces[worldCullface])
      && coplanarBoundaryFaceShouldBeHidden(part, face, neighborTranslucentBoundaryFaces, oppositeFaces[worldCullface])
    ) {
      hiddenFaces.add(face);
    }
  }

  return hiddenFaces;
}

function waterNeighborHidesFace(
  part: ResolvedBlockPart,
  face: ModelFaceName,
  worldFace: ModelFaceName,
  neighborParts: ResolvedBlockPart[],
): boolean {
  if (!isWaterPart(part)) return false;

  const neighboringWater = neighborParts.find(isWaterPart);
  if (!neighboringWater) return false;

  if (horizontalFaces.has(worldFace)) {
    return neighboringWater.to[1] >= part.to[1] - 0.01;
  }

  return (face === 'down' && worldFace === 'down') || (face === 'up' && worldFace === 'up');
}

function occludingFacesForParts(parts: ResolvedBlockPart[]): Set<ModelFaceName> {
  const faces = new Set<ModelFaceName>();

  for (const part of parts) {
    for (const face of faceOrder) {
      if (part.faceTextures[face] && !part.faceTranslucencies[face] && partFaceCoversBlockBoundary(part, face)) {
        faces.add(rotatedFace(face, part));
      }
    }
  }

  return faces;
}

function boundaryFacesForParts(parts: ResolvedBlockPart[], translucentOnly = false): Set<ModelFaceName> {
  const faces = new Set<ModelFaceName>();

  for (const part of parts) {
    for (const face of faceOrder) {
      if (
        part.faceTextures[face]
        && (!translucentOnly || part.faceTranslucencies[face])
        && partFaceCoversBlockBoundary(part, face)
      ) {
        faces.add(rotatedFace(face, part));
      }
    }
  }

  return faces;
}

function coplanarBoundaryFaceShouldBeHidden(
  part: ResolvedBlockPart,
  face: ModelFaceName,
  neighborTranslucentBoundaryFaces: Set<ModelFaceName> | undefined,
  neighborFace: ModelFaceName,
): boolean {
  return (
    Boolean(part.faceCullfaces[face])
    && part.faceTranslucencies[face]
    && Boolean(neighborTranslucentBoundaryFaces?.has(neighborFace))
  );
}

function partFaceCoversBlockBoundary(part: ResolvedBlockPart, face: ModelFaceName): boolean {
  const [fromX, fromY, fromZ] = part.from;
  const [toX, toY, toZ] = part.to;

  switch (face) {
    case 'down':
      return fromY <= 0 && coversFullRange(fromX, toX) && coversFullRange(fromZ, toZ);
    case 'up':
      return toY >= 16 && coversFullRange(fromX, toX) && coversFullRange(fromZ, toZ);
    case 'north':
      return fromZ <= 0 && coversFullRange(fromX, toX) && coversFullRange(fromY, toY);
    case 'south':
      return toZ >= 16 && coversFullRange(fromX, toX) && coversFullRange(fromY, toY);
    case 'west':
      return fromX <= 0 && coversFullRange(fromZ, toZ) && coversFullRange(fromY, toY);
    case 'east':
      return toX >= 16 && coversFullRange(fromZ, toZ) && coversFullRange(fromY, toY);
  }
}

function coversFullRange(from: number, to: number): boolean {
  return from <= 0 && to >= 16;
}

function hiddenFaceCacheKey(hiddenFaces: Set<ModelFaceName>): string {
  return faceOrder.filter((face) => hiddenFaces.has(face)).join(',') || 'none';
}

function rotatedFace(face: ModelFaceName, part: ResolvedBlockPart): ModelFaceName {
  const [x, y, z] = faceOffsets[face];
  const vector = new THREE.Vector3(x, y, z);
  vector.applyEuler(variantEuler(part));

  const axis = new THREE.Vector3(Math.round(vector.x), Math.round(vector.y), Math.round(vector.z));
  for (const [candidate, offset] of Object.entries(faceOffsets) as Array<[ModelFaceName, [number, number, number]]>) {
    if (axis.x === offset[0] && axis.y === offset[1] && axis.z === offset[2]) {
      return candidate;
    }
  }

  return face;
}

function createSelectionBox(): THREE.LineSegments {
  const geometry = createSelectionEdgesGeometry(new Set(faceOrder));
  const material = new THREE.LineBasicMaterial({
    color: 0xf7c948,
    depthTest: true,
    transparent: true,
    opacity: 0.95,
  });
  const box = new THREE.LineSegments(geometry, material);
  box.renderOrder = 20;
  box.visible = false;
  return box;
}

async function createSelectionBoxGeometry(
  selectedBlock: VoxelBlock,
  visibleBlocks: VoxelBlock[],
  playerHeadSelections: Record<string, string>,
): Promise<THREE.BufferGeometry> {
  const visibleFaces = await visibleBoundaryFacesForBlock(selectedBlock, visibleBlocks, playerHeadSelections);
  return createSelectionEdgesGeometry(visibleFaces);
}

async function visibleBoundaryFacesForBlock(
  selectedBlock: VoxelBlock,
  visibleBlocks: VoxelBlock[],
  playerHeadSelections: Record<string, string>,
): Promise<Set<ModelFaceName>> {
  const states = Array.from(new Set(visibleBlocks.map((block) => renderStateKeyForBlock(block, playerHeadSelections))));
  const resolvedStates = await Promise.all(states.map(async (state) => [state, await resolveBlockParts(state)] as const));
  const partsByState = new Map(resolvedStates);
  const occludingFacesByBlock = new Map<string, Set<ModelFaceName>>();
  const partsByBlock = new Map<string, ResolvedBlockPart[]>();

  for (const block of visibleBlocks) {
    const parts = partsByState.get(renderStateKeyForBlock(block, playerHeadSelections)) ?? [];
    const key = blockPositionKey(block);
    partsByBlock.set(key, parts);
    occludingFacesByBlock.set(key, occludingFacesForParts(parts));
  }

  const visibleFaces = new Set<ModelFaceName>(faceOrder);

  for (const face of faceOrder) {
    const [x, y, z] = faceOffsets[face];
    const neighborKey = `${selectedBlock.x + x},${selectedBlock.y + y},${selectedBlock.z + z}`;
    const neighborFaces = occludingFacesByBlock.get(neighborKey);
    if (neighborFaces?.has(oppositeFaces[face])) {
      visibleFaces.delete(face);
      continue;
    }

    const selectedParts = partsByState.get(renderStateKeyForBlock(selectedBlock, playerHeadSelections)) ?? [];
    const neighborParts = partsByBlock.get(neighborKey) ?? [];
    if (selectedParts.some((part) => waterNeighborHidesFace(part, face, face, neighborParts))) {
      visibleFaces.delete(face);
    }
  }

  return visibleFaces;
}

function createSelectionEdgesGeometry(visibleFaces: Set<ModelFaceName>): THREE.BufferGeometry {
  const halfSize = 0.54;
  const vertices: number[] = [];
  const edges: Array<{
    from: [number, number, number];
    to: [number, number, number];
    faces: [ModelFaceName, ModelFaceName];
  }> = [
    { from: [-halfSize, -halfSize, -halfSize], to: [halfSize, -halfSize, -halfSize], faces: ['down', 'north'] },
    { from: [halfSize, -halfSize, -halfSize], to: [halfSize, -halfSize, halfSize], faces: ['down', 'east'] },
    { from: [halfSize, -halfSize, halfSize], to: [-halfSize, -halfSize, halfSize], faces: ['down', 'south'] },
    { from: [-halfSize, -halfSize, halfSize], to: [-halfSize, -halfSize, -halfSize], faces: ['down', 'west'] },
    { from: [-halfSize, halfSize, -halfSize], to: [halfSize, halfSize, -halfSize], faces: ['up', 'north'] },
    { from: [halfSize, halfSize, -halfSize], to: [halfSize, halfSize, halfSize], faces: ['up', 'east'] },
    { from: [halfSize, halfSize, halfSize], to: [-halfSize, halfSize, halfSize], faces: ['up', 'south'] },
    { from: [-halfSize, halfSize, halfSize], to: [-halfSize, halfSize, -halfSize], faces: ['up', 'west'] },
    { from: [-halfSize, -halfSize, -halfSize], to: [-halfSize, halfSize, -halfSize], faces: ['west', 'north'] },
    { from: [halfSize, -halfSize, -halfSize], to: [halfSize, halfSize, -halfSize], faces: ['east', 'north'] },
    { from: [halfSize, -halfSize, halfSize], to: [halfSize, halfSize, halfSize], faces: ['east', 'south'] },
    { from: [-halfSize, -halfSize, halfSize], to: [-halfSize, halfSize, halfSize], faces: ['west', 'south'] },
  ];

  for (const edge of edges) {
    const [faceA, faceB] = edge.faces;
    if (!visibleFaces.has(faceA) && !visibleFaces.has(faceB)) continue;
    vertices.push(...edge.from, ...edge.to);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
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
  const uvKey = faceOrder
    .map(
      (face) =>
        `${face}:${part.faceUvs[face]?.join(',') ?? 'default'}:${part.faceRotations[face]}:${part.variantRotation.x}:${
          part.variantRotation.y
        }`,
    )
    .join('|');
  const textureSizeKey = part.textureSize?.join('x') ?? '16x16';
  const key = `${part.from.join(',')}::${part.to.join(',')}::${
    part.elementRotation
      ? `${part.elementRotation.axis}:${part.elementRotation.angle}:${part.elementRotation.origin.join(',')}`
      : 'none'
  }::${part.uvLock ? 'uvlock' : 'freeuv'}::${uvKey}::texture:${textureSizeKey}::faces:${
    part.isFallback ? 'fallback' : faceOrder.filter((face) => part.faceTextures[face]).join(',')
  }`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const geometry = createModelElementGeometry(part);

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
    if (part.elementRotation.rescale) {
      const factor = 1 / Math.max(0.0001, Math.cos(radians));
      const scale = new THREE.Matrix4().makeScale(
        part.elementRotation.axis === 'x' ? 1 : factor,
        part.elementRotation.axis === 'y' ? 1 : factor,
        part.elementRotation.axis === 'z' ? 1 : factor,
      );
      rotation.multiply(scale);
    }

    matrix.makeTranslation(origin.x, origin.y, origin.z);
    matrix.multiply(rotation);
    matrix.multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
    geometry.applyMatrix4(matrix);
  }

  geometryCache.set(key, geometry);
  return geometry;
}

function createModelElementGeometry(part: ResolvedBlockPart): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  for (const [materialIndex, face] of faceOrder.entries()) {
    if (!part.isFallback && !part.faceTextures[face]) continue;

    const facePositions = modelFacePositions(part, face);
    const baseUvs = part.uvLock
      ? uvLockedCorners(part, face, facePositions)
      : uvToCorners(part.faceUvs[face] ?? defaultFaceUv(part, face), part.textureSize);
    const faceUvs = rotateUvCorners(baseUvs, part.faceRotations[face]);
    const normal = faceOffsets[face];

    faceCornerOrder.forEach((cornerIndex) => {
      const [x, y, z] = facePositions[cornerIndex];
      const [u, v] = faceUvs[cornerIndex];
      positions.push(x, y, z);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(u, v);
    });

    indices.push(vertexCount, vertexCount + 2, vertexCount + 1, vertexCount + 2, vertexCount + 3, vertexCount + 1);
    geometry.addGroup(indices.length - 6, 6, materialIndex);
    vertexCount += 4;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const faceCornerOrder = [0, 1, 2, 3];

function modelFacePositions(part: ResolvedBlockPart, face: ModelFaceName): Array<[number, number, number]> {
  const x1 = part.from[0] / 16 - 0.5;
  const y1 = part.from[1] / 16 - 0.5;
  const z1 = part.from[2] / 16 - 0.5;
  const x2 = part.to[0] / 16 - 0.5;
  const y2 = part.to[1] / 16 - 0.5;
  const z2 = part.to[2] / 16 - 0.5;

  switch (face) {
    case 'east':
      return [
        [x2, y2, z2],
        [x2, y2, z1],
        [x2, y1, z2],
        [x2, y1, z1],
      ];
    case 'west':
      return [
        [x1, y2, z1],
        [x1, y2, z2],
        [x1, y1, z1],
        [x1, y1, z2],
      ];
    case 'up':
      return [
        [x1, y2, z1],
        [x2, y2, z1],
        [x1, y2, z2],
        [x2, y2, z2],
      ];
    case 'down':
      return [
        [x1, y1, z2],
        [x2, y1, z2],
        [x1, y1, z1],
        [x2, y1, z1],
      ];
    case 'south':
      return [
        [x1, y2, z2],
        [x2, y2, z2],
        [x1, y1, z2],
        [x2, y1, z2],
      ];
    case 'north':
      return [
        [x2, y2, z1],
        [x1, y2, z1],
        [x2, y1, z1],
        [x1, y1, z1],
      ];
  }
}

function defaultFaceUv(part: ResolvedBlockPart, face: ModelFaceName): [number, number, number, number] {
  const [fromX, fromY, fromZ] = part.from;
  const [toX, toY, toZ] = part.to;

  switch (face) {
    case 'down':
    case 'up':
      return [fromX, fromZ, toX, toZ];
    case 'north':
    case 'south':
      return [fromX, 16 - toY, toX, 16 - fromY];
    case 'west':
    case 'east':
      return [fromZ, 16 - toY, toZ, 16 - fromY];
  }
}

function uvToCorners(
  uv: [number, number, number, number],
  textureSize: [number, number] = [16, 16],
): Array<[number, number]> {
  const [u1, v1, u2, v2] = uv;
  const [width, height] = textureSize;
  const left = u1 / width;
  const right = u2 / width;
  const top = 1 - v1 / height;
  const bottom = 1 - v2 / height;

  return [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ];
}

function rotateUvCorners(corners: Array<[number, number]>, degrees: number): Array<[number, number]> {
  const turns = (((degrees % 360) + 360) % 360) / 90;
  let rotated = corners;

  for (let index = 0; index < turns; index += 1) {
    rotated = [rotated[2], rotated[0], rotated[3], rotated[1]];
  }

  return rotated;
}

function uvLockedCorners(
  part: ResolvedBlockPart,
  face: ModelFaceName,
  facePositions: Array<[number, number, number]>,
): Array<[number, number]> {
  const worldFace = rotatedFace(face, part);
  const rotation = variantEuler(part);
  const [textureWidth, textureHeight] = part.textureSize ?? [16, 16];

  return facePositions.map(([x, y, z]) => {
    const position = new THREE.Vector3(x, y, z).applyEuler(rotation);
    const modelX = (position.x + 0.5) * 16;
    const modelY = (position.y + 0.5) * 16;
    const modelZ = (position.z + 0.5) * 16;
    const [u, v] = uvLockedModelCoordinates(worldFace, modelX, modelY, modelZ);

    return [u / textureWidth, 1 - v / textureHeight];
  });
}

function uvLockedModelCoordinates(
  face: ModelFaceName,
  x: number,
  y: number,
  z: number,
): [number, number] {
  switch (face) {
    case 'down':
    case 'up':
      return [x, z];
    case 'north':
    case 'south':
      return [x, 16 - y];
    case 'west':
    case 'east':
      return [z, 16 - y];
  }
}

function materialsForPart(
  part: ResolvedBlockPart,
  fallbackColor: number,
  hiddenFaces = new Set<ModelFaceName>(),
): THREE.Material[] {
  return faceOrder.map((face) => {
    if (isRailPart(part) && face === 'down') return hiddenMaterial;
    if (hiddenFaces.has(face)) return hiddenMaterial;

    const textureId = part.faceTextures[face];
    if (!textureId) {
      return part.isFallback ? colorMaterial(fallbackColor) : hiddenMaterial;
    }

    return textureMaterial(
      textureId,
      tintColorForPart(textureId, part.faceTints[face], part),
      part.shade,
      part.faceTranslucencies[face],
    );
  });
}

function textureMaterial(textureId: string, tintColor: number | null, shade: boolean, translucent: boolean): THREE.Material {
  const key = `texture::${textureId}::${tintColor ?? 'none'}::shade:${shade}::translucent:${translucent}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const texture = textureLoader.load(textureUrl(textureId));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const beaconCore = isBeaconCoreTexture(textureId);
  const glowing = beaconCore || isGlowingTexture(textureId);
  const water = isWaterTexture(textureId);
  const glass = isGlassTexture(textureId);
  const opacity = translucent ? translucentTextureOpacity(textureId) : 1;
  const depthWrite = !translucent || glass;
  const side = THREE.FrontSide;

  const material = shade
    ? new THREE.MeshStandardMaterial({
        map: texture,
        color: tintColor ?? 0xffffff,
        emissive: glowing ? emissiveColor(textureId) : 0x000000,
        emissiveIntensity: glowing ? 0.72 : 0,
        roughness: water ? 0.36 : 0.92,
        metalness: water ? 0.08 : 0.02,
        transparent: translucent,
        opacity,
        alphaTest: water ? 0.02 : 0.08,
        depthWrite,
        side,
      })
    : new THREE.MeshBasicMaterial({
        map: texture,
        color: tintColor ?? 0xffffff,
        transparent: translucent,
        opacity,
        alphaTest: 0.08,
        depthWrite,
        side,
        toneMapped: false,
      });
  materialCache.set(key, material);
  return material;
}

function partHasTranslucentFaces(part: ResolvedBlockPart): boolean {
  return faceOrder.some((face) => part.faceTranslucencies[face]);
}

function isWaterPart(part: ResolvedBlockPart): boolean {
  return part.blockId === 'minecraft:water';
}

function isRailPart(part: ResolvedBlockPart): boolean {
  const path = part.blockId.replace(/^minecraft:/, '');
  return path === 'rail' || path.endsWith('_rail');
}

function isBeaconCoreTexture(textureId: string): boolean {
  return textureId.replace(/^minecraft:/, '') === 'block/beacon';
}

function isGlowingTexture(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return (
    path === 'block/sea_lantern'
    || path === 'block/lantern'
    || path === 'block/soul_lantern'
    || path.startsWith('block/lava_')
    || path.includes('campfire_fire')
  );
}

function emissiveColor(textureId: string): number {
  const path = textureId.replace(/^minecraft:/, '');
  if (path === 'block/sea_lantern') return 0xcff8e9;
  if (path === 'block/soul_lantern') return 0x64d6ff;
  if (path.startsWith('block/lava_') || path.includes('campfire_fire')) return 0xff8a24;
  if (path === 'block/lantern') return 0xffc552;
  return 0x65fff5;
}

function isWaterTexture(textureId: string): boolean {
  return textureId.replace(/^minecraft:/, '').startsWith('block/water_');
}

function isGlassTexture(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return path === 'block/glass' || /(^|\/).+_stained_glass(_pane_top)?$/.test(path) || path === 'block/tinted_glass';
}

function translucentTextureOpacity(textureId: string): number {
  const path = textureId.replace(/^minecraft:/, '');
  if (path.startsWith('block/water_')) {
    return 0.54;
  }
  if (isGlassTexture(textureId)) {
    return 0.58;
  }
  return 0.72;
}

function tintColorForPart(textureId: string, tintIndex: number | null, part: ResolvedBlockPart): number | null {
  if (tintIndex === null) return null;
  const path = textureId.replace(/^minecraft:/, '');

  if (part.blockId === 'minecraft:redstone_wire' && tintIndex === 0) {
    return redstoneWireColor(part.blockProperties.power);
  }

  if (path.startsWith('block/water_')) return waterTint;
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

function variantXRotation(part: ResolvedBlockPart): number {
  return -part.variantRotation.x;
}

function variantYRotation(part: ResolvedBlockPart): number {
  return -part.variantRotation.y;
}

function variantEuler(part: ResolvedBlockPart): THREE.Euler {
  return new THREE.Euler(
    THREE.MathUtils.degToRad(variantXRotation(part)),
    THREE.MathUtils.degToRad(variantYRotation(part)),
    0,
    'YXZ',
  );
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
  controls.maxDistance = Math.max(240, radius * 6);
  camera.position.set(radius * 1.35, radius * 0.95 + dimensions.height * 0.4, radius * 1.45);
  camera.near = Math.max(0.1, radius / 100);
  camera.far = Math.max(500, radius * 12);
  camera.updateProjectionMatrix();
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
  const y = -0.55;

  for (let x = -0.5; x <= dimensions.width - 0.5; x += 1) {
    vertices.push(x, y, -0.5, x, y, dimensions.length - 0.5);
  }

  for (let z = -0.5; z <= dimensions.length - 0.5; z += 1) {
    vertices.push(-0.5, y, z, dimensions.width - 0.5, y, z);
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
