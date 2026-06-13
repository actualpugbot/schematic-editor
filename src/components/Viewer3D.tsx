import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
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
  cameraMode: CameraMode;
  spectatorSpeed: number;
  visibleBottomLayer: number;
  visibleTopLayer: number;
  hiddenMaterialIds: Set<string>;
  playerHeadSelections: Record<string, string>;
  autoRotate: boolean;
  showGrid: boolean;
  theme: 'light' | 'dark';
  stageBackgroundColor?: string;
  selectedBlock: VoxelBlock | null;
  placementPreviewBlock: VoxelBlock | null;
  cuboidBounds?: CuboidBounds | null;
  cuboidCorners?: CuboidCornerPoints | null;
  showCuboidCornerLabels?: boolean;
  rotationTarget?: 'block' | 'cuboid' | null;
  rotationControlRef?: MutableRefObject<HTMLDivElement | null>;
  textureAdjustments?: TextureAdjustmentMap;
  textureEditMode?: boolean;
  onBlockSelect?: (block: VoxelBlock | null, button: SelectionButton, placementPoint: PlacementPoint | null) => void;
  onTextureFaceSelect?: (hit: TextureFaceHit) => void;
  onTextureFaceDrag?: (deltaU: number, deltaV: number, hit: TextureFaceHit) => void;
  onAxisOrientationChange?: (orientation: AxisGizmoOrientation) => void;
  onReady?: () => void;
}

export interface CuboidBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface CuboidCornerPoints {
  a: CuboidCornerPoint | null;
  b: CuboidCornerPoint | null;
}

export interface CuboidCornerPoint {
  x: number;
  y: number;
  z: number;
}

export interface AxisGizmoOrientation {
  x: AxisGizmoVector;
  y: AxisGizmoVector;
  z: AxisGizmoVector;
}

export interface AxisGizmoVector {
  x: number;
  y: number;
  angle: number;
  length: number;
}

export interface Viewer3DHandle {
  spinOnce: () => void;
  resetCamera: () => void;
  getCameraPosition: () => SavedCameraPosition | null;
  applyCameraPosition: (position: SavedCameraPosition) => void;
}

export type SelectionButton = 'primary' | 'secondary';
export type CameraMode = 'orbit' | 'spectator';
export type PlacementPoint = CuboidCornerPoint;
export type TextureAdjustmentMap = Record<string, TextureFaceAdjustment>;

export interface SavedCameraPosition {
  position: [number, number, number];
  target: [number, number, number];
}

export interface TextureFaceAdjustment {
  offsetU: number;
  offsetV: number;
  rotation: number;
}

export interface TextureFaceHit {
  block: VoxelBlock;
  partKey: string;
  face: ModelFaceName;
  textureId: string | null;
}

interface SpectatorCameraState {
  position: THREE.Vector3;
  rotation: {
    yaw: number;
    pitch: number;
  };
  baseSpeed: number;
  fastMultiplier: number;
  pointerLocked: boolean;
}

interface StageBackgroundTransition {
  from: THREE.Color;
  to: THREE.Color;
  start: number;
  duration: number;
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
const cuboidOverlayPadding = 0.018;
const cornerLabelOffset = 0.86;
const defaultSchematicRotationY = -Math.PI / 2;
const meshBuildYieldInterval = 180;
const labelProjectionVector = new THREE.Vector3();
const rotationControlProjectionVector = new THREE.Vector3();
const stageBackgroundTransitionDurationMs = 220;

let webgl2Supported = false;

function checkWebgl2Support(): boolean {
  if (webgl2Supported) return true;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl) {
    // Release the probe context right away so it doesn't count against the
    // browser's live WebGL context cap until garbage collection.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    webgl2Supported = true;
  }
  return webgl2Supported;
}

