import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BoxSelect,
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cuboid,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Focus,
  Layers,
  MousePointer2,
  Moon,
  Pencil,
  Plus,
  Replace,
  RotateCcw,
  RotateCw,
  Rotate3D,
  ScanSearch,
  Search,
  Star,
  StarOff,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import {
  Viewer3D,
  type AxisGizmoOrientation,
  type CameraMode,
  type PlacementPoint,
  type SelectionButton,
  type Viewer3DHandle,
} from './components/Viewer3D';
import { createBlockThumbnail } from './lib/blockThumbnails';
import { writeNbt, type NbtDocument } from './lib/nbt';
import {
  createSpongeSchematicDocument,
  createVoxelBlock,
  createSampleModel,
  finalizeSchematicModel,
  parseSchematicDocument,
  renameSchematicDocument,
  type PlayerHeadTexture,
  type SchematicModel,
  type VoxelBlock,
} from './lib/schematic';
import defaultSchematicUrl from '../Medieval House.litematic?url';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type DraggedFileKind = 'none' | 'unsupported-file' | 'unknown-file' | 'schematic-file';
type InspectorTab = 'selection' | 'materials' | 'layers';
type AppView = 'inspect' | 'edit';
type EditTool = 'select' | 'build';
type Theme = 'light' | 'dark';
type MaterialsScope = 'build' | 'cuboid';
type CuboidCornerId = 'a' | 'b';
type Direction = 'up' | 'down' | 'north' | 'south' | 'west' | 'east';
type RotationDirection = 'clockwise' | 'counterclockwise';

interface PendingCuboidCorner {
  corner: CuboidCornerId;
  point: CuboidPoint;
}

interface CuboidCorners {
  a: CuboidPoint | null;
  b: CuboidPoint | null;
}

interface CuboidPoint {
  x: number;
  y: number;
  z: number;
}

export interface CuboidBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface MaterialSummary {
  id: string;
  label: string;
  count: number;
  color: number;
  stateKey: string;
}