export function Viewer3D(props: InternalViewerProps) {
  const [webglError, setWebglError] = useState<'unsupported' | 'lost' | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const displayGroupRef = useRef<THREE.Group | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const floorShadowRef = useRef<THREE.Mesh | null>(null);
  const selectionBoxRef = useRef<THREE.LineSegments | null>(null);
  const placementPreviewRef = useRef<THREE.LineSegments | null>(null);
  const cuboidOverlayRef = useRef<THREE.Group | null>(null);
  const stageBackgroundTransitionRef = useRef<StageBackgroundTransition | null>(null);
  const cornerLabelRefs = useRef<Record<'a' | 'b', HTMLSpanElement | null>>({ a: null, b: null });
  const frameRef = useRef<number | null>(null);
  const spinRef = useRef<{ start: number; duration: number; from: number; to: number } | null>(null);
  const latestModelRef = useRef<SchematicModel | null>(props.model);
  const latestBlockKeysRef = useRef<Set<string>>(new Set(props.model?.blocks.map(blockPositionKey) ?? []));
  const latestSelectedBlockRef = useRef<VoxelBlock | null>(props.selectedBlock);
  const latestPlacementPreviewBlockRef = useRef<VoxelBlock | null>(props.placementPreviewBlock);
  const latestCuboidBoundsRef = useRef<CuboidBounds | null | undefined>(props.cuboidBounds);
  const latestCuboidCornersRef = useRef<CuboidCornerPoints | null | undefined>(props.cuboidCorners);
  const latestShowCuboidCornerLabelsRef = useRef(Boolean(props.showCuboidCornerLabels));
  const latestRotationTargetRef = useRef<'block' | 'cuboid' | null | undefined>(props.rotationTarget);
  const textureEditModeRef = useRef(Boolean(props.textureEditMode));
  const cameraModeRef = useRef<CameraMode>(props.cameraMode);
  const onBlockSelectRef = useRef(props.onBlockSelect);
  const onTextureFaceSelectRef = useRef(props.onTextureFaceSelect);
  const onTextureFaceDragRef = useRef(props.onTextureFaceDrag);
  const onAxisOrientationChangeRef = useRef(props.onAxisOrientationChange);
  const spectatorStateRef = useRef<SpectatorCameraState>({
    position: new THREE.Vector3(24, 20, 28),
    rotation: { yaw: 0, pitch: 0 },
    baseSpeed: props.spectatorSpeed,
    fastMultiplier: 3,
    pointerLocked: false,
  });
  const spectatorKeysRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    fast: false,
  });
  const cameraFitKey = props.model ? modelCameraFitKey(props.model) : null;

  const filteredBlocks = useMemo(() => {
    if (!props.model) return [];
    return props.model.blocks.filter((block) =>
      !props.hiddenMaterialIds.has(blockMaterialId(block))
      && block.y >= props.visibleBottomLayer
      && block.y <= props.visibleTopLayer,
    );
  }, [props.hiddenMaterialIds, props.model, props.visibleBottomLayer, props.visibleTopLayer]);

  useEffect(() => {
    latestModelRef.current = props.model;
    latestBlockKeysRef.current = new Set(props.model?.blocks.map(blockPositionKey) ?? []);
  }, [props.model]);

  useEffect(() => {
    latestPlacementPreviewBlockRef.current = props.placementPreviewBlock;
  }, [props.placementPreviewBlock]);

  useEffect(() => {
    latestSelectedBlockRef.current = props.selectedBlock;
  }, [props.selectedBlock]);

  useEffect(() => {
    latestCuboidBoundsRef.current = props.cuboidBounds;
  }, [props.cuboidBounds]);

  useEffect(() => {
    latestCuboidCornersRef.current = props.cuboidCorners;
  }, [props.cuboidCorners]);

  useEffect(() => {
    latestShowCuboidCornerLabelsRef.current = Boolean(props.showCuboidCornerLabels);
  }, [props.showCuboidCornerLabels]);

  useEffect(() => {
    latestRotationTargetRef.current = props.rotationTarget;
  }, [props.rotationTarget]);

  useEffect(() => {
    textureEditModeRef.current = Boolean(props.textureEditMode);
  }, [props.textureEditMode]);

  useEffect(() => {
    cameraModeRef.current = props.cameraMode;
  }, [props.cameraMode]);

  useEffect(() => {
    spectatorStateRef.current.baseSpeed = props.spectatorSpeed;
  }, [props.spectatorSpeed]);

  useEffect(() => {
    onBlockSelectRef.current = props.onBlockSelect;
  }, [props.onBlockSelect]);

  useEffect(() => {
    onTextureFaceSelectRef.current = props.onTextureFaceSelect;
  }, [props.onTextureFaceSelect]);

  useEffect(() => {
    onTextureFaceDragRef.current = props.onTextureFaceDrag;
  }, [props.onTextureFaceDrag]);

  useEffect(() => {
    onAxisOrientationChangeRef.current = props.onAxisOrientationChange;
  }, [props.onAxisOrientationChange]);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.fog = null;
    }
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!checkWebgl2Support()) {
      setWebglError('unsupported');
      return;
    }

    const scene = new THREE.Scene();
    const colors = sceneThemeColors(props.theme);
    scene.background = new THREE.Color(props.stageBackgroundColor ?? colors.background);
    scene.fog = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.set(24, 20, 28);
    camera.near = 0.03;
    cameraRef.current = camera;
    syncSpectatorStateFromCamera(camera, spectatorStateRef.current);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    } catch {
      disposeObject(scene);
      sceneRef.current = null;
      cameraRef.current = null;
      setWebglError('unsupported');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.tabIndex = 0;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setWebglError('lost');
    };
    const handleContextRestored = () => {
      setWebglError(null);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

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
      new THREE.MeshBasicMaterial({ color: colors.floor }),
    );
    floorRef.current = floor;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.56;
    scene.add(floor);

    const floorShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: floorShadowOpacity(props.theme) }),
    );
    floorShadowRef.current = floorShadow;
    floorShadow.rotation.x = -Math.PI / 2;
    floorShadow.position.y = -0.559;
    floorShadow.receiveShadow = true;
    scene.add(floorShadow);

    const displayGroup = new THREE.Group();
    displayGroup.rotation.y = defaultSchematicRotationY;
    displayGroupRef.current = displayGroup;
    scene.add(displayGroup);

    const modelGroup = new THREE.Group();
    modelGroupRef.current = modelGroup;
    displayGroup.add(modelGroup);

    const gridGroup = new THREE.Group();
    gridRef.current = gridGroup;
    displayGroup.add(gridGroup);

    const selectionBox = createSelectionBox();
    selectionBoxRef.current = selectionBox;
    displayGroup.add(selectionBox);

    const placementPreview = createPlacementPreviewBox();
    placementPreviewRef.current = placementPreview;
    displayGroup.add(placementPreview);

    const cuboidOverlay = createCuboidOverlay(props.theme);
    cuboidOverlayRef.current = cuboidOverlay;
    displayGroup.add(cuboidOverlay);

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
    let textureDragStart: { x: number; y: number; hit: TextureFaceHit } | null = null;
    const handlePointerDown = (event: PointerEvent) => {
      pointerStart.x = event.clientX;
      pointerStart.y = event.clientY;
      renderer.domElement.focus();
      if (textureEditModeRef.current && event.button === 0 && cameraModeRef.current !== 'spectator') {
        const hit = pickTextureFace(event, renderer, camera, modelGroup, displayGroup);
        if (hit) {
          event.preventDefault();
          textureDragStart = { x: event.clientX, y: event.clientY, hit };
          controls.enabled = false;
          onTextureFaceSelectRef.current?.(hit);
          renderer.domElement.setPointerCapture(event.pointerId);
        }
        return;
      }
      if (cameraModeRef.current === 'spectator' && event.button === 0) {
        renderer.domElement.requestPointerLock();
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) return;
      if (textureDragStart) {
        textureDragStart = null;
        if (cameraModeRef.current !== 'spectator') controls.enabled = true;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }
        return;
      }
      if (cameraModeRef.current === 'spectator') return;
      const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      if (distance > 5) return;

      const block = pickBlock(event, renderer, camera, modelGroup);
      const placementPoint = pickPlacementPoint(
        event,
        renderer,
        camera,
        modelGroup,
        displayGroup,
        latestModelRef.current,
        latestBlockKeysRef.current,
      );
      onBlockSelectRef.current?.(block, event.button === 2 ? 'secondary' : 'primary', placementPoint);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (cameraModeRef.current === 'spectator') return;
      if (textureDragStart) {
        const deltaX = event.clientX - textureDragStart.x;
        const deltaY = event.clientY - textureDragStart.y;
        const { hit } = textureDragStart;
        textureDragStart = { x: event.clientX, y: event.clientY, hit };
        onTextureFaceDragRef.current?.(deltaX / 8, deltaY / 8, hit);
        return;
      }
      updatePlacementPreview(
        placementPreview,
        pickPlacementPoint(
          event,
          renderer,
          camera,
          modelGroup,
          displayGroup,
          latestModelRef.current,
          latestBlockKeysRef.current,
        ),
        latestModelRef.current,
        latestPlacementPreviewBlockRef.current,
      );
    };
    const handlePointerLeave = () => {
      placementPreview.visible = false;
    };
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const handlePointerLockChange = () => {
      const pointerLocked = document.pointerLockElement === renderer.domElement;
      spectatorStateRef.current.pointerLocked = pointerLocked;
      if (pointerLocked && cameraModeRef.current === 'spectator') {
        void lockSpectatorKeyboard();
      } else {
        resetSpectatorKeys(spectatorKeysRef.current);
        unlockSpectatorKeyboard();
      }
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement || cameraModeRef.current !== 'spectator') return;
      updateSpectatorLook(event.movementX, event.movementY, camera, spectatorStateRef.current);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldCaptureSpectatorKey(event, renderer.domElement, cameraModeRef.current)) return;
      swallowSpectatorKeyEvent(event);
      if (event.code === 'Escape' && document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
        return;
      }
      setSpectatorKey(event, spectatorKeysRef.current, true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!shouldCaptureSpectatorKey(event, renderer.domElement, cameraModeRef.current)) return;
      swallowSpectatorKeyEvent(event);
      setSpectatorKey(event, spectatorKeysRef.current, false);
    };
    const handleWindowBlur = () => {
      resetSpectatorKeys(spectatorKeysRef.current);
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (cameraModeRef.current !== 'spectator' || !spectatorStateRef.current.pointerLocked) return;
      event.preventDefault();
      event.returnValue = '';
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('beforeunload', handleBeforeUnload);

    let previousTime = performance.now();
    const animate = (time: number) => {
      const deltaTime = Math.min(0.08, Math.max(0, (time - previousTime) / 1000));
      previousTime = time;
      if (cameraModeRef.current === 'spectator') {
        updateSpectatorCamera(deltaTime, camera, spectatorStateRef.current, spectatorKeysRef.current);
      }

      if (controlsRef.current && cameraModeRef.current !== 'spectator') {
        const latestModel = latestModelRef.current;
        if (spinRef.current && latestModel) {
          updateSpin(time, cameraFitDimensions(latestModel), controlsRef.current, camera, spinRef);
        }
        controlsRef.current.update();
      }

      updateStageBackgroundTransition(scene, time, stageBackgroundTransitionRef);
      onAxisOrientationChangeRef.current?.(projectAxisOrientation(camera));
      updateCuboidCornerLabels(
        cornerLabelRefs.current,
        latestCuboidCornersRef.current,
        latestShowCuboidCornerLabelsRef.current && Boolean(latestCuboidBoundsRef.current),
        latestModelRef.current,
        displayGroup,
        camera,
        renderer,
      );
      updateRotationControlPosition(
        props.rotationControlRef?.current ?? null,
        latestRotationTargetRef.current ?? null,
        latestSelectedBlockRef.current,
        latestCuboidBoundsRef.current ?? null,
        latestModelRef.current,
        displayGroup,
        camera,
        renderer,
      );
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };

    frameRef.current = window.requestAnimationFrame(animate);
    props.viewerRef.current = {
      spinOnce: () => {
        if (cameraModeRef.current === 'spectator') return;
        spinRef.current = {
          start: performance.now(),
          duration: 4800,
          from: controls.getAzimuthalAngle(),
          to: controls.getAzimuthalAngle() + Math.PI * 2,
        };
      },
      resetCamera: () => {
        const model = latestModelRef.current;
        if (!model) return;
        fitCameraToModel(cameraFitDimensions(model), camera, controls);
        syncSpectatorStateFromCamera(camera, spectatorStateRef.current);
      },
      getCameraPosition: () => ({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      }),
      applyCameraPosition: (position) => {
        camera.position.set(...position.position);
        controls.target.set(...position.target);
        camera.near = 0.03;
        camera.far = Math.max(camera.far, camera.position.distanceTo(controls.target) * 8, 500);
        camera.updateProjectionMatrix();
        controls.update();
        syncSpectatorStateFromCamera(camera, spectatorStateRef.current);
      },
    };

    props.onReady?.();

    return () => {
      props.viewerRef.current = null;
      observer.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      unlockSpectatorKeyboard();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      disposeObject(scene);
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      displayGroupRef.current = null;
      floorRef.current = null;
      floorShadowRef.current = null;
      selectionBoxRef.current = null;
      placementPreviewRef.current = null;
      cuboidOverlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    const colors = sceneThemeColors(props.theme);
    if (sceneRef.current) {
      transitionStageBackground(
        sceneRef.current,
        props.stageBackgroundColor ?? colors.background,
        stageBackgroundTransitionRef,
      );
    }

    const floorMaterial = floorRef.current?.material;
    if (floorMaterial instanceof THREE.MeshBasicMaterial) {
      floorMaterial.color.setHex(colors.floor);
      floorMaterial.needsUpdate = true;
    }

    const floorShadowMaterial = floorShadowRef.current?.material;
    if (floorShadowMaterial instanceof THREE.ShadowMaterial) {
      floorShadowMaterial.opacity = floorShadowOpacity(props.theme);
      floorShadowMaterial.needsUpdate = true;
    }

    if (cuboidOverlayRef.current) {
      applyCuboidOverlayColors(cuboidOverlayRef.current, props.theme);
    }
  }, [props.stageBackgroundColor, props.theme]);

  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.autoRotate = props.autoRotate;
  }, [props.autoRotate]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    if (!camera || !controls) return;

    controls.enabled = props.cameraMode !== 'spectator';
    controls.enableRotate = props.cameraMode === 'orbit';
    controls.enablePan = props.cameraMode === 'orbit';
    controls.enableZoom = props.cameraMode !== 'spectator';
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    if (props.cameraMode === 'spectator') {
      spinRef.current = null;
      syncSpectatorStateFromCamera(camera, spectatorStateRef.current);
    } else if (renderer && document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
      unlockSpectatorKeyboard();
    }
  }, [props.cameraMode]);

  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;

    if (!props.model) {
      clearGroup(group, false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    void createBlockMeshes(
      filteredBlocks,
      props.playerHeadSelections,
      props.textureAdjustments ?? {},
      abortController.signal,
    ).then((meshes) => {
      if (cancelled || abortController.signal.aborted) return;
      clearGroup(group, false);
      for (const mesh of meshes) {
        group.add(mesh);
      }
      centerGroup(group, props.model!.dimensions);
    }).catch((error: unknown) => {
      if (isAbortError(error)) return;
      console.error('Could not build schematic mesh.', error);
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [filteredBlocks, props.model, props.playerHeadSelections, props.textureAdjustments]);

  useEffect(() => {
    const gridGroup = gridRef.current;
    if (!gridGroup) return;

    clearGroup(gridGroup);

    if (!props.model || !props.showGrid) return;

    const helper = createFootprintGrid(props.model.dimensions, props.theme);
    gridGroup.add(helper);
    centerGroup(gridGroup, props.model.dimensions);
  }, [props.model, props.showGrid, props.theme]);

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
      && block.y >= props.visibleBottomLayer
      && block.y <= props.visibleTopLayer;
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
    props.visibleBottomLayer,
    props.visibleTopLayer,
  ]);

  useEffect(() => {
    if (!placementPreviewRef.current) return;
    placementPreviewRef.current.visible = false;
  }, [props.model, props.placementPreviewBlock]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const model = latestModelRef.current;

    if (!model || !camera || !controls) return;

    fitCameraToModel(cameraFitDimensions(model), camera, controls);
    syncSpectatorStateFromCamera(camera, spectatorStateRef.current);
  }, [cameraFitKey]);

  useEffect(() => {
    const overlay = cuboidOverlayRef.current;
    if (!overlay) return;

    if (!props.model || !props.cuboidBounds) {
      overlay.visible = false;
      return;
    }

    updateCuboidOverlay(overlay, props.cuboidBounds, props.model.dimensions);
  }, [props.cuboidBounds, props.model]);

  return (
    <div className="viewer-canvas" data-camera-mode={props.cameraMode} data-testid="viewer-canvas" ref={containerRef}>
      {webglError && (
        <div className="viewer-webgl-fallback" role="alert">
          {webglError === 'unsupported'
            ? 'The 3D viewer needs WebGL2. Enable hardware acceleration or use a current version of Chrome, Edge, Firefox, or Safari.'
            : 'The browser lost its graphics context, usually from running out of GPU memory. Reload the page to restore the 3D view.'}
        </div>
      )}
      <span
        className="cuboid-corner-tag cuboid-corner-tag-a"
        aria-hidden="true"
        ref={(node) => {
          cornerLabelRefs.current.a = node;
        }}
      >
        A
      </span>
      <span
        className="cuboid-corner-tag cuboid-corner-tag-b"
        aria-hidden="true"
        ref={(node) => {
          cornerLabelRefs.current.b = node;
        }}
      >
        B
      </span>
    </div>
  );
}

const axisCameraDirection = new THREE.Vector3();
const axisBasis = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

function projectAxisOrientation(camera: THREE.PerspectiveCamera): AxisGizmoOrientation {
  return {
    x: projectAxisVector(camera, axisBasis.x),
    y: projectAxisVector(camera, axisBasis.y),
    z: projectAxisVector(camera, axisBasis.z),
  };
}

function projectAxisVector(camera: THREE.PerspectiveCamera, axis: THREE.Vector3): AxisGizmoVector {
  axisCameraDirection.copy(axis).transformDirection(camera.matrixWorldInverse);
  const x = clampAxisVector(axisCameraDirection.x);
  const y = clampAxisVector(-axisCameraDirection.y);

  return {
    x,
    y,
    angle: clampAxisVector(Math.atan2(y, x) * (180 / Math.PI)),
    length: clampAxisVector(Math.hypot(x, y)),
  };
}

function clampAxisVector(value: number): number {
  if (Math.abs(value) < 0.001) return 0;
  return Number(value.toFixed(4));
}

const spectatorForward = new THREE.Vector3();
const spectatorRight = new THREE.Vector3();
const spectatorVelocity = new THREE.Vector3();
const spectatorWorldUp = new THREE.Vector3(0, 1, 0);

function syncSpectatorStateFromCamera(camera: THREE.PerspectiveCamera, state: SpectatorCameraState) {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  state.position.copy(camera.position);
  state.rotation.yaw = Math.atan2(-direction.x, -direction.z);
  state.rotation.pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
}