const schematicFileExtensions = new Set(['.litematic', '.schem', '.schematic', '.nbt']);
const defaultSchematicFileName = 'Medieval House.litematic';
const themeStorageKey = 'schematic-editor-theme';
const defaultHotbarBlocks = [
  'minecraft:stone',
  'minecraft:oak_planks',
  'minecraft:glass',
  'minecraft:oak_log',
  'minecraft:torch',
  'minecraft:dirt',
  'minecraft:grass_block',
  'minecraft:cobblestone',
  'minecraft:water',
];
const commonBuildBlocks = [
  'minecraft:air',
  ...defaultHotbarBlocks,
  'minecraft:spruce_planks',
  'minecraft:birch_planks',
  'minecraft:dark_oak_planks',
  'minecraft:stone_bricks',
  'minecraft:bricks',
  'minecraft:smooth_stone',
  'minecraft:deepslate_bricks',
  'minecraft:sandstone',
  'minecraft:oak_stairs',
  'minecraft:oak_slab',
  'minecraft:oak_door',
  'minecraft:lantern',
  'minecraft:redstone',
  'minecraft:white_wool',
  'minecraft:black_concrete',
];
const blockstateFiles = import.meta.glob('/public/minecraft-assets/assets/minecraft/blockstates/*.json', {
  query: '?url',
  import: 'default',
});

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const savedTheme = window.localStorage.getItem(themeStorageKey);
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [model, setModel] = useState<SchematicModel | null>(null);
  const [appView, setAppView] = useState<AppView>('inspect');
  const [schematicName, setSchematicName] = useState('');
  const [isEditingSchematicName, setIsEditingSchematicName] = useState(false);
  const [schematicDocument, setSchematicDocument] = useState<NbtDocument | null>(null);
  const [schematicExtension, setSchematicExtension] = useState('.schem');
  const [hasEditChanges, setHasEditChanges] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [visibleLayer, setVisibleLayer] = useState(model?.dimensions.height ? model.dimensions.height - 1 : 0);
  const [singleLayer, setSingleLayer] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<VoxelBlock | null>(null);
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(() => new Set());
  const [materialSearch, setMaterialSearch] = useState('');
  const [hiddenMaterialIds, setHiddenMaterialIds] = useState<Set<string>>(() => new Set());
  const [playerHeadSelections, setPlayerHeadSelections] = useState<Record<string, string>>({});
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('materials');
  const [cuboidSelectionMode, setCuboidSelectionMode] = useState(false);
  const [cuboidCorners, setCuboidCorners] = useState<CuboidCorners>(() => emptyCuboidCorners());
  const [materialsScope, setMaterialsScope] = useState<MaterialsScope>('build');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [editTool, setEditTool] = useState<EditTool>('select');
  const [selectedBuildBlock, setSelectedBuildBlock] = useState(defaultHotbarBlocks[0]);
  const [hotbarBlocks, setHotbarBlocks] = useState<string[]>(defaultHotbarBlocks);
  const [blockSearch, setBlockSearch] = useState('');
  const [replaceFromBlock, setReplaceFromBlock] = useState('');
  const [replaceToBlock, setReplaceToBlock] = useState(defaultHotbarBlocks[0]);
  const [editNotice, setEditNotice] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<Viewer3DHandle | null>(null);
  const axisGizmoRef = useRef<HTMLDivElement | null>(null);
  const materialItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const selectionPanelRef = useRef<HTMLElement | null>(null);
  const materialPanelRef = useRef<HTMLElement | null>(null);
  const layerPanelRef = useRef<HTMLElement | null>(null);
  const schematicNameInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const visibleWorldY = model ? model.origin.y + visibleLayer : visibleLayer;
  const selectedBlockWorldX = selectedBlock && model ? model.origin.x + selectedBlock.x : null;
  const selectedBlockWorldY = selectedBlock && model ? model.origin.y + selectedBlock.y : null;
  const selectedBlockWorldZ = selectedBlock && model ? model.origin.z + selectedBlock.z : null;
  const spectatorSpeed = 11;
  const showUploadOverlay = isDraggingFile;

  const updateAxisGizmo = useCallback((orientation: AxisGizmoOrientation) => {
    const gizmo = axisGizmoRef.current;
    if (!gizmo) return;

    const originX = 36;
    const originY = 42;
    const labelRadius = 40;
    const lineRadius = 34;

    for (const axis of ['x', 'y', 'z'] as const) {
      gizmo.style.setProperty(`--axis-${axis}-x`, orientation[axis].x.toString());
      gizmo.style.setProperty(`--axis-${axis}-y`, orientation[axis].y.toString());
      gizmo.style.setProperty(`--axis-${axis}-angle`, `${orientation[axis].angle}deg`);
      gizmo.style.setProperty(`--axis-${axis}-length`, `${Math.max(4, orientation[axis].length * lineRadius)}px`);
      gizmo.style.setProperty(`--axis-${axis}-label-x`, `${originX + orientation[axis].x * labelRadius}px`);
      gizmo.style.setProperty(`--axis-${axis}-label-y`, `${originY + orientation[axis].y * labelRadius}px`);
    }
  }, []);

  const currentLayerBlockCount = useMemo(() => {
    if (!model) return 0;
    return model.blocks.filter((block) => block.y === visibleLayer && !hiddenMaterialIds.has(materialIdForBlock(block))).length;
  }, [hiddenMaterialIds, model, visibleLayer]);

  const materials = useMemo<MaterialSummary[]>(() => {
    if (!model) return [];

    return summarizeMaterials(model.blocks);
  }, [model]);

  const cuboidBounds = useMemo(() => {
    if (!model || !cuboidCorners.a || !cuboidCorners.b) return null;
    return normalizeCuboidBounds(cuboidCorners.a, cuboidCorners.b, model);
  }, [cuboidCorners, model]);
  const pendingCuboidCorner: PendingCuboidCorner | null = cuboidBounds
    ? null
    : cuboidCorners.a
      ? { corner: 'a', point: cuboidCorners.a }
      : cuboidCorners.b
        ? { corner: 'b', point: cuboidCorners.b }
        : null;
  const hasCuboidSelection = Boolean(cuboidCorners.a || cuboidCorners.b);
  const cuboidBoundsKey = cuboidBounds ? boundsKey(cuboidBounds) : '';
  const cuboidMaterials = useMemo<MaterialSummary[]>(() => {
    if (!model || !cuboidBounds) return [];

    return summarizeMaterials(model.blocks.filter((block) => blockInBounds(block, cuboidBounds)));
  }, [cuboidBoundsKey, model]);

  const activeMaterials = materialsScope === 'cuboid' ? cuboidMaterials : materials;
  const activeMaterialsLabel = materialsScope === 'cuboid' ? 'Selected Area' : 'Entire Build';

  const filteredMaterials = useMemo(() => {
    const query = materialSearch.trim().toLocaleLowerCase();
    if (!query) return activeMaterials;

    return activeMaterials.filter((material) => {
      const label = material.label.toLocaleLowerCase();
      const id = material.id.toLocaleLowerCase();
      return label.includes(query) || id.includes(query);
    });
  }, [activeMaterials, materialSearch]);

  const cuboidDimensions = cuboidBounds ? dimensionsForBounds(cuboidBounds) : null;
  const cuboidVolume = cuboidDimensions
    ? cuboidDimensions.width * cuboidDimensions.height * cuboidDimensions.length
    : 0;

  const playerHeadOptions = useMemo(() => uniquePlayerHeadTextures(model), [model]);
  const selectedBlockKey = selectedBlock ? blockPositionKey(selectedBlock) : null;
  const selectedMaterialId = selectedBlock ? materialIdForBlock(selectedBlock) : null;
  const selectedPlayerHeadTextureId = selectedBlock
    ? playerHeadSelections[blockPositionKey(selectedBlock)] ?? selectedBlock.playerHeadTexture?.id ?? playerHeadOptions[0]?.id ?? ''
    : '';
  const isDarkTheme = theme === 'dark';
  const canSaveSchematic = Boolean(model && schematicName.trim());
  const selectedBuildBlockPreview = useMemo(() => createVoxelBlock(0, 0, 0, selectedBuildBlock), [selectedBuildBlock]);
  const editAvailableBlocks = useMemo(() => {
    const fromAssets = Object.keys(blockstateFiles)
      .map((path) => {
        const fileName = path.split('/').at(-1) ?? '';
        return fileName.endsWith('.json') ? `minecraft:${fileName.slice(0, -5)}` : '';
      })
      .filter(Boolean);
    const fromModel = model?.blocks.map((block) => block.stateKey) ?? [];
    const allBlocks = new Set([...commonBuildBlocks, ...fromModel, ...fromAssets]);
    const query = blockSearch.trim().toLocaleLowerCase();

    return Array.from(allBlocks)
      .filter((stateKey) => {
        if (!query) return true;
        const label = formatBlockName(stateKey).toLocaleLowerCase();
        return stateKey.toLocaleLowerCase().includes(query) || label.includes(query);
      })
      .sort((a, b) => formatBlockName(a).localeCompare(formatBlockName(b)));
  }, [blockSearch, model]);

  useEffect(() => {
    if (materialsScope === 'cuboid' && !cuboidBounds) {
      setMaterialsScope('build');
    }
  }, [cuboidBounds, materialsScope]);

  useEffect(() => {
    let isCancelled = false;

    const loadDefaultSchematic = async () => {
      setLoadState('loading');
      setError('');

      try {
        const response = await fetch(defaultSchematicUrl);
        if (!response.ok) {
          throw new Error(`Could not load ${defaultSchematicFileName}.`);
        }

        const buffer = await response.arrayBuffer();
        const parsed = parseSchematicDocument(buffer, { fileName: defaultSchematicFileName });
        if (isCancelled) return;
        applySchematic(parsed.model, parsed.nbt, fileExtension(defaultSchematicFileName));
      } catch (caught) {
        if (isCancelled) return;

        const fallback = createSampleModel();
        setModel(fallback);
        setSchematicName(fallback.name);
        setSchematicDocument(null);
        setSchematicExtension('.schem');
        setVisibleLayer(fallback.dimensions.height - 1);
        setLoadState('ready');
        setError(caught instanceof Error ? caught.message : 'Could not load the default schematic.');
      }
    };

    void loadDefaultSchematic();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!model) return;
    setCuboidCorners((current) => {
      const next = {
        a: current.a ? clampPointToModel(current.a, model) : null,
        b: current.b ? clampPointToModel(current.b, model) : null,
      };
      return cuboidCornersKey(next) === cuboidCornersKey(current) ? current : next;
    });
  }, [model]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!isEditingSchematicName) return;

    const frame = window.requestAnimationFrame(() => {
      schematicNameInputRef.current?.focus();
      schematicNameInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isEditingSchematicName]);

  useEffect(() => {
    if (!model || !selectedBlock) {
      return;
    }

    const isFromCurrentModel = model.blocks.includes(selectedBlock);
    const isVisible =
      !hiddenMaterialIds.has(materialIdForBlock(selectedBlock))
      && (singleLayer ? selectedBlock.y === visibleLayer : selectedBlock.y <= visibleLayer);
    if (!isFromCurrentModel || !isVisible) {
      setSelectedBlock(null);
    }
  }, [hiddenMaterialIds, model, selectedBlock, singleLayer, visibleLayer]);

  useEffect(() => {
    const validMaterialIds = new Set(materials.map((material) => material.id));
    setExpandedMaterialIds((current) => {
      const next = new Set(Array.from(current).filter((materialId) => validMaterialIds.has(materialId)));
      return next.size === current.size ? current : next;
    });
  }, [materials]);

  useEffect(() => {
    if (!selectedMaterialId) return;

    const selectedMaterialIsVisible = filteredMaterials.some((material) => material.id === selectedMaterialId);
    if (!selectedMaterialIsVisible && materialSearch.trim()) {
      setMaterialSearch('');
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      materialItemRefs.current.get(selectedMaterialId)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredMaterials, materialSearch, selectedMaterialId]);

  const applySchematic = (nextModel: SchematicModel, nextDocument: NbtDocument | null, nextExtension: string) => {
    setModel(nextModel);
    setSchematicName(nextModel.name);
    setIsEditingSchematicName(false);
    setSchematicDocument(nextDocument);
    setSchematicExtension(nextExtension);
    setHasEditChanges(false);
    setVisibleLayer(nextModel.dimensions.height - 1);
    setSingleLayer(false);
    setSelectedBlock(null);
    setExpandedMaterialIds(new Set());
    setMaterialSearch('');
    setPlayerHeadSelections({});
    setHiddenMaterialIds(new Set());
    setCuboidCorners(emptyCuboidCorners());
    setMaterialsScope('build');
    setEditTool('select');
    setSelectedBuildBlock(defaultHotbarBlocks[0]);
    setHotbarBlocks(defaultHotbarBlocks);
    setBlockSearch('');
    setReplaceFromBlock(nextModel.blocks[0]?.stateKey ?? '');
    setReplaceToBlock(defaultHotbarBlocks[0]);
    setEditNotice('');
    setLoadState('ready');
  };

  const handleFile = async (file: File) => {
    setLoadState('loading');
    setError('');

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSchematicDocument(buffer, { fileName: file.name });
      applySchematic(parsed.model, parsed.nbt, fileExtension(file.name));
    } catch (caught) {
      setLoadState('error');
      setError(caught instanceof Error ? caught.message : 'Could not read this schematic file.');
    }
  };

  const commitSchematicName = () => {
    if (!model) return;

    const nextName = schematicName.trim() || model.name;
    setSchematicName(nextName);
    setModel((current) => (current ? { ...current, name: nextName } : current));
    setIsEditingSchematicName(false);
  };

  const exportRenamedSchematic = () => {
    if (!model) return;

    const nextName = schematicName.trim();
    try {
      const exportDocument = hasEditChanges || !schematicDocument
        ? createSpongeSchematicDocument({ ...model, name: nextName }, nextName)
        : renameSchematicDocument(schematicDocument, model.source, nextName);
      const bytes = writeNbt(exportDocument);
      const arrayBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(arrayBuffer).set(bytes);
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFileBaseName(nextName)}${hasEditChanges ? '.schem' : schematicExtension}`;
      link.click();
      URL.revokeObjectURL(url);
      setModel((current) => (current ? { ...current, name: nextName } : current));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export this schematic file.');
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    const draggedFileKind = getDraggedFileKind(event.dataTransfer);
    if (draggedFileKind === 'none') return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(draggedFileKind !== 'unsupported-file');
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    const draggedFileKind = getDraggedFileKind(event.dataTransfer);
    if (draggedFileKind === 'none') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = draggedFileKind === 'unsupported-file' ? 'none' : 'copy';
    if (draggedFileKind === 'unsupported-file') {
      setIsDraggingFile(false);
    } else if (!isDraggingFile) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (getDraggedFileKind(event.dataTransfer) === 'none') return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    if (getDraggedFileKind(event.dataTransfer) === 'none') return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);

    const file = event.dataTransfer.files[0];
    if (file && isSchematicFileName(file.name)) void handleFile(file);
  };

  const stepLayer = (delta: number) => {
    if (!model) return;
    setVisibleLayer((current) => clamp(current + delta, 0, model.dimensions.height - 1));
  };

  const layerPercent = model && model.dimensions.height > 1 ? (visibleLayer / (model.dimensions.height - 1)) * 100 : 100;

  const toggleMaterialVisibility = (id: string) => {
    setHiddenMaterialIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleMaterialBreakdown = (id: string) => {
    setExpandedMaterialIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const choosePlayerHeadTexture = (textureId: string) => {
    if (!selectedBlockKey) return;

    setPlayerHeadSelections((current) => ({
      ...current,
      [selectedBlockKey]: textureId,
    }));
  };

  const toggleTheme = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  const showPanel = (tab: InspectorTab) => {
    setInspectorTab(tab);
    const panel = tab === 'selection' ? selectionPanelRef : tab === 'layers' ? layerPanelRef : materialPanelRef;
    window.requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const beginCuboidSelection = (resetSelection = false, revealViewPanel = appView === 'inspect') => {
    if (resetSelection) {
      setCuboidCorners(emptyCuboidCorners());
      setMaterialsScope('build');
    }
    setCuboidSelectionMode(true);
    if (revealViewPanel) showPanel('selection');
  };

  const openInspectorPanel = (tab: InspectorTab) => {
    setAppView('inspect');
    showPanel(tab);
  };

  const activateEditTool = (tool: EditTool) => {
    setAppView('edit');
    setCuboidSelectionMode(false);
    setEditTool(tool);
  };

  const handleBlockSelect = (block: VoxelBlock | null, button: SelectionButton, placementPoint: PlacementPoint | null) => {
    if (cuboidSelectionMode && (appView === 'edit' || inspectorTab === 'selection')) {
      if (!block || !model) {
        setSelectedBlock(null);
        return;
      }

      setSelectedBlock(block);
      const corner = button === 'secondary' ? 'b' : 'a';
      const otherCorner = corner === 'a' ? cuboidCorners.b : cuboidCorners.a;
      setCuboidCorners((current) => ({
        ...current,
        [corner]: pointFromBlock(block),
      }));
      if (otherCorner) setMaterialsScope('cuboid');
      return;
    }

    if (appView === 'edit') {
      if (button === 'secondary') {
        if (!placementPoint) {
          setEditNotice('Choose an open face inside the schematic bounds.');
          return;
        }
        if (selectedBuildBlock === 'minecraft:air') {
          setEditNotice('Choose a solid block from the library before placing.');
          return;
        }
        setBlockAt(placementPoint.x, placementPoint.y, placementPoint.z, selectedBuildBlock);
        return;
      }

      if (!block) {
        setSelectedBlock(null);
        return;
      }

      setSelectedBlock(block);
      if (editTool === 'build') {
        eraseBlock(block);
        return;
      }
      return;
    }

    if (button !== 'primary') return;
    setSelectedBlock(block);
  };

  const clearCuboidSelection = () => {
    setCuboidCorners(emptyCuboidCorners());
    setMaterialsScope('build');
  };

  const updateModelBlocks = (updater: (blocks: VoxelBlock[], currentModel: SchematicModel) => VoxelBlock[]) => {
    setModel((current) => {
      if (!current) return current;

      const selectedKey = selectedBlock ? blockPositionKey(selectedBlock) : null;
      const blocks = updater(current.blocks, current)
        .filter((block) => blockInsideModel(block, current))
        .sort(compareBlocks);
      const nextModel = finalizeSchematicModel({
        ...current,
        source: 'Sponge .schem',
        blocks,
        paletteSize: new Set(blocks.map((block) => block.stateKey)).size,
        warnings: current.warnings,
      });
      if (selectedKey) {
        setSelectedBlock(blocks.find((block) => blockPositionKey(block) === selectedKey) ?? null);
      }
      setHasEditChanges(true);
      setSchematicExtension('.schem');
      return nextModel;
    });
  };

  const setBlockAt = (x: number, y: number, z: number, stateKey: string) => {
    if (!model || !pointInsideModel({ x, y, z }, model)) return false;
    const key = pointKey({ x, y, z });
    updateModelBlocks((blocks) => {
      const withoutTarget = blocks.filter((block) => blockPositionKey(block) !== key);
      if (stateKey === 'minecraft:air') return withoutTarget;
      return [...withoutTarget, createVoxelBlock(x, y, z, stateKey)];
    });
    const action = stateKey === 'minecraft:air' ? 'Removed block' : `${formatBlockName(stateKey)} placed`;
    setEditNotice(`${action} at ${model.origin.x + x}, ${model.origin.y + y}, ${model.origin.z + z}.`);
    return true;
  };

  const eraseBlock = (block: VoxelBlock) => {
    setBlockAt(block.x, block.y, block.z, 'minecraft:air');
  };

  const deleteSelection = () => {
    if (!model) return false;

    if (cuboidBounds) {
      const removedCount = model.blocks.filter((block) => blockInBounds(block, cuboidBounds)).length;
      if (removedCount === 0) {
        setEditNotice('Selected area is already empty.');
        return false;
      }
      updateModelBlocks((blocks) => blocks.filter((block) => !blockInBounds(block, cuboidBounds)));
      setEditNotice(`${removedCount.toLocaleString()} block${removedCount === 1 ? '' : 's'} removed.`);
      return true;
    }

    if (selectedBlock) {
      eraseBlock(selectedBlock);
      return true;
    }

    return false;
  };

  const placeAdjacentBlock = (direction: Direction) => {
    if (!selectedBlock) return;
    const offset = directionOffset(direction);
    const nextPoint = {
      x: selectedBlock.x + offset.x,
      y: selectedBlock.y + offset.y,
      z: selectedBlock.z + offset.z,
    };
    const placed = setBlockAt(nextPoint.x, nextPoint.y, nextPoint.z, selectedBuildBlock);
    if (!placed) setEditNotice('That adjacent position is outside the schematic bounds.');
  };

  const replaceBlocks = () => {
    if (!model || !replaceFromBlock || !replaceToBlock) return;
    const bounds = materialsScope === 'cuboid' ? cuboidBounds : null;
    const replaceableBlocks = model.blocks.filter((block) => {
      if (block.stateKey !== replaceFromBlock && materialIdForBlock(block) !== replaceFromBlock) return false;
      return !bounds || blockInBounds(block, bounds);
    });
    const replacedCount = replaceableBlocks.length;

    updateModelBlocks((blocks) => blocks.flatMap((block) => {
      if (block.stateKey !== replaceFromBlock && materialIdForBlock(block) !== replaceFromBlock) return [block];
      if (bounds && !blockInBounds(block, bounds)) return [block];
      if (replaceToBlock === 'minecraft:air') return [];
      return [createVoxelBlock(block.x, block.y, block.z, replaceToBlock)];
    }));
    setEditNotice(`${replacedCount.toLocaleString()} block${replacedCount === 1 ? '' : 's'} replaced.`);
  };

  const rotateSelection = (direction: RotationDirection) => {
    if (!model) return;

    if (materialsScope === 'cuboid' && cuboidBounds) {
      const rotatedBounds = rotatedBoundsForYRotation(cuboidBounds);
      if (!boundsInsideModel(rotatedBounds, model)) {
        setEditNotice('Rotated area would extend outside the schematic bounds.');
        return;
      }

      const sourceBlocks = model.blocks.filter((block) => blockInBounds(block, cuboidBounds));
      const sourceKeys = keysForBounds(cuboidBounds);
      const targetKeys = new Set(
        Array.from(sourceKeys, (key) => pointKey(rotatePointInBounds(pointFromKey(key), cuboidBounds, direction))),
      );
      const rotatedBlocks = sourceBlocks.map((block) => {
        const nextPoint = rotatePointInBounds(block, cuboidBounds, direction);
        return rotateVoxelBlock(block, nextPoint, direction);
      });

      updateModelBlocks((blocks) => [
        ...blocks.filter((block) => !sourceKeys.has(blockPositionKey(block)) && !targetKeys.has(blockPositionKey(block))),
        ...rotatedBlocks,
      ]);
      setCuboidCorners({ a: boundsMinPoint(rotatedBounds), b: boundsMaxPoint(rotatedBounds) });
      setSelectedBlock((current) => {
        if (!current || !sourceKeys.has(blockPositionKey(current))) return null;
        const nextPoint = rotatePointInBounds(current, cuboidBounds, direction);
        return rotatedBlocks.find((block) => blockPositionKey(block) === pointKey(nextPoint)) ?? null;
      });
      setEditNotice(`${sourceBlocks.length.toLocaleString()} block${sourceBlocks.length === 1 ? '' : 's'} rotated ${rotationLabel(direction)}.`);
      return;
    }

    if (!selectedBlock) {
      setEditNotice('Select a block, or switch rotation scope to Selected Area.');
      return;
    }

    const selectedKey = blockPositionKey(selectedBlock);
    updateModelBlocks((blocks) => blocks.map((block) => (
      blockPositionKey(block) === selectedKey ? rotateVoxelBlock(block, block, direction) : block
    )));
    setEditNotice(`${formatBlockName(selectedBlock.name)} rotated ${rotationLabel(direction)}.`);
  };

  const toggleHotbarBlock = (stateKey: string) => {
    setHotbarBlocks((current) => {
      if (current.includes(stateKey)) return current.filter((block) => block !== stateKey);
      return [...current.slice(-(8 - 1)), stateKey];
    });
  };

  const stepCuboidCorner = (corner: CuboidCornerId, axis: 'x' | 'y' | 'z', delta: number) => {
    if (!model) return;
    setCuboidCorners((current) => {
      const point = current[corner];
      if (!point) return current;
      return {
        ...current,
        [corner]: {
          ...point,
          [axis]: clamp(point[axis] + delta, 0, maxCoordinateForAxis(model, axis)),
        },
      };
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (appView !== 'edit' || (event.key !== 'Delete' && event.key !== 'Backspace')) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (
        target?.isContentEditable
        || tagName === 'INPUT'
        || tagName === 'TEXTAREA'
        || tagName === 'SELECT'
      ) {
        return;
      }

      if (deleteSelection()) event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appView, deleteSelection]);

  return (
    <main
      className={`app-shell${showUploadOverlay ? ' is-upload-message-visible' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="drop-overlay" aria-hidden={!showUploadOverlay} aria-live="polite">
        <div>
          <FileUp size={38} />
          <strong>Drop schematic file</strong>
          <span>.litematic, .schem, .schematic, or NBT</span>
        </div>
      </div>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <Cuboid size={22} />
            </div>
            <strong>schematic-editor</strong>
          </div>
          <div className="file-lockup">
            {model ? (
              <div className={`schematic-title${isEditingSchematicName ? ' is-editing' : ''}`}>
                {isEditingSchematicName ? (
                  <input
                    ref={schematicNameInputRef}
                    type="text"
                    value={schematicName}
                    onBlur={commitSchematicName}
                    onChange={(event) => setSchematicName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        setSchematicName(model.name);
                        setIsEditingSchematicName(false);
                      }
                    }}
                    aria-label="Schematic name"
                  />
                ) : (
                  <h1>{schematicName}</h1>
                )}
                <button
                  type="button"
                  className="schematic-title-edit"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setIsEditingSchematicName(true)}
                  title="Edit schematic name"
                  aria-label="Edit schematic name"
                >
                  <Pencil size={14} />
                </button>
              </div>
            ) : (
              <h1>Minecraft schematic viewer</h1>
            )}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-rail" aria-label="Primary controls">
          <div className="rail-cluster rail-mode-switch" role="tablist" aria-label="Schematic mode">
            <button
              type="button"
              role="tab"
              className={appView === 'inspect' ? 'is-active' : ''}
              onClick={() => setAppView('inspect')}
              aria-selected={appView === 'inspect'}
              title="Inspect mode"
            >
              <Eye size={19} />
              <span>View</span>
            </button>
            <button
              type="button"
              role="tab"
              className={appView === 'edit' ? 'is-active' : ''}
              onClick={() => setAppView('edit')}
              aria-selected={appView === 'edit'}
              title="Edit mode"
            >
              <Brush size={19} />
              <span>Edit</span>
            </button>
          </div>

          <div className="rail-divider" />

          <div className="rail-cluster" aria-label={appView === 'edit' ? 'Edit tools' : 'Inspect panels'}>
            {appView === 'edit' ? (
              <>
                <button
                  type="button"
                  className={editTool === 'select' ? 'is-active' : ''}
                  onClick={() => activateEditTool('select')}
                  aria-pressed={editTool === 'select'}
                  title="Select blocks"
                >
                  <MousePointer2 size={19} />
                  <span>Select</span>
                </button>
                <button
                  type="button"
                  className={editTool === 'build' ? 'is-active' : ''}
                  onClick={() => activateEditTool('build')}
                  aria-pressed={editTool === 'build'}
                  title="Build selected block"
                >
                  <Brush size={19} />
                  <span>Build</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={inspectorTab === 'materials' ? 'is-active' : ''}
                  onClick={() => openInspectorPanel('materials')}
                  aria-pressed={inspectorTab === 'materials'}
                  disabled={!model}
                  title="Materials"
                >
                  <Cuboid size={19} />
                  <span>Blocks</span>
                </button>
                <button
                  type="button"
                  className={inspectorTab === 'selection' ? 'is-active' : ''}
                  onClick={() => openInspectorPanel('selection')}
                  aria-pressed={inspectorTab === 'selection'}
                  disabled={!model}
                  title="Area selection"
                >
                  <BoxSelect size={19} />
                  <span>Area</span>
                </button>
                <button
                  type="button"
                  className={inspectorTab === 'layers' ? 'is-active' : ''}
                  onClick={() => openInspectorPanel('layers')}
                  aria-pressed={inspectorTab === 'layers'}
                  disabled={!model}
                  title="Layer view"
                >
                  <Layers size={19} />
                  <span>Layers</span>
                </button>
              </>
            )}
          </div>

          <div className="rail-spacer" />

          <div className="rail-cluster rail-system-controls" aria-label="File and display controls">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              title="Upload schematic"
              aria-label="Upload schematic"
            >
              <Upload size={19} />
              <span>Upload</span>
            </button>
            <button
              type="button"
              onClick={exportRenamedSchematic}
              disabled={!canSaveSchematic}
              title={hasEditChanges ? 'Export edited build as .schem' : 'Export schematic with current name'}
              aria-label={hasEditChanges ? 'Export edited build as .schem' : 'Export schematic with current name'}
            >
              <Download size={19} />
              <span>Export</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              title={isDarkTheme ? 'Use light theme' : 'Use dark theme'}
              aria-label={isDarkTheme ? 'Use light theme' : 'Use dark theme'}
              aria-pressed={isDarkTheme}
            >
              {isDarkTheme ? <Sun size={19} /> : <Moon size={19} />}
              <span>Theme</span>
            </button>
          </div>
          <input
            ref={inputRef}
            className="file-input"
            type="file"
            accept=".litematic,.schem,.schematic,.nbt"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = '';
            }}
          />
        </aside>

        <section className="viewport-panel" aria-label="Schematic 3D viewport">
          {selectedBlock && (
            <section className="selection-inspector-card" aria-label="Selection inspector">
              <div className="selection-inspector-header">
                <div>
                  <p className="eyebrow">Selection Inspector</p>
                  <strong>{selectedBlock.name}</strong>
                </div>
                <button
                  type="button"
                  className="selection-inspector-close"
                  onClick={() => setSelectedBlock(null)}
                  title="Close selection inspector"
                >
                  <X size={15} />
                </button>
              </div>

              <dl className="selection-coordinates">
                <div>
                  <dt>X</dt>
                  <dd>{selectedBlockWorldX}</dd>
                </div>
                <div>
                  <dt>Y</dt>
                  <dd>{selectedBlockWorldY}</dd>
                </div>
                <div>
                  <dt>Z</dt>
                  <dd>{selectedBlockWorldZ}</dd>
                </div>
              </dl>

              {isPlayerHeadBlock(selectedBlock) && playerHeadOptions.length > 0 && (
                <div className="player-head-picker">
                  <label htmlFor="player-head-select">Displayed head</label>
                  <select
                    id="player-head-select"
                    value={selectedPlayerHeadTextureId}
                    onChange={(event) => choosePlayerHeadTexture(event.target.value)}
                  >
                    {playerHeadOptions.map((texture, index) => (
                      <option key={texture.id} value={texture.id}>
                        {playerHeadLabel(texture, index)}
                      </option>
                    ))}
                  </select>
                  <div className="player-head-options" aria-label="Player head texture choices">
                    {playerHeadOptions.map((texture, index) => (
                      <button
                        className={selectedPlayerHeadTextureId === texture.id ? 'is-selected' : ''}
                        key={texture.id}
                        type="button"
                        onClick={() => choosePlayerHeadTexture(texture.id)}
                        title={playerHeadLabel(texture, index)}
                      >
                        <img src={texture.url} alt="" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {model && appView === 'edit' && (
            <div className="edit-hotbar" role="toolbar" aria-label="Favorite build blocks">
              {hotbarBlocks.map((stateKey, index) => {
                const preview = createVoxelBlock(0, 0, 0, stateKey);
                return (
                  <button
                    type="button"
                    key={`${stateKey}-${index}`}
                    className={selectedBuildBlock === stateKey ? 'is-active' : ''}
                    onClick={() => {
                      setSelectedBuildBlock(stateKey);
                      setReplaceToBlock(stateKey);
                    }}
                    title={formatBlockName(stateKey)}
                    aria-label={`Use ${formatBlockName(stateKey)}`}
                    aria-pressed={selectedBuildBlock === stateKey}
                  >
                    <BlockPreview stateKey={stateKey} color={preview.color} />
                    <span>{index + 1}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="viewport-tools" aria-label="Viewport tools">
            <div className="camera-mode-switch" role="group" aria-label="Camera mode">
              <button
                type="button"
                className={cameraMode === 'orbit' ? 'is-active' : ''}
                onClick={() => setCameraMode('orbit')}
                aria-pressed={cameraMode === 'orbit'}
              >
                Orbit
              </button>
              <button
                type="button"
                className={cameraMode === 'spectator' ? 'is-active' : ''}
                onClick={() => setCameraMode('spectator')}
                aria-pressed={cameraMode === 'spectator'}
              >
                Fly
              </button>
            </div>
            <div className="viewport-action-row">
              <button
                type="button"
                onClick={() => viewerRef.current?.resetCamera()}
                title="Reset camera"
                aria-label="Reset camera"
              >
                <Focus size={19} />
              </button>
              <button
                type="button"
                onClick={() => viewerRef.current?.spinOnce()}
                title="Spin 360 degrees"
                aria-label="Spin 360 degrees"
                disabled={cameraMode === 'spectator'}
              >
                <Rotate3D size={19} />
              </button>
              <button
                type="button"
                className={cuboidSelectionMode ? 'is-active' : ''}
                onClick={() => {
                  setCuboidSelectionMode((current) => !current);
                  if (appView === 'inspect') showPanel('selection');
                }}
                title={cuboidSelectionMode ? 'Area selection is active' : 'Select area'}
                aria-pressed={cuboidSelectionMode}
              >
                <BoxSelect size={19} />
              </button>
              <button type="button" onClick={() => showPanel('materials')} title="Materials">
                <Cuboid size={19} />
              </button>
            </div>
          </div>

          {cameraMode === 'spectator' && (
            <>
              <div className="spectator-help" aria-live="polite">
                <span>WASD move · Space up · Shift down · Ctrl faster</span>
                <span>Esc release mouse</span>
              </div>
              <div className="spectator-crosshair" aria-hidden="true" />
            </>
          )}

          <div className="axis-gizmo" aria-hidden="true" ref={axisGizmoRef}>
            <span className="axis-line axis-line-x" />
            <span className="axis-line axis-line-y" />
            <span className="axis-line axis-line-z" />
            <span className="axis-label axis-y">Y</span>
            <span className="axis-label axis-z">Z</span>
            <span className="axis-label axis-x">X</span>
          </div>

          <Viewer3D
            model={model}
            cameraMode={cameraMode}
            spectatorSpeed={spectatorSpeed}
            visibleLayer={visibleLayer}
            singleLayer={singleLayer}
            autoRotate={false}
            showGrid
            theme={theme}
            hiddenMaterialIds={hiddenMaterialIds}
            playerHeadSelections={playerHeadSelections}
            selectedBlock={selectedBlock}
            placementPreviewBlock={appView === 'edit' && selectedBuildBlock !== 'minecraft:air' ? selectedBuildBlockPreview : null}
            cuboidBounds={cuboidBounds}
            cuboidCorners={cuboidCorners}
            onBlockSelect={handleBlockSelect}
            onAxisOrientationChange={updateAxisGizmo}
            viewerRef={viewerRef}
          />
        </section>

      <aside className="control-rail" aria-label="Schematic controls">
        {error && (
          <section className="notice error" role="alert">
            <ScanSearch size={18} />
            <p>{error}</p>
          </section>
        )}

        {model && (
          <>
            {appView === 'inspect' ? (
              <>
            <div className="inspector-tabs" role="tablist" aria-label="Inspector panels">
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'materials'}
                className={inspectorTab === 'materials' ? 'is-active' : ''}
                onClick={() => showPanel('materials')}
              >
                Materials List
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'selection'}
                className={inspectorTab === 'selection' ? 'is-active' : ''}
                onClick={() => showPanel('selection')}
              >
                Selection
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'layers'}
                className={inspectorTab === 'layers' ? 'is-active' : ''}
                onClick={() => showPanel('layers')}
              >
                Layer View
              </button>
            </div>

            <section
              className={`selection-panel inspector-panel${inspectorTab === 'selection' ? ' is-active' : ''}`}
              ref={selectionPanelRef}
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Area Selection</p>
                  <h2>
                    {cuboidBounds
                      ? 'Selected area'
                      : pendingCuboidCorner
                        ? `Pick ${pendingCuboidCorner.corner === 'a' ? 'Corner B' : 'Corner A'}`
                        : 'No area selected'}
                  </h2>
                </div>
                <div className="selection-actions">
                  <button
                    type="button"
                    className={`icon-button${cuboidSelectionMode ? ' is-active' : ''}`}
                    onClick={() => beginCuboidSelection(hasCuboidSelection)}
                    title={hasCuboidSelection ? 'Create new selected area' : 'Create selected area'}
                    aria-label={hasCuboidSelection ? 'Create new selected area' : 'Create selected area'}
                    aria-pressed={cuboidSelectionMode}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={clearCuboidSelection}
                    title="Clear selected area"
                    aria-label="Clear selected area"
                    disabled={!hasCuboidSelection}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {cuboidBounds && cuboidDimensions ? (
                <>
                  <div className="cuboid-corner-editor" aria-label="Selected area corner coordinates">
                    <CuboidCornerControls
                      title="Corner A"
                      corner="a"
                      point={cuboidCorners.a}
                      model={model}
                      onStep={stepCuboidCorner}
                    />
                    <CuboidCornerControls
                      title="Corner B"
                      corner="b"
                      point={cuboidCorners.b}
                      model={model}
                      onStep={stepCuboidCorner}
                    />
                  </div>
                  <dl className="summary-metrics selection-metrics">
                    <div>
                      <dt>Dimensions</dt>
                      <dd>{cuboidDimensions.width} x {cuboidDimensions.height} x {cuboidDimensions.length}</dd>
                    </div>
                    <div>
                      <dt>Selected Blocks</dt>
                      <dd>{cuboidVolume.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Non-air Blocks</dt>
                      <dd>{cuboidMaterials.reduce((sum, material) => sum + material.count, 0).toLocaleString()}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="panel-empty">
                  {pendingCuboidCorner
                    ? `${pendingCuboidCorner.corner === 'a' ? 'Corner A' : 'Corner B'} set at ${model.origin.x + pendingCuboidCorner.point.x}, ${model.origin.y + pendingCuboidCorner.point.y}, ${model.origin.z + pendingCuboidCorner.point.z}.`
                    : cuboidSelectionMode
                      ? 'Left-click Corner A and right-click Corner B in the viewport.'
                      : 'Create a selected area, then left-click Corner A and right-click Corner B in the viewport.'}
                </p>
              )}
            </section>

            <section
              className={`layer-control inspector-panel${inspectorTab === 'layers' ? ' is-active' : ''}`}
              ref={layerPanelRef}
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Layer view</p>
                  <h2>Y {visibleWorldY}</h2>
                </div>
                <div className="stepper">
                  <button type="button" onClick={() => stepLayer(-1)} title="Previous layer">
                    <ChevronLeft size={18} />
                  </button>
                  <button type="button" onClick={() => stepLayer(1)} title="Next layer">
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              <div className="slider-wrap" style={{ '--layer-progress': `${layerPercent}%` } as CSSProperties}>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, model.dimensions.height - 1)}
                  value={visibleLayer}
                  onChange={(event) => setVisibleLayer(Number(event.target.value))}
                  aria-label="Visible layer"
                />
              </div>

              <div className="mode-row">
                <label className="toggle-row">
                  <input type="checkbox" checked={singleLayer} onChange={(event) => setSingleLayer(event.target.checked)} />
                  <span>Only this layer</span>
                </label>
                <span>{currentLayerBlockCount.toLocaleString()} blocks</span>
              </div>
            </section>

            <section
              className={`material-list inspector-panel${inspectorTab === 'materials' ? ' is-active' : ''}`}
              ref={materialPanelRef}
            >
              <div className="section-heading compact">
                <div>
                  <h2>
                    {materialSearch.trim()
                      ? `${filteredMaterials.length.toLocaleString()} of ${activeMaterials.length.toLocaleString()} materials`
                      : `${activeMaterials.length.toLocaleString()} materials`}
                  </h2>
                  <p className="eyebrow">{activeMaterialsLabel}</p>
                </div>
              </div>
              <div className="segmented-control" role="group" aria-label="Materials scope">
                <button
                  type="button"
                  className={materialsScope === 'build' ? 'is-active' : ''}
                  onClick={() => setMaterialsScope('build')}
                >
                  Entire Build
                </button>
                <button
                  type="button"
                  className={materialsScope === 'cuboid' ? 'is-active' : ''}
                  onClick={() => {
                    if (cuboidBounds) {
                      setMaterialsScope('cuboid');
                    } else {
                      beginCuboidSelection();
                    }
                  }}
                >
                  Selected Area
                </button>
              </div>
              <label className="material-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={materialSearch}
                  onChange={(event) => setMaterialSearch(event.target.value)}
                  placeholder="Search materials"
                  aria-label="Search materials"
                />
              </label>
              <div className="material-stack">
                {filteredMaterials.map((material) => {
                  const isExpanded = expandedMaterialIds.has(material.id);
                  const isSelected = material.id === selectedMaterialId;
                  const breakdownId = `material-breakdown-${material.id}`;

                  return (
                    <div
                      className="material-item"
                      key={material.id}
                      ref={(node) => {
                        if (node) {
                          materialItemRefs.current.set(material.id, node);
                        } else {
                          materialItemRefs.current.delete(material.id);
                        }
                      }}
                    >
                      <div className={`material-row${isExpanded ? ' is-expanded' : ''}${isSelected ? ' is-selected' : ''}`}>
                        <button
                          className="material-pick"
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={breakdownId}
                          onClick={() => toggleMaterialBreakdown(material.id)}
                        >
                          <BlockPreview stateKey={material.stateKey} color={material.color} />
                          <span>{material.label}</span>
                          <strong>{material.count.toLocaleString()}</strong>
                          <ChevronDown className="material-disclosure" size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="material-visibility"
                          aria-label={hiddenMaterialIds.has(material.id) ? `Show ${material.label}` : `Hide ${material.label}`}
                          title={hiddenMaterialIds.has(material.id) ? 'Show block' : 'Hide block'}
                          onClick={() => toggleMaterialVisibility(material.id)}
                        >
                          {hiddenMaterialIds.has(material.id) ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {isExpanded && (
                        <div
                          id={breakdownId}
                          className="material-breakdown"
                        >
                          <MaterialBreakdown materialId={material.id} count={material.count} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredMaterials.length === 0 && (
                  <p className="material-empty">
                    {materialsScope === 'cuboid' && !cuboidBounds
                      ? 'Select an area to list materials for that region.'
                      : materialSearch.trim()
                        ? `No materials match "${materialSearch.trim()}".`
                        : 'No non-air blocks in this area.'}
                  </p>
                )}
              </div>
            </section>
              </>
            ) : (
              <section className="edit-panel" aria-label="Edit controls">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Edit View</p>
                    <h2>{formatBlockName(selectedBuildBlock)}</h2>
                  </div>
                  <BlockPreview stateKey={selectedBuildBlock} color={selectedBuildBlockPreview.color} />
                </div>

                <div className="edit-tool-grid" role="group" aria-label="Edit tool">
                  <button
                    type="button"
                    className={editTool === 'select' ? 'is-active' : ''}
                    onClick={() => activateEditTool('select')}
                    aria-pressed={editTool === 'select'}
                  >
                    <MousePointer2 size={17} />
                    Select
                  </button>
                  <button
                    type="button"
                    className={editTool === 'build' ? 'is-active' : ''}
                    onClick={() => activateEditTool('build')}
                    aria-pressed={editTool === 'build'}
                  >
                    <Brush size={17} />
                    Build
                  </button>
                </div>

                {selectedBlock ? (
                  <section className="edit-placement-panel" aria-label="Place adjacent block">
                    <div className="section-heading compact">
                      <div>
                        <h2>Selected Block</h2>
                        <p className="eyebrow">
                          {selectedBlockWorldX}, {selectedBlockWorldY}, {selectedBlockWorldZ}
                        </p>
                      </div>
                    </div>
                    <div className="placement-grid" aria-label="Adjacent placement directions">
                      {(['up', 'down', 'north', 'south', 'west', 'east'] as Direction[]).map((direction) => (
                        <button type="button" key={direction} onClick={() => placeAdjacentBlock(direction)}>
                          {directionLabel(direction)}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : (
                  <p className="panel-empty">Select a block in the viewport, then build with it or place the active block beside it.</p>
                )}

                <section className="edit-transform-panel" aria-label="Rotate blocks">
                  <div className="section-heading compact">
                    <div>
                      <h2>Rotate</h2>
                      <p className="eyebrow">{materialsScope === 'cuboid' && cuboidBounds ? 'Selected area' : 'Selected block'}</p>
                    </div>
                    <RotateCw size={18} />
                  </div>
                  <div className="segmented-control" role="group" aria-label="Rotation scope">
                    <button
                      type="button"
                      className={materialsScope === 'build' ? 'is-active' : ''}
                      onClick={() => setMaterialsScope('build')}
                    >
                      Block
                    </button>
                    <button
                      type="button"
                      className={materialsScope === 'cuboid' ? 'is-active' : ''}
                      onClick={() => {
                        if (cuboidBounds) setMaterialsScope('cuboid');
                        else {
                          beginCuboidSelection(false, false);
                        }
                      }}
                    >
                      Selected Area
                    </button>
                  </div>
                  <div className="rotation-actions">
                    <button
                      type="button"
                      onClick={() => rotateSelection('counterclockwise')}
                      disabled={materialsScope === 'cuboid' ? !cuboidBounds : !selectedBlock}
                    >
                      <RotateCcw size={16} />
                      90 Left
                    </button>
                    <button
                      type="button"
                      onClick={() => rotateSelection('clockwise')}
                      disabled={materialsScope === 'cuboid' ? !cuboidBounds : !selectedBlock}
                    >
                      <RotateCw size={16} />
                      90 Right
                    </button>
                  </div>
                </section>

                <section className="edit-library" aria-label="Block library">
                  <div className="section-heading compact">
                    <div>
                      <h2>Block Library</h2>
                      <p className="eyebrow">{editAvailableBlocks.length.toLocaleString()} blocks</p>
                    </div>
                  </div>
                  <label className="material-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      value={blockSearch}
                      onChange={(event) => setBlockSearch(event.target.value)}
                      placeholder="Find any block"
                      aria-label="Find any block"
                    />
                  </label>
                  <div className="block-library-list">
                    {editAvailableBlocks.slice(0, 180).map((stateKey) => {
                      const preview = createVoxelBlock(0, 0, 0, stateKey);
                      const isHotbar = hotbarBlocks.includes(stateKey);

                      return (
                        <div className={`block-library-row${selectedBuildBlock === stateKey ? ' is-selected' : ''}`} key={stateKey}>
                          <button
                            type="button"
                            className="block-library-pick"
                            onClick={() => {
                              setSelectedBuildBlock(stateKey);
                              setReplaceToBlock(stateKey);
                            }}
                          >
                            <BlockPreview stateKey={stateKey} color={preview.color} />
                            <span>{formatBlockName(stateKey)}</span>
                          </button>
                          <button
                            type="button"
                            className="material-visibility"
                            onClick={() => toggleHotbarBlock(stateKey)}
                            title={isHotbar ? 'Remove from hotbar' : 'Add to hotbar'}
                            aria-label={isHotbar ? `Remove ${formatBlockName(stateKey)} from hotbar` : `Add ${formatBlockName(stateKey)} to hotbar`}
                          >
                            {isHotbar ? <StarOff size={15} /> : <Star size={15} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="replace-panel" aria-label="Find and replace blocks">
                  <div className="section-heading compact">
                    <div>
                      <h2>Find & Replace</h2>
                      <p className="eyebrow">{materialsScope === 'cuboid' && cuboidBounds ? 'Selected area' : 'Entire build'}</p>
                    </div>
                    <Replace size={18} />
                  </div>
                  <div className="replace-grid">
                    <label>
                      <span>Find</span>
                      <select value={replaceFromBlock} onChange={(event) => setReplaceFromBlock(event.target.value)}>
                        <option value="">Choose block</option>
                        {materials.map((material) => (
                          <option key={material.stateKey} value={material.stateKey}>{material.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Replace With</span>
                      <select value={replaceToBlock} onChange={(event) => setReplaceToBlock(event.target.value)}>
                        {editAvailableBlocks.slice(0, 400).map((stateKey) => (
                          <option key={stateKey} value={stateKey}>{formatBlockName(stateKey)}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="segmented-control" role="group" aria-label="Replace scope">
                    <button
                      type="button"
                      className={materialsScope === 'build' ? 'is-active' : ''}
                      onClick={() => setMaterialsScope('build')}
                    >
                      Entire Build
                    </button>
                    <button
                      type="button"
                      className={materialsScope === 'cuboid' ? 'is-active' : ''}
                      onClick={() => {
                        if (cuboidBounds) setMaterialsScope('cuboid');
                        else {
                          beginCuboidSelection(false, false);
                        }
                      }}
                    >
                      Selected Area
                    </button>
                  </div>
                  <button
                    type="button"
                    className="primary-button replace-submit"
                    onClick={replaceBlocks}
                    disabled={!replaceFromBlock || !replaceToBlock}
                  >
                    <Replace size={16} />
                    Replace Blocks
                  </button>
                  {editNotice && <p className="edit-notice">{editNotice}</p>}
                </section>
              </section>
            )}

            {model.warnings.length > 0 && (
              <section className="notice">
                <ScanSearch size={18} />
                <p>{model.warnings[0]}</p>
              </section>
            )}
          </>
        )}
      </aside>
      </div>
    </main>
  );
}

function BlockPreview({ stateKey, color }: { stateKey: string; color: number }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setThumbnailUrl(null);
    void createBlockThumbnail(stateKey, color).then((url) => {
      if (cancelled) return;
      setThumbnailUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [color, stateKey]);

  const fallbackColor = `#${color.toString(16).padStart(6, '0')}`;

  return (
    <span
      className="block-preview"
      data-shape="thumbnail"
      aria-hidden="true"
      style={{
        '--block-fallback': fallbackColor,
        '--block-thumbnail': thumbnailUrl ? `url("${thumbnailUrl}")` : 'none',
      } as CSSProperties}
    >
      {!thumbnailUrl && (
        <>
          <span className="block-preview-face block-preview-top" />
          <span className="block-preview-face block-preview-left" />
          <span className="block-preview-face block-preview-right" />
        </>
      )}
    </span>
  );
}

function CuboidCornerControls({
  title,
  corner,
  point,
  model,
  onStep,
}: {
  title: string;
  corner: CuboidCornerId;
  point: CuboidPoint | null;
  model: SchematicModel;
  onStep: (corner: CuboidCornerId, axis: 'x' | 'y' | 'z', delta: number) => void;
}) {
  return (
    <section className="cuboid-corner-group" aria-label={title}>
      <h3>{title}</h3>
      {(['x', 'y', 'z'] as const).map((axis) => {
        const coordinate = point ? point[axis] : 0;
        const worldCoordinate = originCoordinate(model, axis) + coordinate;
        const minAllowed = 0;
        const maxAllowed = maxCoordinateForAxis(model, axis);

        return (
          <div className="cuboid-axis-stepper" key={`${corner}-${axis}`}>
            <span>{axis.toUpperCase()}</span>
            <strong>{worldCoordinate}</strong>
            <div className="cuboid-axis-buttons">
              <button
                type="button"
                onClick={() => onStep(corner, axis, 1)}
                disabled={coordinate >= maxAllowed}
                title={`Increase ${title} ${axis.toUpperCase()}`}
                aria-label={`Increase ${title} ${axis.toUpperCase()}`}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => onStep(corner, axis, -1)}
                disabled={coordinate <= minAllowed}
                title={`Decrease ${title} ${axis.toUpperCase()}`}
                aria-label={`Decrease ${title} ${axis.toUpperCase()}`}
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function materialIdForBlock(block: VoxelBlock): string {
  return block.stateKey.split('[', 1)[0];
}

function summarizeMaterials(blocks: VoxelBlock[]): MaterialSummary[] {
  const counts = new Map<string, MaterialSummary>();
  for (const block of blocks) {
    const id = materialIdForBlock(block);
    const current = counts.get(id) ?? {
      id,
      label: formatBlockName(id),
      count: 0,
      color: block.color,
      stateKey: block.stateKey,
    };
    current.count += 1;
    counts.set(id, current);
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function blockPositionKey(block: VoxelBlock): string {
  return `${block.x},${block.y},${block.z}`;
}

function emptyCuboidCorners(): CuboidCorners {
  return { a: null, b: null };
}

function pointFromBlock(block: VoxelBlock): CuboidPoint {
  return { x: block.x, y: block.y, z: block.z };
}

function clampPointToModel(point: CuboidPoint, model: SchematicModel): CuboidPoint {
  return {
    x: clamp(point.x, 0, maxCoordinateForAxis(model, 'x')),
    y: clamp(point.y, 0, maxCoordinateForAxis(model, 'y')),
    z: clamp(point.z, 0, maxCoordinateForAxis(model, 'z')),
  };
}

function cuboidCornersKey(corners: CuboidCorners): string {
  return `${corners.a ? pointKey(corners.a) : 'none'}:${corners.b ? pointKey(corners.b) : 'none'}`;
}

function pointKey(point: CuboidPoint): string {
  return `${point.x},${point.y},${point.z}`;
}

function normalizeCuboidBounds(a: CuboidPoint, b: CuboidPoint, model: SchematicModel): CuboidBounds {
  return clampBoundsToModel(
    {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      minZ: Math.min(a.z, b.z),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
      maxZ: Math.max(a.z, b.z),
    },
    model,
  );
}

function clampBoundsToModel(bounds: CuboidBounds, model: SchematicModel): CuboidBounds {
  const maxX = Math.max(0, model.dimensions.width - 1);
  const maxY = Math.max(0, model.dimensions.height - 1);
  const maxZ = Math.max(0, model.dimensions.length - 1);
  const minX = clamp(Math.min(bounds.minX, bounds.maxX), 0, maxX);
  const minY = clamp(Math.min(bounds.minY, bounds.maxY), 0, maxY);
  const minZ = clamp(Math.min(bounds.minZ, bounds.maxZ), 0, maxZ);

  return {
    minX,
    minY,
    minZ,
    maxX: clamp(Math.max(bounds.minX, bounds.maxX), minX, maxX),
    maxY: clamp(Math.max(bounds.minY, bounds.maxY), minY, maxY),
    maxZ: clamp(Math.max(bounds.minZ, bounds.maxZ), minZ, maxZ),
  };
}

function originCoordinate(model: SchematicModel, axis: 'x' | 'y' | 'z'): number {
  if (axis === 'x') return model.origin.x;
  if (axis === 'y') return model.origin.y;
  return model.origin.z;
}

function maxCoordinateForAxis(model: SchematicModel, axis: 'x' | 'y' | 'z'): number {
  if (axis === 'x') return Math.max(0, model.dimensions.width - 1);
  if (axis === 'y') return Math.max(0, model.dimensions.height - 1);
  return Math.max(0, model.dimensions.length - 1);
}

function blockInBounds(block: VoxelBlock, bounds: CuboidBounds): boolean {
  return (
    block.x >= bounds.minX
    && block.x <= bounds.maxX
    && block.y >= bounds.minY
    && block.y <= bounds.maxY
    && block.z >= bounds.minZ
    && block.z <= bounds.maxZ
  );
}

function blockInsideModel(block: VoxelBlock, model: SchematicModel): boolean {
  return pointInsideModel(block, model);
}

function pointInsideModel(point: CuboidPoint, model: SchematicModel): boolean {
  return (
    point.x >= 0
    && point.x < model.dimensions.width
    && point.y >= 0
    && point.y < model.dimensions.height
    && point.z >= 0
    && point.z < model.dimensions.length
  );
}

function boundsInsideModel(bounds: CuboidBounds, model: SchematicModel): boolean {
  return (
    bounds.minX >= 0
    && bounds.maxX < model.dimensions.width
    && bounds.minY >= 0
    && bounds.maxY < model.dimensions.height
    && bounds.minZ >= 0
    && bounds.maxZ < model.dimensions.length
  );
}

function compareBlocks(a: VoxelBlock, b: VoxelBlock): number {
  return a.y - b.y || a.z - b.z || a.x - b.x;
}

function rotatedBoundsForYRotation(bounds: CuboidBounds): CuboidBounds {
  const dimensions = dimensionsForBounds(bounds);
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    minZ: bounds.minZ,
    maxX: bounds.minX + dimensions.length - 1,
    maxY: bounds.maxY,
    maxZ: bounds.minZ + dimensions.width - 1,
  };
}

function boundsMinPoint(bounds: CuboidBounds): CuboidPoint {
  return { x: bounds.minX, y: bounds.minY, z: bounds.minZ };
}

function boundsMaxPoint(bounds: CuboidBounds): CuboidPoint {
  return { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ };
}

function rotatePointInBounds(point: CuboidPoint, bounds: CuboidBounds, direction: RotationDirection): CuboidPoint {
  const localX = point.x - bounds.minX;
  const localZ = point.z - bounds.minZ;
  const dimensions = dimensionsForBounds(bounds);

  if (direction === 'clockwise') {
    return {
      x: bounds.minX + dimensions.length - 1 - localZ,
      y: point.y,
      z: bounds.minZ + localX,
    };
  }

  return {
    x: bounds.minX + localZ,
    y: point.y,
    z: bounds.minZ + dimensions.width - 1 - localX,
  };
}

function rotateVoxelBlock(block: VoxelBlock, point: CuboidPoint, direction: RotationDirection): VoxelBlock {
  const stateKey = rotateBlockStateKeyY(block.stateKey, direction);
  const nextBlock = stateKey === block.stateKey
    ? { ...block }
    : createVoxelBlock(point.x, point.y, point.z, stateKey);

  return {
    ...nextBlock,
    x: point.x,
    y: point.y,
    z: point.z,
    playerHeadTexture: block.playerHeadTexture,
    decoratedPotDecorations: block.decoratedPotDecorations,
  };
}

function rotateBlockStateKeyY(stateKey: string, direction: RotationDirection): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  const nextProperties = { ...parsed.properties };
  rotateHorizontalPropertyNames(nextProperties, direction);

  if (isHorizontalDirection(nextProperties.facing)) {
    nextProperties.facing = rotateHorizontalDirection(nextProperties.facing, direction);
  }
  if (isHorizontalDirection(nextProperties.horizontal_facing)) {
    nextProperties.horizontal_facing = rotateHorizontalDirection(nextProperties.horizontal_facing, direction);
  }
  if (isHorizontalDirection(nextProperties.rotation)) {
    nextProperties.rotation = rotateHorizontalDirection(nextProperties.rotation, direction);
  } else if (nextProperties.rotation && /^\d+$/.test(nextProperties.rotation)) {
    const quarterTurn = direction === 'clockwise' ? 4 : -4;
    nextProperties.rotation = String((Number(nextProperties.rotation) + quarterTurn + 16) % 16);
  }
  if (nextProperties.axis === 'x') {
    nextProperties.axis = 'z';
  } else if (nextProperties.axis === 'z') {
    nextProperties.axis = 'x';
  }
  if (nextProperties.shape) {
    nextProperties.shape = rotateDirectionalStateValue(nextProperties.shape, direction);
  }

  return formatStateKey(parsed.id, nextProperties, parsed.order);
}

function keysForBounds(bounds: CuboidBounds): Set<string> {
  const keys = new Set<string>();
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
        keys.add(pointKey({ x, y, z }));
      }
    }
  }
  return keys;
}

function pointFromKey(key: string): CuboidPoint {
  const [x, y, z] = key.split(',').map(Number);
  return { x, y, z };
}

function parseStateKey(stateKey: string): { id: string; properties: Record<string, string>; order: string[] } | null {
  const match = /^(?<id>[^\[]+)(?:\[(?<properties>.*)\])?$/.exec(stateKey);
  if (!match?.groups) return null;
  const rawProperties = match.groups.properties;
  if (!rawProperties) return { id: match.groups.id, properties: {}, order: [] };

  const properties: Record<string, string> = {};
  const order: string[] = [];
  for (const pair of rawProperties.split(',')) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined) continue;
    properties[key] = value;
    order.push(key);
  }

  return { id: match.groups.id, properties, order };
}

function formatStateKey(id: string, properties: Record<string, string>, order: string[]): string {
  const propertyKeys = [
    ...order.filter((key) => properties[key] !== undefined),
    ...Object.keys(properties).filter((key) => !order.includes(key)).sort(),
  ];
  if (propertyKeys.length === 0) return id;
  return `${id}[${propertyKeys.map((key) => `${key}=${properties[key]}`).join(',')}]`;
}

function isHorizontalDirection(value: string | undefined): value is 'north' | 'east' | 'south' | 'west' {
  return value === 'north' || value === 'east' || value === 'south' || value === 'west';
}

function rotateHorizontalPropertyNames(properties: Record<string, string>, direction: RotationDirection) {
  const horizontalKeys = ['north', 'east', 'south', 'west'] as const;
  const rotatedEntries: Partial<Record<'north' | 'east' | 'south' | 'west', string>> = {};

  for (const key of horizontalKeys) {
    if (properties[key] === undefined) continue;
    rotatedEntries[rotateHorizontalDirection(key, direction)] = properties[key];
  }

  for (const key of horizontalKeys) {
    if (properties[key] !== undefined) delete properties[key];
  }
  for (const key of horizontalKeys) {
    if (rotatedEntries[key] !== undefined) properties[key] = rotatedEntries[key];
  }
}

function rotateDirectionalStateValue(value: string, direction: RotationDirection): string {
  return value
    .split('_')
    .map((part) => (isHorizontalDirection(part) ? rotateHorizontalDirection(part, direction) : part))
    .join('_');
}

function rotateHorizontalDirection(
  direction: 'north' | 'east' | 'south' | 'west',
  rotationDirection: RotationDirection,
): 'north' | 'east' | 'south' | 'west' {
  const directions = ['north', 'east', 'south', 'west'] as const;
  const currentIndex = directions.indexOf(direction);
  const delta = rotationDirection === 'clockwise' ? 1 : -1;
  return directions[(currentIndex + delta + directions.length) % directions.length];
}

function rotationLabel(direction: RotationDirection): string {
  return direction === 'clockwise' ? 'right 90 degrees' : 'left 90 degrees';
}

function directionOffset(direction: Direction): CuboidPoint {
  switch (direction) {
    case 'up':
      return { x: 0, y: 1, z: 0 };
    case 'down':
      return { x: 0, y: -1, z: 0 };
    case 'north':
      return { x: 0, y: 0, z: -1 };
    case 'south':
      return { x: 0, y: 0, z: 1 };
    case 'west':
      return { x: -1, y: 0, z: 0 };
    case 'east':
      return { x: 1, y: 0, z: 0 };
  }
}

function directionLabel(direction: Direction): string {
  switch (direction) {
    case 'up':
      return '+Y';
    case 'down':
      return '-Y';
    case 'north':
      return '-Z';
    case 'south':
      return '+Z';
    case 'west':
      return '-X';
    case 'east':
      return '+X';
  }
}

function dimensionsForBounds(bounds: CuboidBounds) {
  return {
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
    length: bounds.maxZ - bounds.minZ + 1,
  };
}

function boundsKey(bounds: CuboidBounds): string {
  return `${bounds.minX},${bounds.minY},${bounds.minZ}:${bounds.maxX},${bounds.maxY},${bounds.maxZ}`;
}

function isPlayerHeadBlock(block: VoxelBlock): boolean {
  return block.name === 'minecraft:player_head' || block.name === 'minecraft:player_wall_head';
}

function uniquePlayerHeadTextures(model: SchematicModel | null): PlayerHeadTexture[] {
  if (!model) return [];

  const textures = new Map<string, PlayerHeadTexture>();
  for (const block of model.blocks) {
    if (block.playerHeadTexture) {
      textures.set(block.playerHeadTexture.id, block.playerHeadTexture);
    }
  }

  return Array.from(textures.values());
}

function playerHeadLabel(texture: PlayerHeadTexture, index: number): string {
  return `Head ${index + 1} (${texture.id.slice(0, 8)})`;
}

function formatBlockName(id: string): string {
  return id
    .replace(/^minecraft:/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function MaterialBreakdown({ materialId, count }: { materialId: string; count: number }) {
  const breakdown = storageBreakdown(materialId, count);
  const label = `${count.toLocaleString()} blocks: ${breakdown.stacks.toLocaleString()} stacks of ${breakdown.stackSize.toLocaleString()} plus ${breakdown.remainder.toLocaleString()} items, ${breakdown.shulkerBoxes} shulker boxes`;

  return (
    <span className="material-breakdown-count" aria-label={label}>
      <span className="material-breakdown-part">
        <span className="material-breakdown-icon" data-tooltip="Stacks">
          <Layers size={17} strokeWidth={2.6} aria-hidden="true" />
        </span>
        <strong>{breakdown.stacks.toLocaleString()}</strong>
      </span>
      <span className="material-breakdown-plus" aria-hidden="true">+</span>
      <strong>{breakdown.remainder.toLocaleString()}</strong>
      <span className="material-breakdown-separator" aria-hidden="true" />
      <span className="material-breakdown-part">
        <span className="material-breakdown-icon" data-tooltip="Shulker Boxes">
          <ShulkerIcon />
        </span>
        <strong>{breakdown.shulkerBoxes}</strong>
      </span>
    </span>
  );
}

function ShulkerIcon() {
  return (
    <svg className="shulker-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 21 8v9.1l-9 5.1-9-5.1V8l9-5.2Z" />
      <path d="M3.6 8.3 12 13.1l8.4-4.8" />
      <path d="M12 13.1v8.3" />
      <path d="m3.2 12.4 4.2 2.4v1.5" />
      <path d="m7.4 14.8 4.6 2.6 4.6-2.6" />
      <path d="M12 17.4v1.7" />
      <path d="m16.6 14.8 4.2-2.4" />
      <path d="M16.6 14.8v1.5" />
    </svg>
  );
}

function storageBreakdown(materialId: string, count: number): {
  stackSize: number;
  stacks: number;
  remainder: number;
  shulkerBoxes: string;
} {
  const stackSize = itemStackSize(materialId);
  const stacks = Math.floor(count / stackSize);
  const remainder = count % stackSize;
  const shulkerBoxes = count / (stackSize * 27);

  return {
    stackSize,
    stacks,
    remainder,
    shulkerBoxes: formatShulkerBoxes(shulkerBoxes),
  };
}

function formatShulkerBoxes(value: number): string {
  if (value > 0 && value < 0.01) return '<0.01';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: value < 10 ? 2 : 0,
  });
}

function itemStackSize(materialId: string): number {
  const id = materialId.replace(/^minecraft:/, '');
  if (id.endsWith('_bed') || id.endsWith('shulker_box') || id === 'cake') return 1;
  if (id.endsWith('_sign') || id.endsWith('_wall_sign') || id.endsWith('_hanging_sign') || id.endsWith('_wall_hanging_sign')) return 16;
  if (id.endsWith('_banner') || id.endsWith('_wall_banner')) return 16;
  return 64;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getDraggedFileKind(dataTransfer: DataTransfer): DraggedFileKind {
  if (!hasFileTransfer(dataTransfer)) return 'none';

  let hasFileItem = false;
  let hasNamedFile = false;

  for (let index = 0; index < dataTransfer.items.length; index += 1) {
    const item = dataTransfer.items[index];
    if (item.kind !== 'file') continue;

    hasFileItem = true;
    const file = item.getAsFile();
    if (!file?.name) continue;

    hasNamedFile = true;
    if (isSchematicFileName(file.name)) {
      return 'schematic-file';
    }
  }

  if (hasNamedFile) return 'unsupported-file';
  return 'unknown-file';
}

function hasFileTransfer(dataTransfer: DataTransfer) {
  for (let index = 0; index < dataTransfer.types.length; index += 1) {
    if (dataTransfer.types[index] === 'Files') return true;
  }

  return false;
}

function isSchematicFileName(fileName: string) {
  return schematicFileExtensions.has(fileExtension(fileName).toLowerCase());
}

function fileExtension(fileName: string): string {
  const match = /\.[a-z0-9]+$/i.exec(fileName);
  return match ? match[0] : '.schem';
}

function safeFileBaseName(name: string): string {
  const safeName = name
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();

  return safeName || 'renamed-schematic';
}

export default App;