function updateSpectatorLook(
  movementX: number,
  movementY: number,
  camera: THREE.PerspectiveCamera,
  state: SpectatorCameraState,
) {
  const sensitivity = 0.0022;
  state.rotation.yaw -= movementX * sensitivity;
  state.rotation.pitch -= movementY * sensitivity;
  state.rotation.pitch = THREE.MathUtils.clamp(
    state.rotation.pitch,
    THREE.MathUtils.degToRad(-89),
    THREE.MathUtils.degToRad(89),
  );
  applySpectatorRotation(camera, state);
}

function updateSpectatorCamera(
  deltaTime: number,
  camera: THREE.PerspectiveCamera,
  state: SpectatorCameraState,
  keys: MutableRefObject<{
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    fast: boolean;
  }>['current'],
) {
  state.position.copy(camera.position);
  spectatorForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  spectatorRight.crossVectors(spectatorForward, spectatorWorldUp).normalize();
  spectatorVelocity.set(0, 0, 0);

  if (keys.forward) spectatorVelocity.add(spectatorForward);
  if (keys.backward) spectatorVelocity.sub(spectatorForward);
  if (keys.left) spectatorVelocity.sub(spectatorRight);
  if (keys.right) spectatorVelocity.add(spectatorRight);
  if (keys.up) spectatorVelocity.y += 1;
  if (keys.down) spectatorVelocity.y -= 1;

  if (spectatorVelocity.lengthSq() > 0) {
    const speed = keys.fast ? state.baseSpeed * state.fastMultiplier : state.baseSpeed;
    spectatorVelocity.normalize().multiplyScalar(speed * deltaTime);
    state.position.add(spectatorVelocity);
    camera.position.copy(state.position);
  }
  applySpectatorRotation(camera, state);
}

function applySpectatorRotation(camera: THREE.PerspectiveCamera, state: SpectatorCameraState) {
  camera.rotation.set(state.rotation.pitch, state.rotation.yaw, 0, 'YXZ');
}

function shouldCaptureSpectatorKey(event: KeyboardEvent, canvas: HTMLCanvasElement, cameraMode: CameraMode): boolean {
  if (cameraMode !== 'spectator') return false;
  if (isEditableElement(event.target)) return false;
  return document.pointerLockElement === canvas || document.activeElement === canvas;
}

function swallowSpectatorKeyEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

interface KeyboardLockApi {
  lock?: (keyCodes?: string[]) => Promise<void>;
  unlock?: () => void;
}

const spectatorKeyboardLockKeys = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'Escape',
];

function spectatorKeyboard(): KeyboardLockApi | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
}

async function lockSpectatorKeyboard() {
  if (!document.fullscreenElement) return;
  try {
    await spectatorKeyboard()?.lock?.(spectatorKeyboardLockKeys);
  } catch {
    // Keyboard Lock is best-effort. The capture-phase handler still blocks cancellable shortcuts.
  }
}

function unlockSpectatorKeyboard() {
  spectatorKeyboard()?.unlock?.();
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function setSpectatorKey(
  event: KeyboardEvent,
  keys: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    fast: boolean;
  },
  value: boolean,
): boolean {
  switch (event.code) {
    case 'KeyW':
      keys.forward = value;
      return true;
    case 'KeyS':
      keys.backward = value;
      return true;
    case 'KeyA':
      keys.left = value;
      return true;
    case 'KeyD':
      keys.right = value;
      return true;
    case 'Space':
      keys.up = value;
      return true;
    case 'ControlLeft':
    case 'ControlRight':
      keys.fast = value;
      return true;
    case 'ShiftLeft':
    case 'ShiftRight':
      keys.down = value;
      return true;
    default:
      return false;
  }
}

function resetSpectatorKeys(keys: {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fast: boolean;
}) {
  keys.forward = false;
  keys.backward = false;
  keys.left = false;
  keys.right = false;
  keys.up = false;
  keys.down = false;
  keys.fast = false;
}

async function createBlockMeshes(
  blocks: VoxelBlock[],
  playerHeadSelections: Record<string, string>,
  textureAdjustments: TextureAdjustmentMap = {},
  signal?: AbortSignal,
): Promise<THREE.InstancedMesh[]> {
  throwIfAborted(signal);

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
  throwIfAborted(signal);
  const partsByState = new Map(resolvedStates);
  const occludingFacesByBlock = new Map<string, Set<ModelFaceName>>();
  const boundaryFacesByBlock = new Map<string, Set<ModelFaceName>>();
  const translucentBoundaryFacesByBlock = new Map<string, Set<ModelFaceName>>();
  const partsByBlock = new Map<string, ResolvedBlockPart[]>();

  for (let index = 0; index < blocks.length; index += 1) {
    if (index > 0 && index % meshBuildYieldInterval === 0) await yieldToMainThread(signal);
    const block = blocks[index];
    const parts = partsByState.get(renderStateKeyForBlock(block, playerHeadSelections)) ?? [];
    partsByBlock.set(blockPositionKey(block), parts);
    occludingFacesByBlock.set(blockPositionKey(block), occludingFacesForParts(parts));
    boundaryFacesByBlock.set(blockPositionKey(block), boundaryFacesForParts(parts));
    translucentBoundaryFacesByBlock.set(blockPositionKey(block), boundaryFacesForParts(parts, true));
  }

  for (let index = 0; index < blocks.length; index += 1) {
    if (index > 0 && index % meshBuildYieldInterval === 0) await yieldToMainThread(signal);
    const block = blocks[index];
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
      const adjustmentKey = textureAdjustmentCacheKey(part, textureAdjustments);
      const key = `${part.isFallback ? `${part.key}::${block.color}` : part.key}::hidden:${hiddenFaceKey}::adjust:${adjustmentKey}`;
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

  try {
    for (const group of groups.values()) {
      throwIfAborted(signal);

      const geometry = geometryForPart(group.part, textureAdjustments);
      const materials = materialsForPart(group.part, group.fallbackColor, group.hiddenFaces);
      const mesh = new THREE.InstancedMesh(geometry, materials, group.blocks.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = partHasTranslucentFaces(group.part) ? 10 : 0;

      const quaternion = new THREE.Quaternion().setFromEuler(variantEuler(group.part));
      const scale = new THREE.Vector3(1, 1, 1);

      for (let index = 0; index < group.blocks.length; index += 1) {
        if (index > 0 && index % meshBuildYieldInterval === 0) await yieldToMainThread(signal);
        const block = group.blocks[index];
        matrix.compose(new THREE.Vector3(block.x, block.y, block.z), quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.blocks = group.blocks;
      mesh.userData.part = group.part;
      meshes.push(mesh);
    }
  } catch (error) {
    meshes.length = 0;
    throw error;
  }

  return meshes;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException('Mesh build aborted.', 'AbortError');
}

async function yieldToMainThread(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  throwIfAborted(signal);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function blockPositionKey(block: VoxelBlock): string {
  return `${block.x},${block.y},${block.z}`;
}

function renderStateKeyForBlock(block: VoxelBlock, playerHeadSelections: Record<string, string>): string {
  let stateKey = block.stateKey;

  if (block.decoratedPotDecorations) {
    for (const [side, itemId] of Object.entries(block.decoratedPotDecorations)) {
      if (itemId) stateKey = setBlockStateProperty(stateKey, `SchematicEditor_pot_${side}`, itemId);
    }
  }

  if (!block.playerHeadTexture && block.name !== 'minecraft:player_head' && block.name !== 'minecraft:player_wall_head') {
    return stateKey;
  }

  const textureId = playerHeadSelections[blockPositionKey(block)] ?? block.playerHeadTexture?.id;
  return textureId ? setBlockStateProperty(stateKey, 'SchematicEditor_head', textureId) : stateKey;
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
  const id = block.stateKey.split('[', 1)[0];
  const path = id.replace(/^minecraft:/, '');
  if (path === 'wall_sign') return id.replace(/wall_sign$/, 'sign');
  if (path === 'wall_hanging_sign') return id.replace(/wall_hanging_sign$/, 'hanging_sign');
  if (path.endsWith('_wall_sign')) return id.replace(/_wall_sign$/, '_sign');
  if (path.endsWith('_wall_hanging_sign')) return id.replace(/_wall_hanging_sign$/, '_hanging_sign');
  return id;
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
      if (partFaceOccludesNeighbor(part, face) && partFaceCoversBlockBoundary(part, face)) {
        faces.add(rotatedFace(face, part));
      }
    }
  }

  return faces;
}

function partFaceOccludesNeighbor(part: ResolvedBlockPart, face: ModelFaceName): boolean {
  const textureId = part.faceTextures[face];
  return textureId !== null && !textureRendersTransparent(textureId, part.faceTranslucencies[face]) && !isAlphaCutoutTexture(textureId);
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

function createPlacementPreviewBox(): THREE.LineSegments {
  const geometry = createSelectionEdgesGeometry(new Set(faceOrder));
  const material = new THREE.LineBasicMaterial({
    color: 0x25d6a2,
    depthTest: true,
    transparent: true,
    opacity: 0.86,
  });
  const box = new THREE.LineSegments(geometry, material);
  box.renderOrder = 22;
  box.visible = false;
  return box;
}

function createCuboidOverlay(theme: 'light' | 'dark'): THREE.Group {
  const group = new THREE.Group();
  const colors = sceneThemeColors(theme);

  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: colors.cuboidFill,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    }),
  );
  fill.renderOrder = 18;
  group.add(fill);

  const edgeSourceGeometry = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(edgeSourceGeometry),
    new THREE.LineBasicMaterial({
      color: colors.cuboidEdge,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
    }),
  );
  edgeSourceGeometry.dispose();
  edges.renderOrder = 21;
  group.add(edges);

  group.visible = false;
  return group;
}

function applyCuboidOverlayColors(overlay: THREE.Group, theme: 'light' | 'dark') {
  const colors = sceneThemeColors(theme);
  const fill = overlay.children[0];
  const edges = overlay.children[1];

  if (fill instanceof THREE.Mesh && fill.material instanceof THREE.MeshBasicMaterial) {
    fill.material.color.setHex(colors.cuboidFill);
    fill.material.needsUpdate = true;
  }

  if (edges instanceof THREE.LineSegments && edges.material instanceof THREE.LineBasicMaterial) {
    edges.material.color.setHex(colors.cuboidEdge);
    edges.material.needsUpdate = true;
  }
}

function updateCuboidOverlay(
  overlay: THREE.Group,
  bounds: CuboidBounds,
  dimensions: SchematicDimensions,
) {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const length = bounds.maxZ - bounds.minZ + 1;
  overlay.position.set(
    (bounds.minX + bounds.maxX) / 2 - (dimensions.width - 1) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2 - (dimensions.length - 1) / 2,
  );
  overlay.scale.set(
    width + cuboidOverlayPadding * 2,
    height + cuboidOverlayPadding * 2,
    length + cuboidOverlayPadding * 2,
  );
  overlay.visible = true;
}

function updateCuboidCornerLabels(
  labels: Record<'a' | 'b', HTMLSpanElement | null>,
  corners: CuboidCornerPoints | null | undefined,
  shouldShow: boolean,
  model: SchematicModel | null,
  displayGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
) {
  for (const corner of ['a', 'b'] as const) {
    const label = labels[corner];
    const point = corners?.[corner];
    if (!label || !shouldShow || !point || !model) {
      if (label) label.classList.remove('is-visible');
      continue;
    }

    labelProjectionVector.set(
      point.x - (model.dimensions.width - 1) / 2,
      point.y + cornerLabelOffset,
      point.z - (model.dimensions.length - 1) / 2,
    );
    displayGroup.localToWorld(labelProjectionVector);
    labelProjectionVector.project(camera);

    if (
      labelProjectionVector.z < -1
      || labelProjectionVector.z > 1
      || Math.abs(labelProjectionVector.x) > 1.2
      || Math.abs(labelProjectionVector.y) > 1.2
    ) {
      label.classList.remove('is-visible');
      continue;
    }

    const canvas = renderer.domElement;
    const x = (labelProjectionVector.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-labelProjectionVector.y * 0.5 + 0.5) * canvas.clientHeight;
    label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    label.classList.add('is-visible');
  }
}

function updateRotationControlPosition(
  control: HTMLDivElement | null,
  target: 'block' | 'cuboid' | null,
  selectedBlock: VoxelBlock | null,
  cuboidBounds: CuboidBounds | null,
  model: SchematicModel | null,
  displayGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
) {
  if (!control || !model || !target) {
    control?.classList.remove('is-visible');
    return;
  }

  if (target === 'cuboid') {
    if (!cuboidBounds) {
      control.classList.remove('is-visible');
      return;
    }

    rotationControlProjectionVector.set(
      ((cuboidBounds.minX + cuboidBounds.maxX) / 2) - (model.dimensions.width - 1) / 2,
      cuboidBounds.maxY + 1.14,
      ((cuboidBounds.minZ + cuboidBounds.maxZ) / 2) - (model.dimensions.length - 1) / 2,
    );
  } else {
    if (!selectedBlock) {
      control.classList.remove('is-visible');
      return;
    }

    rotationControlProjectionVector.set(
      selectedBlock.x - (model.dimensions.width - 1) / 2,
      selectedBlock.y + 1.16,
      selectedBlock.z - (model.dimensions.length - 1) / 2,
    );
  }

  displayGroup.localToWorld(rotationControlProjectionVector);
  rotationControlProjectionVector.project(camera);

  if (
    rotationControlProjectionVector.z < -1
    || rotationControlProjectionVector.z > 1
    || Math.abs(rotationControlProjectionVector.x) > 1.15
    || Math.abs(rotationControlProjectionVector.y) > 1.15
  ) {
    control.classList.remove('is-visible');
    return;
  }

  const canvas = renderer.domElement;
  const x = (rotationControlProjectionVector.x * 0.5 + 0.5) * canvas.clientWidth;
  const y = (-rotationControlProjectionVector.y * 0.5 + 0.5) * canvas.clientHeight;
  control.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  control.classList.add('is-visible');
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
  const hit = pickModelIntersection(event, renderer, camera, modelGroup);
  if (!hit || hit.instanceId === undefined) return null;

  const mesh = hit.object as THREE.InstancedMesh;
  const blocks = mesh.userData.blocks as VoxelBlock[] | undefined;
  return blocks?.[hit.instanceId] ?? null;
}

function pickTextureFace(
  event: PointerEvent,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  modelGroup: THREE.Group,
  displayGroup: THREE.Group,
): TextureFaceHit | null {
  const hit = pickModelIntersection(event, renderer, camera, modelGroup);
  if (!hit || hit.instanceId === undefined) return null;

  const mesh = hit.object as THREE.InstancedMesh;
  const blocks = mesh.userData.blocks as VoxelBlock[] | undefined;
  const part = mesh.userData.part as ResolvedBlockPart | undefined;
  const block = blocks?.[hit.instanceId];
  if (!block || !part) return null;

  const materialIndex = hit.face?.materialIndex;
  const face = typeof materialIndex === 'number' && faceOrder[materialIndex]
    ? faceOrder[materialIndex]
    : faceFromIntersectionNormal(hit, mesh, displayGroup);

  return {
    block,
    partKey: part.key,
    face,
    textureId: part.faceTextures[face],
  };
}

function pickPlacementPoint(
  event: PointerEvent,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  modelGroup: THREE.Group,
  displayGroup: THREE.Group,
  model: SchematicModel | null,
  occupiedBlockKeys: Set<string>,
): PlacementPoint | null {
  if (!model) return null;

  const hit = pickModelIntersection(event, renderer, camera, modelGroup);
  if (!hit || hit.instanceId === undefined || !hit.face) return null;

  const mesh = hit.object as THREE.InstancedMesh;
  const blocks = mesh.userData.blocks as VoxelBlock[] | undefined;
  const block = blocks?.[hit.instanceId];
  if (!block) return null;

  const face = faceFromIntersectionNormal(hit, mesh, displayGroup);
  const offset = faceOffsets[face];
  const point = {
    x: block.x + offset[0],
    y: block.y + offset[1],
    z: block.z + offset[2],
  };
  if (!pointInsideDimensions(point, model.dimensions)) return null;

  return occupiedBlockKeys.has(pointKey(point)) ? null : point;
}

function updatePlacementPreview(
  preview: THREE.LineSegments,
  point: PlacementPoint | null,
  model: SchematicModel | null,
  previewBlock: VoxelBlock | null,
) {
  if (!point || !model || !previewBlock) {
    preview.visible = false;
    return;
  }

  preview.position.set(
    point.x - (model.dimensions.width - 1) / 2,
    point.y,
    point.z - (model.dimensions.length - 1) / 2,
  );
  preview.visible = true;
}

function pickModelIntersection(
  event: PointerEvent,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  modelGroup: THREE.Group,
): THREE.Intersection | null {
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObjects(modelGroup.children, false);
  return intersections.find((intersection) => intersection.instanceId !== undefined) ?? null;
}

function faceFromIntersectionNormal(
  hit: THREE.Intersection,
  mesh: THREE.InstancedMesh,
  displayGroup: THREE.Group,
): ModelFaceName {
  const normal = hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4();
  const displayRotation = new THREE.Quaternion();
  if (hit.instanceId !== undefined) {
    mesh.getMatrixAt(hit.instanceId, matrix);
    normal.transformDirection(matrix);
  }
  normal.transformDirection(mesh.matrixWorld).normalize();
  displayGroup.getWorldQuaternion(displayRotation);
  normal.applyQuaternion(displayRotation.invert()).normalize();

  let bestFace: ModelFaceName = 'up';
  let bestDot = -Infinity;
  for (const face of faceOrder) {
    const offset = faceOffsets[face];
    const dot = normal.dot(new THREE.Vector3(offset[0], offset[1], offset[2]));
    if (dot > bestDot) {
      bestDot = dot;
      bestFace = face;
    }
  }
  return bestFace;
}

function pointInsideDimensions(point: PlacementPoint, dimensions: SchematicDimensions): boolean {
  return (
    point.x >= 0
    && point.x < dimensions.width
    && point.y >= 0
    && point.y < dimensions.height
    && point.z >= 0
    && point.z < dimensions.length
  );
}

function pointKey(point: PlacementPoint): string {
  return `${point.x},${point.y},${point.z}`;
}

function geometryForPart(part: ResolvedBlockPart, textureAdjustments: TextureAdjustmentMap = {}): THREE.BufferGeometry {
  const uvKey = faceOrder
    .map(
      (face) =>
        `${face}:${part.faceUvs[face]?.join(',') ?? 'default'}:${part.faceRotations[face]}:${textureAdjustmentFaceKey(part, face, textureAdjustments)}:${part.variantRotation.x}:${
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

  const geometry = createModelElementGeometry(part, textureAdjustments);

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

function createModelElementGeometry(part: ResolvedBlockPart, textureAdjustments: TextureAdjustmentMap = {}): THREE.BufferGeometry {
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
    const faceUvs = applyTextureAdjustment(
      rotateUvCorners(baseUvs, part.faceRotations[face]),
      part,
      face,
      textureAdjustments,
    );
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

export function textureAdjustmentKey(
  blockId: string,
  face: ModelFaceName,
  textureId: string | null,
  partKey = '*',
): string {
  return [blockId, partKey, face, textureId ?? 'fallback'].map(encodeURIComponent).join('::');
}

function textureAdjustmentForFace(
  part: ResolvedBlockPart,
  face: ModelFaceName,
  textureAdjustments: TextureAdjustmentMap,
): TextureFaceAdjustment | null {
  return textureAdjustments[textureAdjustmentKey(part.blockId, face, part.faceTextures[face], part.key)]
    ?? textureAdjustments[textureAdjustmentKey(part.blockId, face, part.faceTextures[face])]
    ?? textureAdjustments[legacyTextureAdjustmentKey(part.blockId, face, part.faceTextures[face])]
    ?? null;
}

function legacyTextureAdjustmentKey(blockId: string, face: ModelFaceName, textureId: string | null): string {
  return `${blockId}::${face}::${textureId ?? 'fallback'}`;
}

function textureAdjustmentFaceKey(
  part: ResolvedBlockPart,
  face: ModelFaceName,
  textureAdjustments: TextureAdjustmentMap,
): string {
  const adjustment = textureAdjustmentForFace(part, face, textureAdjustments);
  if (!adjustment) return 'none';
  return `${adjustment.offsetU},${adjustment.offsetV},${adjustment.rotation}`;
}

function textureAdjustmentCacheKey(part: ResolvedBlockPart, textureAdjustments: TextureAdjustmentMap): string {
  return faceOrder.map((face) => `${face}:${textureAdjustmentFaceKey(part, face, textureAdjustments)}`).join('|');
}

function applyTextureAdjustment(
  corners: Array<[number, number]>,
  part: ResolvedBlockPart,
  face: ModelFaceName,
  textureAdjustments: TextureAdjustmentMap,
): Array<[number, number]> {
  const adjustment = textureAdjustmentForFace(part, face, textureAdjustments);
  if (!adjustment) return corners;

  const [textureWidth, textureHeight] = part.textureSize ?? [16, 16];
  const offsetU = adjustment.offsetU / textureWidth;
  const offsetV = -adjustment.offsetV / textureHeight;
  const shifted = corners.map(([u, v]) => [u + offsetU, v + offsetV] as [number, number]);
  const turns = (((adjustment.rotation % 360) + 360) % 360) / 90;
  if (!turns) return shifted;

  const centerU = shifted.reduce((sum, [u]) => sum + u, 0) / shifted.length;
  const centerV = shifted.reduce((sum, [, v]) => sum + v, 0) / shifted.length;
  let rotated = shifted;
  for (let index = 0; index < turns; index += 1) {
    rotated = rotated.map(([u, v]) => [centerU + (v - centerV), centerV - (u - centerU)] as [number, number]);
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
      textureShouldWriteDepth(textureId, part.faceTranslucencies[face], part),
      // Rails are a single flat quad with the down face hidden to avoid
      // z-fighting; render the surviving quad double-sided so the rail stays
      // visible when the camera looks up at it from below.
      isRailPart(part),
    );
  });
}

function textureMaterial(
  textureId: string,
  tintColor: number | null,
  shade: boolean,
  translucent: boolean,
  depthWrite: boolean,
  forceDoubleSide = false,
): THREE.Material {
  const key = `texture::${textureId}::${tintColor ?? 'none'}::shade:${shade}::translucent:${translucent}::depth:${depthWrite}::double:${forceDoubleSide}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const texture = textureLoader.load(textureUrl(textureId), (loadedTexture) => {
    cropAnimatedTextureToFirstFrame(loadedTexture);
  });
  configureMinecraftTexture(texture, textureId);
  const cutout = isAlphaCutoutTexture(textureId);
  const glowing = isBeaconInnerTexture(textureId) || isGlowingTexture(textureId);
  const water = isWaterTexture(textureId);
  const transparent = textureRendersTransparent(textureId, translucent);
  const opacity = transparent ? translucentTextureOpacity(textureId) : 1;
  const side = forceDoubleSide || cutoutTextureNeedsDoubleSide(textureId) ? THREE.DoubleSide : THREE.FrontSide;

  const material = shade
    ? new THREE.MeshStandardMaterial({
        map: texture,
        color: tintColor ?? 0xffffff,
        emissive: glowing ? emissiveColor(textureId) : 0x000000,
        emissiveMap: glowing ? texture : null,
        emissiveIntensity: glowing ? 0.72 : 0,
        roughness: water ? 0.36 : 0.92,
        metalness: water ? 0.08 : 0.02,
        transparent,
        opacity,
        alphaTest: cutout ? 0.5 : water ? 0.02 : 0.08,
        depthWrite,
        side,
      })
    : new THREE.MeshBasicMaterial({
        map: texture,
        color: tintColor ?? 0xffffff,
        transparent,
        opacity,
        alphaTest: cutout ? 0.5 : 0.08,
        depthWrite,
        side,
        toneMapped: false,
      });
  materialCache.set(key, material);
  return material;
}

function textureShouldWriteDepth(textureId: string, translucent: boolean, part: ResolvedBlockPart): boolean {
  if (!textureRendersTransparent(textureId, translucent)) return true;
  if (part.blockId === 'minecraft:beacon' && isGlassTexture(textureId)) return false;
  return isGlassTexture(textureId);
}

function configureMinecraftTexture(texture: THREE.Texture, textureId: string) {
  // Entity textures (skins, skulls, chests, beds, …) are atlases that the
  // block-entity models sample by sub-region. Mipmapping averages a region
  // with its neighbours, so a small head bleeds the adjacent body/shirt colour
  // onto its edges. Vanilla never mipmaps entity textures — match that.
  const noMipmaps = isAlphaCutoutTexture(textureId) || isEntityTexture(textureId);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = noMipmaps ? THREE.NearestFilter : THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = !noMipmaps;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
}

function isEntityTexture(textureId: string): boolean {
  return textureId.includes('entity/');
}

function cropAnimatedTextureToFirstFrame(texture: THREE.Texture) {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (width <= 0 || height <= width || height % width !== 0) return;

  const frameRatio = width / height;
  texture.repeat.set(1, frameRatio);
  texture.offset.set(0, 1 - frameRatio);
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

function partHasTranslucentFaces(part: ResolvedBlockPart): boolean {
  return faceOrder.some((face) => {
    const textureId = part.faceTextures[face];
    return textureId !== null && textureRendersTransparent(textureId, part.faceTranslucencies[face]);
  });
}

function isWaterPart(part: ResolvedBlockPart): boolean {
  return part.blockId === 'minecraft:water';
}

function isRailPart(part: ResolvedBlockPart): boolean {
  const path = part.blockId.replace(/^minecraft:/, '');
  return path === 'rail' || path.endsWith('_rail');
}

function isBeaconInnerTexture(textureId: string): boolean {
  return textureId.replace(/^minecraft:/, '') === 'block/beacon';
}

function isGlowingTexture(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return (
    path === 'block/sea_lantern'
    || path === 'block/lantern'
    || path === 'block/soul_lantern'
    || path === 'block/copper_lantern'
    || path.endsWith('_copper_lantern')
    || path === 'block/smoker_front_on'
    || path.endsWith('_emissive')
    || path.startsWith('block/lava_')
    || path.includes('campfire_fire')
  );
}

function emissiveColor(textureId: string): number {
  const path = textureId.replace(/^minecraft:/, '');
  if (path === 'block/sea_lantern') return 0xcff8e9;
  if (path === 'block/soul_lantern') return 0x64d6ff;
  if (isCopperLanternTexturePath(path)) return 0xffffff;
  if (path === 'block/smoker_front_on') return 0xff8a24;
  if (path.endsWith('_emissive')) return 0xffffb8;
  if (path.startsWith('block/lava_') || path.includes('campfire_fire')) return 0xff8a24;
  if (path === 'block/lantern') return 0xffc552;
  return 0x65fff5;
}

function isCopperLanternTexturePath(path: string): boolean {
  return path === 'block/copper_lantern' || path.endsWith('_copper_lantern');
}

function isWaterTexture(textureId: string): boolean {
  return textureId.replace(/^minecraft:/, '').startsWith('block/water_');
}

function textureRendersTransparent(textureId: string, translucent: boolean): boolean {
  return translucent;
}

function isAlphaCutoutTexture(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return (
    /(^|\/)(wheat|carrots|potatoes|beetroots|nether_wart)_stage\d+$/.test(path)
    || path.includes('crop')
    || path.includes('leaves')
    || path.includes('sapling')
    || path.includes('grass')
    || path.includes('fern')
    || path.includes('bush')
    || path.includes('roots')
    || path.includes('vines')
    || path.includes('flower')
    || isCrossPlaneFlowerTexture(path)
    || path.includes('coral')
    || path.includes('mushroom')
    || path.includes('amethyst_bud')
    || path.includes('dripstone')
    || path.endsWith('_chain')
    || path.startsWith('entity/decorated_pot/')
    || path === 'block/cobweb'
    // Barriers stamp the no-entry icon on a full cube; cut away its transparent
    // background so only the symbol shows and the block stays "invisible".
    || path === 'item/barrier'
  );
}

function isCrossPlaneFlowerTexture(path: string): boolean {
  return /^block\/(allium|azure_bluet|blue_orchid|dandelion|golden_dandelion|lily_of_the_valley|oxeye_daisy|poppy|.*_tulip)$/.test(path);
}

function cutoutTextureNeedsDoubleSide(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return (
    path.includes('grass')
    || path.includes('fern')
    || path.includes('bush')
    || path.includes('roots')
    || path.includes('vines')
    || path.includes('flower')
    || isCrossPlaneFlowerTexture(path)
    || /(^|\/)(wheat|carrots|potatoes|beetroots|nether_wart)_stage\d+$/.test(path)
    || path.includes('crop')
    || path.includes('sapling')
    || path.includes('coral')
    || path.includes('mushroom')
    || path.includes('amethyst_bud')
    || path.includes('dripstone')
  );
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
  const horizontalRadius = Math.hypot(dimensions.width, dimensions.length) * 0.5;
  const verticalRadius = Math.max(1, dimensions.height * 0.62);
  const radius = Math.max(horizontalRadius, verticalRadius, 6);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.06;
  const direction = new THREE.Vector3(-0.92, 0.64, -1).normalize();
  controls.target.copy(target);
  controls.maxDistance = Math.max(240, distance * 4);
  camera.position.copy(target).add(direction.multiplyScalar(distance));
  camera.near = 0.03;
  camera.far = Math.max(500, distance * 8);
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  controls.update();
}

function modelCameraFitKey(model: SchematicModel): string {
  const { width, height, length } = model.dimensions;
  return `${width}x${height}x${length}:${cameraFitDimensions(model).height}`;
}

function cameraFitDimensions(model: SchematicModel): SchematicDimensions {
  let occupiedTopLayer = -1;

  for (const block of model.blocks) {
    occupiedTopLayer = Math.max(occupiedTopLayer, block.y);
  }

  return {
    width: model.dimensions.width,
    height: occupiedTopLayer >= 0 ? occupiedTopLayer + 1 : model.dimensions.height,
    length: model.dimensions.length,
  };
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

function sceneThemeColors(theme: 'light' | 'dark') {
  return theme === 'dark'
    ? { background: 0x25303a, floor: 0x303c45, grid: 0x6f8987, cuboidFill: 0x28c4bd, cuboidEdge: 0x62e4df }
    : { background: 0xf1f5f8, floor: 0xf1f5f8, grid: 0x4d5b54, cuboidFill: 0x0f7f80, cuboidEdge: 0x086f74 };
}

function floorShadowOpacity(theme: 'light' | 'dark') {
  return theme === 'dark' ? 0.3 : 0.16;
}

function transitionStageBackground(
  scene: THREE.Scene,
  target: string | number,
  transitionRef: MutableRefObject<StageBackgroundTransition | null>,
  delayMs = 0,
) {
  const next = new THREE.Color(target);
  const current = scene.background instanceof THREE.Color
    ? scene.background.clone()
    : next.clone();

  if (current.equals(next)) {
    scene.background = next;
    transitionRef.current = null;
    return;
  }

  transitionRef.current = {
    from: current,
    to: next,
    start: performance.now() + delayMs,
    duration: stageBackgroundTransitionDurationMs,
  };
}

function updateStageBackgroundTransition(
  scene: THREE.Scene,
  time: number,
  transitionRef: MutableRefObject<StageBackgroundTransition | null>,
) {
  const transition = transitionRef.current;
  if (!transition) return;

  if (time < transition.start) {
    scene.background = transition.from.clone();
    return;
  }

  const progress = Math.min(1, (time - transition.start) / transition.duration);
  const eased = 1 - Math.pow(1 - progress, 3);
  scene.background = transition.from.clone().lerp(transition.to, eased);

  if (progress >= 1) {
    scene.background = transition.to.clone();
    transitionRef.current = null;
  }
}

function createFootprintGrid(dimensions: SchematicDimensions, theme: 'light' | 'dark'): THREE.LineSegments {
  const vertices: number[] = [];
  const material = new THREE.LineBasicMaterial({
    color: sceneThemeColors(theme).grid,
    transparent: true,
    opacity: theme === 'dark' ? 0.34 : 0.28,
  });
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
