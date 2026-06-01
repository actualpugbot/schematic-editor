import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BoxSelect,
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Cuboid,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Focus,
  Grid2X2,
  Hammer,
  ImageIcon,
  Layers,
  List,
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
  SlidersHorizontal,
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
  type TextureAdjustmentMap,
  type TextureFaceHit,
  type Viewer3DHandle,
  textureAdjustmentKey,
} from './components/Viewer3D';
import { ShoppingCelebration } from './components/ShoppingCelebration';
import {
  createBlockThumbnail,
  getCachedBlockThumbnail,
  preloadBlockThumbnails,
  type BlockThumbnailLayer,
} from './lib/blockThumbnails';
import { textureUrl, type ModelFaceName } from './lib/minecraftModels';
import { writeNbt, type NbtDocument } from './lib/nbt';
import {
  defaultRecipeTypePreference,
  explodeMaterials,
  normalizeRecipeItemId,
  recipeTypeLabel,
  type BreakdownNode,
} from './lib/recipes';
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
import creativeInventoryData from './lib/data/creative_inventory.json';
import defaultSchematicUrl from '../mossy_roof_house.litematic?url';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type DraggedFileKind = 'none' | 'unsupported-file' | 'unknown-file' | 'schematic-file';
type InspectorTab = 'selection' | 'materials' | 'layers';
type EditPanelTab = 'tools' | 'rotate' | 'replace';
type AppView = 'inspect' | 'edit' | 'texture' | 'shopping' | 'resource';
type EditTool = 'select' | 'build';
type Theme = 'light' | 'dark';
type MaterialsScope = 'build' | 'cuboid';
type MaterialsMode = 'placed' | 'raw';
type ShoppingLayout = 'grid' | 'list';
type ThumbnailLoadState = 'idle' | 'loading' | 'ready' | 'failed';
type CuboidCornerId = 'a' | 'b';
type Direction = 'up' | 'down' | 'north' | 'south' | 'west' | 'east';
type RotationDirection = 'clockwise' | 'counterclockwise';

interface TextureSelection {
  stateKey: string;
  blockId: string;
  partKey: string;
  face: ModelFaceName;
  textureId: string | null;
}

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
  thumbnailLayers?: BlockThumbnailLayer[];
}

interface ShoppingMaterialGroup {
  id: string;
  label: string;
  materials: MaterialSummary[];
}

interface ResourceCalculatorStats {
  totalOutputItems: number;
  uniqueOutputItems: number;
  rawMaterialItems: number;
  uniqueRawMaterials: number;
  craftingSteps: number;
  chestsNeeded: number;
  unresolvedItems: number;
}

interface ResourceGraphGroup {
  id: string;
  label: string;
  tone: string;
  paths: BreakdownNode[][];
  maxColumns: number;
}

interface BlockLibraryItem {
  stateKey: string;
  label: string;
  color: number;
  category: CreativeCategoryId;
  colorGroup: ColorGroupId;
}

interface BlockLibraryGroup {
  id: string;
  label: string;
  items: BlockLibraryItem[];
}

type CreativeCategoryId =
  | 'building_blocks'
  | 'colored_blocks'
  | 'natural_blocks'
  | 'functional_blocks'
  | 'redstone_blocks'
  | 'tools_and_utilities';

type ColorGroupId =
  | 'white'
  | 'gray'
  | 'black'
  | 'brown'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'pink';

const schematicFileExtensions = new Set(['.litematic', '.schem', '.schematic', '.nbt']);
const defaultSchematicFileName = 'mossy_roof_house.litematic';
const defaultSchematicDisplayName = 'Mossy Roof House';
const defaultBuildTutorialUrl = 'https://www.youtube.com/watch?v=KO1yKa34Yl0';
const themeStorageKey = 'schematic-editor-theme';
const shoppingListStoragePrefix = 'schematic-editor-shopping-list';
const emptyBuildBlock = 'minecraft:air';
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
const creativeCategoryOrder: Array<{ id: CreativeCategoryId; label: string }> = [
  { id: 'building_blocks', label: creativeInventoryTabLabel('building_blocks') },
  { id: 'colored_blocks', label: creativeInventoryTabLabel('colored_blocks') },
  { id: 'natural_blocks', label: creativeInventoryTabLabel('natural_blocks') },
  { id: 'functional_blocks', label: creativeInventoryTabLabel('functional_blocks') },
  { id: 'redstone_blocks', label: creativeInventoryTabLabel('redstone_blocks') },
  { id: 'tools_and_utilities', label: creativeInventoryTabLabel('tools_and_utilities') },
];
const colorGroupOrder: Array<{ id: ColorGroupId; label: string }> = [
  { id: 'white', label: 'White & Light' },
  { id: 'gray', label: 'Gray' },
  { id: 'black', label: 'Black' },
  { id: 'brown', label: 'Brown' },
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'cyan', label: 'Cyan' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
];
const woodTypeOrder = [
  'oak',
  'spruce',
  'birch',
  'jungle',
  'acacia',
  'dark_oak',
  'mangrove',
  'cherry',
  'pale_oak',
  'bamboo',
  'crimson',
  'warped',
];
const dyeColorOrder = [
  'white',
  'light_gray',
  'gray',
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'light_blue',
  'blue',
  'purple',
  'magenta',
  'pink',
];
const creativeBuildingOrder = [
  'stone',
  'granite',
  'polished_granite',
  'diorite',
  'polished_diorite',
  'andesite',
  'polished_andesite',
  'deepslate',
  'cobbled_deepslate',
  'polished_deepslate',
  'calcite',
  'tuff',
  'dripstone_block',
  'sandstone',
  'red_sandstone',
  'cobblestone',
  'mossy_cobblestone',
  'stone_bricks',
  'mossy_stone_bricks',
  'bricks',
  'mud_bricks',
  'packed_mud',
  'prismarine',
  'dark_prismarine',
  'netherrack',
  'basalt',
  'blackstone',
  'end_stone',
  'purpur_block',
  'quartz_block',
];
const creativeNaturalOrder = [
  'grass_block',
  'dirt',
  'sand',
  'red_sand',
  'gravel',
  'clay',
  'mud',
  'snow',
  'ice',
  'packed_ice',
  'blue_ice',
  'netherrack',
  'soul_sand',
  'soul_soil',
  'end_stone',
  'obsidian',
  'coal_ore',
  'iron_ore',
  'copper_ore',
  'gold_ore',
  'redstone_ore',
  'emerald_ore',
  'lapis_ore',
  'diamond_ore',
  'nether_gold_ore',
  'nether_quartz_ore',
  'oak_log',
  'spruce_log',
  'birch_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'cherry_log',
  'pale_oak_log',
  'bamboo_block',
  'oak_leaves',
  'spruce_leaves',
  'birch_leaves',
  'jungle_leaves',
  'acacia_leaves',
  'dark_oak_leaves',
  'mangrove_leaves',
  'cherry_leaves',
  'pale_oak_leaves',
];
const creativeFunctionalOrder = [
  'torch',
  'soul_torch',
  'lantern',
  'soul_lantern',
  'crafting_table',
  'furnace',
  'blast_furnace',
  'smoker',
  'campfire',
  'chest',
  'barrel',
  'ender_chest',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
  'enchanting_table',
  'brewing_stand',
  'cauldron',
  'composter',
  'beacon',
  'lodestone',
  'scaffolding',
  'ladder',
];
const creativeRedstoneOrder = [
  'redstone',
  'redstone_torch',
  'redstone_block',
  'repeater',
  'comparator',
  'lever',
  'stone_button',
  'oak_button',
  'stone_pressure_plate',
  'piston',
  'sticky_piston',
  'observer',
  'dispenser',
  'dropper',
  'hopper',
  'target',
  'rail',
  'powered_rail',
  'detector_rail',
  'activator_rail',
  'tnt',
];
const creativeUtilityOrder = [
  'air',
  'water',
  'lava',
  'light',
  'barrier',
  'structure_void',
  'spawner',
  'trial_spawner',
  'vault',
  'command_block',
  'chain_command_block',
  'repeating_command_block',
  'structure_block',
  'jigsaw',
];
const creativeInventoryKeywordOrder = createCreativeInventoryKeywordOrder();
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
  const [materialsMode, setMaterialsMode] = useState<MaterialsMode>('placed');
  const [integerCrafting, setIntegerCrafting] = useState(true);
  const [shoppingSearch, setShoppingSearch] = useState('');
  const [shoppingLayout, setShoppingLayout] = useState<ShoppingLayout>('grid');
  const [checkedShoppingItems, setCheckedShoppingItems] = useState<Set<string>>(() => new Set());
  const [playerHeadSelections, setPlayerHeadSelections] = useState<Record<string, string>>({});
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('materials');
  const [editPanelTab, setEditPanelTab] = useState<EditPanelTab>('tools');
  const [cuboidSelectionMode, setCuboidSelectionMode] = useState(false);
  const [cuboidCorners, setCuboidCorners] = useState<CuboidCorners>(() => emptyCuboidCorners());
  const [materialsScope, setMaterialsScope] = useState<MaterialsScope>('build');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [editTool, setEditTool] = useState<EditTool>('select');
  const [selectedBuildBlock, setSelectedBuildBlock] = useState(emptyBuildBlock);
  const [recentBuildBlocks, setRecentBuildBlocks] = useState<string[]>([]);
  const [blockSearch, setBlockSearch] = useState('');
  const [textureBlockSearch, setTextureBlockSearch] = useState('');
  const [selectedTextureBlock, setSelectedTextureBlock] = useState('minecraft:oak_planks');
  const [selectedTextureFace, setSelectedTextureFace] = useState<TextureSelection | null>(null);
  const [textureAdjustments, setTextureAdjustments] = useState<TextureAdjustmentMap>({});
  const [textureExportText, setTextureExportText] = useState('');
  const [replaceFromBlock, setReplaceFromBlock] = useState('');
  const [replaceToBlock, setReplaceToBlock] = useState(emptyBuildBlock);
  const [editNotice, setEditNotice] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<Viewer3DHandle | null>(null);
  const defaultTextureViewerRef = useRef<Viewer3DHandle | null>(null);
  const axisGizmoRef = useRef<HTMLDivElement | null>(null);
  const rotationControlsRef = useRef<HTMLDivElement | null>(null);
  const materialItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const selectionPanelRef = useRef<HTMLElement | null>(null);
  const materialPanelRef = useRef<HTMLElement | null>(null);
  const layerPanelRef = useRef<HTMLElement | null>(null);
  const schematicNameInputRef = useRef<HTMLInputElement | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const skipNextShoppingPersistRef = useRef(false);
  const prevShoppingProgressRef = useRef(0);
  const prevShoppingStorageRef = useRef('');
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
  const recipeBreakdown = useMemo(() => explodeMaterials(activeMaterials, {
    rawOverrides: new Set(),
    recipeChoice: new Map(),
    recipeTypePreference: defaultRecipeTypePreference,
    integerCrafting,
  }), [activeMaterials, integerCrafting]);
  const rawMaterials = useMemo<MaterialSummary[]>(() => (
    recipeBreakdown.raw.map((material) => materialSummaryForRecipeItem(material, activeMaterials))
  ), [activeMaterials, recipeBreakdown]);
  const recipeTreeByMaterialId = useMemo(() => (
    new Map(recipeBreakdown.trees.map((tree) => [tree.id, tree]))
  ), [recipeBreakdown]);
  const visibleMaterials = materialsMode === 'raw' ? rawMaterials : activeMaterials;
  const visibleMaterialsLabel = materialsMode === 'raw' ? 'Raw Materials' : activeMaterialsLabel;
  const shoppingScope = useMemo(() => (
    model ? shoppingScopeKey(model, materialsScope, cuboidBounds) : 'none'
  ), [cuboidBoundsKey, materialsScope, model]);
  const shoppingModeScope = `${shoppingScope}:${materialsMode}:${integerCrafting ? 'integer' : 'fractional'}`;
  const shoppingStorage = useMemo(() => (
    model ? shoppingStorageKey(model, shoppingModeScope, visibleMaterials) : ''
  ), [model, shoppingModeScope, visibleMaterials]);
  const shoppingItemKeys = useMemo(() => (
    new Set(visibleMaterials.map((material) => shoppingItemKey(shoppingModeScope, material)))
  ), [shoppingModeScope, visibleMaterials]);
  const shoppingMaterials = useMemo(() => {
    const query = shoppingSearch.trim().toLocaleLowerCase();
    if (!query) return visibleMaterials;

    return visibleMaterials.filter((material) => {
      const label = material.label.toLocaleLowerCase();
      const id = material.id.toLocaleLowerCase();
      return label.includes(query) || id.includes(query);
    });
  }, [shoppingSearch, visibleMaterials]);
  const shoppingGroups = useMemo(() => groupShoppingMaterials(shoppingMaterials), [shoppingMaterials]);
  const filteredRecipeTrees = useMemo(() => {
    const query = shoppingSearch.trim().toLocaleLowerCase();
    if (!query) return recipeBreakdown.trees;

    return recipeBreakdown.trees.filter((tree) => resourceTreeMatchesSearch(tree, query));
  }, [recipeBreakdown.trees, shoppingSearch]);
  const resourceStats = useMemo<ResourceCalculatorStats>(() => ({
    totalOutputItems: activeMaterials.reduce((sum, material) => sum + material.count, 0),
    uniqueOutputItems: activeMaterials.length,
    rawMaterialItems: rawMaterials.reduce((sum, material) => sum + material.count, 0),
    uniqueRawMaterials: rawMaterials.length,
    craftingSteps: countCraftingSteps(recipeBreakdown.trees),
    chestsNeeded: estimateChestCount(rawMaterials),
    unresolvedItems: recipeBreakdown.unresolved.length,
  }), [activeMaterials, rawMaterials, recipeBreakdown]);
  const checkedShoppingMaterialCount = useMemo(() => (
    visibleMaterials.filter((material) => checkedShoppingItems.has(shoppingItemKey(shoppingModeScope, material))).length
  ), [checkedShoppingItems, shoppingModeScope, visibleMaterials]);
  const totalShoppingItems = useMemo(() => (
    visibleMaterials.reduce((sum, material) => sum + material.count, 0)
  ), [visibleMaterials]);
  const completedShoppingItems = useMemo(() => (
    visibleMaterials.reduce((sum, material) => (
      checkedShoppingItems.has(shoppingItemKey(shoppingModeScope, material)) ? sum + material.count : sum
    ), 0)
  ), [checkedShoppingItems, shoppingModeScope, visibleMaterials]);
  const remainingShoppingItems = Math.max(0, totalShoppingItems - completedShoppingItems);
  const shoppingProgressPercent = totalShoppingItems > 0
    ? Math.round((completedShoppingItems / totalShoppingItems) * 100)
    : 0;
  const filteredMaterials = useMemo(() => {
    const query = materialSearch.trim().toLocaleLowerCase();
    if (!query) return visibleMaterials;

    return visibleMaterials.filter((material) => {
      const label = material.label.toLocaleLowerCase();
      const id = material.id.toLocaleLowerCase();
      return label.includes(query) || id.includes(query);
    });
  }, [materialSearch, visibleMaterials]);
  const hideableMaterialIds = useMemo(() => (
    materialsMode === 'placed' ? visibleMaterials.map((material) => material.id) : []
  ), [materialsMode, visibleMaterials]);
  const allVisibleMaterialsHidden = hideableMaterialIds.length > 0
    && hideableMaterialIds.every((materialId) => hiddenMaterialIds.has(materialId));
  const bulkMaterialVisibilityLabel = allVisibleMaterialsHidden ? 'Show All' : 'Hide All';

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
  const allBuildBlocks = useMemo(() => {
    const fromAssets = Object.keys(blockstateFiles)
      .map((path) => {
        const fileName = path.split('/').at(-1) ?? '';
        return fileName.endsWith('.json') ? `minecraft:${fileName.slice(0, -5)}` : '';
      })
      .filter(Boolean);
    const fromModel = model?.blocks.map((block) => materialIdForBlock(block)) ?? [];
    const allBlocks = new Set([...commonBuildBlocks, ...fromModel, ...fromAssets]);

    return Array.from(allBlocks).sort(compareBlockLibraryItems);
  }, [model]);

  const blockLibraryItems = useMemo<BlockLibraryItem[]>(() => (
    allBuildBlocks.map((stateKey) => {
      const preview = createVoxelBlock(0, 0, 0, stateKey);
      return {
        stateKey,
        label: formatBlockName(stateKey),
        color: preview.color,
        category: creativeCategoryForBlock(stateKey),
        colorGroup: colorGroupForColor(preview.color),
      };
    })
  ), [allBuildBlocks]);

  const filteredBlockLibraryItems = useMemo(() => {
    const query = blockSearch.trim().toLocaleLowerCase();

    return blockLibraryItems.filter((item) => {
        if (!query) return true;
        return item.stateKey.toLocaleLowerCase().includes(query) || item.label.toLocaleLowerCase().includes(query);
      });
  }, [blockLibraryItems, blockSearch]);

  const blockLibraryGroups = useMemo<BlockLibraryGroup[]>(() => (
    groupBlocksByCreativeCategory(filteredBlockLibraryItems)
  ), [filteredBlockLibraryItems]);

  const visibleBlockLibraryCount = filteredBlockLibraryItems.length;
  const textureLibraryItems = useMemo(() => {
    const query = textureBlockSearch.trim().toLocaleLowerCase();
    return blockLibraryItems.filter((item) => {
      if (!query) return true;
      return item.stateKey.toLocaleLowerCase().includes(query) || item.label.toLocaleLowerCase().includes(query);
    });
  }, [blockLibraryItems, textureBlockSearch]);
  const texturePreviewModel = useMemo<SchematicModel>(() => createTexturePreviewModel(selectedTextureBlock), [selectedTextureBlock]);
  const displayedModel = appView === 'texture' ? texturePreviewModel : model;
  const displayedHiddenMaterialIds = useMemo(() => new Set<string>(), []);
  const selectedTextureAdjustmentKey = selectedTextureFace
    ? textureAdjustmentKey(
      selectedTextureFace.blockId,
      selectedTextureFace.face,
      selectedTextureFace.textureId,
      selectedTextureFace.partKey,
    )
    : '';
  const selectedTextureAdjustment = selectedTextureAdjustmentKey
    ? textureAdjustments[selectedTextureAdjustmentKey] ?? { offsetU: 0, offsetV: 0, rotation: 0 }
    : { offsetU: 0, offsetV: 0, rotation: 0 };
  const exportedTextureAdjustmentCount = Object.keys(textureAdjustments).length;
  const rotateTargetLabel = materialsScope === 'cuboid' && cuboidBounds ? 'Selected Area' : selectedBlock ? 'Selected Block' : '';

  useEffect(() => {
    if (loadState !== 'ready') return;

    const controller = new AbortController();
    const previewQueue = [
      { stateKey: selectedBuildBlock, color: selectedBuildBlockPreview.color },
      ...recentBuildBlocks.map((stateKey) => {
        const preview = createVoxelBlock(0, 0, 0, stateKey);
        return { stateKey, color: preview.color };
      }),
      ...materials.slice(0, 64).map((material) => ({
        stateKey: material.stateKey,
        color: material.color,
        layers: material.thumbnailLayers,
      })),
      ...blockLibraryItems
        .filter((item) => item.category === 'building_blocks')
        .slice(0, 180),
      ...blockLibraryItems.slice(0, 120),
    ];

    preloadBlockThumbnails(previewQueue, { batchSize: 12, signal: controller.signal });

    return () => controller.abort();
  }, [blockLibraryItems, loadState, materials, recentBuildBlocks, selectedBuildBlock, selectedBuildBlockPreview.color]);

  useEffect(() => {
    if (loadState !== 'ready' || appView !== 'edit') return;

    const controller = new AbortController();
    preloadBlockThumbnails(filteredBlockLibraryItems.slice(0, 420), {
      batchSize: 24,
      priority: 'interactive',
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [appView, filteredBlockLibraryItems, loadState]);

  useEffect(() => {
    if (materialsScope === 'cuboid' && !cuboidBounds) {
      setMaterialsScope('build');
    }
  }, [cuboidBounds, materialsScope]);

  useEffect(() => {
    if (!shoppingStorage) {
      setCheckedShoppingItems(new Set());
      return;
    }

    const rawItems = window.localStorage.getItem(shoppingStorage);
    const storedItems = rawItems ? parseShoppingStorage(rawItems) : [];
    const nextItems = storedItems.filter((item) => shoppingItemKeys.has(item));
    skipNextShoppingPersistRef.current = true;
    setCheckedShoppingItems(new Set(nextItems));
  }, [shoppingItemKeys, shoppingStorage]);

  useEffect(() => {
    if (!shoppingStorage) return;
    if (skipNextShoppingPersistRef.current) {
      skipNextShoppingPersistRef.current = false;
      return;
    }

    const nextItems = Array.from(checkedShoppingItems).filter((item) => shoppingItemKeys.has(item));
    window.localStorage.setItem(shoppingStorage, JSON.stringify(nextItems));
  }, [checkedShoppingItems, shoppingItemKeys, shoppingStorage]);

  useEffect(() => {
    if (prevShoppingStorageRef.current !== shoppingStorage) {
      prevShoppingStorageRef.current = shoppingStorage;
      prevShoppingProgressRef.current = shoppingProgressPercent;
      setShowCelebration(false);
      return;
    }
    if (shoppingProgressPercent === 100 && totalShoppingItems > 0 && prevShoppingProgressRef.current < 100) {
      setShowCelebration(true);
    }
    prevShoppingProgressRef.current = shoppingProgressPercent;
  }, [shoppingProgressPercent, totalShoppingItems, shoppingStorage]);

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
        applySchematic({ ...parsed.model, name: defaultSchematicDisplayName }, parsed.nbt, fileExtension(defaultSchematicFileName));
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
    setSelectedBuildBlock(emptyBuildBlock);
    setRecentBuildBlocks([]);
    setBlockSearch('');
    setReplaceFromBlock(nextModel.blocks[0]?.stateKey ?? '');
    setReplaceToBlock(emptyBuildBlock);
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

  const toggleAllMaterialVisibility = () => {
    if (hideableMaterialIds.length === 0) return;

    setHiddenMaterialIds((current) => {
      const next = new Set(current);
      const shouldShowAll = hideableMaterialIds.every((materialId) => next.has(materialId));
      for (const materialId of hideableMaterialIds) {
        if (shouldShowAll) {
          next.delete(materialId);
        } else {
          next.add(materialId);
        }
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
    setEditPanelTab('tools');
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

  const chooseBuildBlock = (stateKey: string) => {
    setSelectedBuildBlock(stateKey);
    setReplaceToBlock(stateKey);
    if (stateKey === emptyBuildBlock) return;
    setRecentBuildBlocks((current) => [stateKey, ...current.filter((block) => block !== stateKey)]);
  };

  const chooseTextureBlock = (stateKey: string) => {
    setSelectedTextureBlock(stateKey);
    setSelectedTextureFace(null);
    setTextureExportText('');
    setCameraMode('orbit');
    setAppView('texture');
  };

  const handleTextureFaceSelect = (hit: TextureFaceHit) => {
    setSelectedTextureFace({
      stateKey: selectedTextureBlock,
      blockId: hit.block.name,
      partKey: hit.partKey,
      face: hit.face,
      textureId: hit.textureId,
    });
  };

  const updateSelectedTextureAdjustment = (updates: Partial<{ offsetU: number; offsetV: number; rotation: number }>) => {
    if (!selectedTextureFace) return;
    const key = textureAdjustmentKey(
      selectedTextureFace.blockId,
      selectedTextureFace.face,
      selectedTextureFace.textureId,
      selectedTextureFace.partKey,
    );
    setTextureAdjustments((current) => {
      const previous = current[key] ?? { offsetU: 0, offsetV: 0, rotation: 0 };
      const next = {
        ...previous,
        ...updates,
      };
      return {
        ...current,
        [key]: {
          offsetU: clamp(Math.round(next.offsetU * 10) / 10, -32, 32),
          offsetV: clamp(Math.round(next.offsetV * 10) / 10, -32, 32),
          rotation: ((Math.round(next.rotation / 90) * 90) % 360 + 360) % 360,
        },
      };
    });
  };

  const dragSelectedTexture = (deltaU: number, deltaV: number, hit?: TextureFaceHit) => {
    const face = selectedTextureFace ?? (hit
      ? {
        stateKey: selectedTextureBlock,
        blockId: hit.block.name,
        partKey: hit.partKey,
        face: hit.face,
        textureId: hit.textureId,
      }
      : null);
    if (!face) return;
    const key = textureAdjustmentKey(face.blockId, face.face, face.textureId, face.partKey);
    setTextureAdjustments((current) => {
      const previous = current[key] ?? { offsetU: 0, offsetV: 0, rotation: 0 };
      return {
        ...current,
        [key]: {
          ...previous,
          offsetU: clamp(Math.round((previous.offsetU + deltaU) * 10) / 10, -32, 32),
          offsetV: clamp(Math.round((previous.offsetV + deltaV) * 10) / 10, -32, 32),
        },
      };
    });
  };

  const rotateSelectedTexture = () => {
    if (!selectedTextureFace) return;
    updateSelectedTextureAdjustment({ rotation: selectedTextureAdjustment.rotation + 90 });
  };

  const resetSelectedTextureAdjustment = () => {
    if (!selectedTextureFace) return;
    const key = textureAdjustmentKey(
      selectedTextureFace.blockId,
      selectedTextureFace.face,
      selectedTextureFace.textureId,
      selectedTextureFace.partKey,
    );
    setTextureAdjustments((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const exportTextureAdjustments = () => {
    const adjustments = Object.entries(textureAdjustments).map(([key, adjustment]) => {
      const [blockId, partKey, face, textureId] = parseTextureAdjustmentKey(key);
      return {
        blockId,
        partKey,
        face,
        textureId: textureId === 'fallback' ? null : textureId,
        offsetU: adjustment.offsetU,
        offsetV: adjustment.offsetV,
        rotation: adjustment.rotation,
      };
    });
    const payload = {
      kind: 'schematic-editor-texture-adjustments',
      version: 1,
      selectedBlock: selectedTextureBlock,
      adjustments,
    };
    const text = JSON.stringify(payload, null, 2);
    setTextureExportText(text);
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const openResourceCalculator = () => {
    if (!model) return;
    setShoppingSearch('');
    setAppView('resource');
  };

  const openShoppingList = () => {
    if (!model) return;
    setShoppingSearch('');
    setAppView('shopping');
  };

  const toggleShoppingItem = (material: MaterialSummary) => {
    const key = shoppingItemKey(shoppingModeScope, material);
    setCheckedShoppingItems((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleShoppingGroup = (materials: MaterialSummary[]) => {
    const keys = materials.map((material) => shoppingItemKey(shoppingModeScope, material));
    setCheckedShoppingItems((current) => {
      const allChecked = keys.every((key) => current.has(key));
      const next = new Set(current);
      for (const key of keys) {
        if (allChecked) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  };

  const resetShoppingList = () => {
    setCheckedShoppingItems(new Set());
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
              <div className="schematic-meta">
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
                <a className="build-credit" href={defaultBuildTutorialUrl} target="_blank" rel="noreferrer">
                  build by MildMadi
                </a>
              </div>
            ) : (
              <h1>Minecraft schematic viewer</h1>
            )}
          </div>
        </div>
      </header>

      <div className={`workspace${appView === 'shopping' ? ' is-shopping' : ''}${appView === 'resource' ? ' is-resource' : ''}`}>
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
            <button
              type="button"
              role="tab"
              className={appView === 'texture' ? 'is-active' : ''}
              onClick={() => setAppView('texture')}
              aria-selected={appView === 'texture'}
              title="Texture mode"
            >
              <ImageIcon size={19} />
              <span>UV</span>
            </button>
            <button
              type="button"
              role="tab"
              className={appView === 'resource' ? 'is-active' : ''}
              onClick={openResourceCalculator}
              aria-selected={appView === 'resource'}
              disabled={!model}
              title="Resource Calculator"
            >
              <ClipboardList size={19} />
              <span>Calc</span>
            </button>
          </div>

          <div className="rail-divider" />

          <div
            className="rail-cluster"
            aria-label={
              appView === 'edit'
                ? 'Edit tools'
                : appView === 'texture'
                  ? 'Texture tools'
                  : appView === 'resource'
                    ? 'Resource Calculator tools'
                    : appView === 'shopping'
                      ? 'Shopping list tools'
                      : 'Inspect panels'
            }
          >
            {appView === 'edit' ? (
              <>
                <button
                  type="button"
                  className={editPanelTab === 'tools' && editTool === 'select' ? 'is-active' : ''}
                  onClick={() => activateEditTool('select')}
                  aria-pressed={editPanelTab === 'tools' && editTool === 'select'}
                  title="Select blocks"
                >
                  <MousePointer2 size={19} />
                  <span>Select</span>
                </button>
                <button
                  type="button"
                  className={editPanelTab === 'tools' && editTool === 'build' ? 'is-active' : ''}
                  onClick={() => activateEditTool('build')}
                  aria-pressed={editPanelTab === 'tools' && editTool === 'build'}
                  title="Build selected block"
                >
                  <Brush size={19} />
                  <span>Build</span>
                </button>
                <button
                  type="button"
                  className={editPanelTab === 'replace' ? 'is-active' : ''}
                  onClick={() => {
                    setAppView('edit');
                    setEditPanelTab('replace');
                    setCuboidSelectionMode(false);
                  }}
                  aria-pressed={editPanelTab === 'replace'}
                  title="Find and replace blocks"
                >
                  <Replace size={19} />
                  <span>Replace</span>
                </button>
              </>
            ) : appView === 'texture' ? (
              <>
                <button
                  type="button"
                  className="is-active"
                  onClick={() => setAppView('texture')}
                  aria-pressed
                  title="Texture adjustment"
                >
                  <SlidersHorizontal size={19} />
                  <span>Adjust</span>
                </button>
              </>
            ) : appView === 'resource' ? (
              <>
                <button
                  type="button"
                  className="is-active"
                  onClick={openResourceCalculator}
                  aria-pressed
                  disabled={!model}
                  title="Resource Calculator"
                >
                  <ClipboardList size={19} />
                  <span>Calc</span>
                </button>
                <button
                  type="button"
                  onClick={() => openInspectorPanel('materials')}
                  disabled={!model}
                  title="Back to materials"
                >
                  <Cuboid size={19} />
                  <span>Blocks</span>
                </button>
              </>
            ) : appView === 'shopping' ? (
              <>
                <button
                  type="button"
                  className="is-active"
                  onClick={openShoppingList}
                  aria-pressed
                  disabled={!model}
                  title="Shopping list"
                >
                  <ClipboardList size={19} />
                  <span>List</span>
                </button>
                <button
                  type="button"
                  onClick={() => openInspectorPanel('materials')}
                  disabled={!model}
                  title="Back to materials"
                >
                  <Cuboid size={19} />
                  <span>Blocks</span>
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

        <section
          className={`viewport-panel${appView === 'shopping' ? ' shopping-viewport' : ''}${appView === 'resource' ? ' resource-viewport' : ''}${selectedBlock && appView !== 'texture' && appView !== 'shopping' && appView !== 'resource' ? ' has-selection-modal' : ''}`}
          aria-label={appView === 'resource' ? 'Resource Calculator' : appView === 'shopping' ? 'Shopping list' : 'Schematic 3D viewport'}
        >
          {appView === 'resource' && model ? (
            <ResourceCalculatorBoard
              schematicName={schematicName}
              activeMaterialsLabel={activeMaterialsLabel}
              activeMaterials={activeMaterials}
              rawMaterials={rawMaterials}
              resourceStats={resourceStats}
              filteredRecipeTrees={filteredRecipeTrees}
              shoppingSearch={shoppingSearch}
              setShoppingSearch={setShoppingSearch}
              materialsScope={materialsScope}
              setMaterialsScope={setMaterialsScope}
              cuboidBounds={cuboidBounds}
              beginCuboidSelection={beginCuboidSelection}
              setAppView={setAppView}
              setInspectorTab={setInspectorTab}
              integerCrafting={integerCrafting}
              setIntegerCrafting={setIntegerCrafting}
              openInspectorPanel={openInspectorPanel}
            />
          ) : appView === 'shopping' && model ? (
            <section className="shopping-board" aria-label="Required resources shopping list">
              <div className="shopping-header">
                <div className="shopping-title-block">
                  <p className="eyebrow">Shopping List</p>
                  <h2>{schematicName}</h2>
                </div>
                <div className="shopping-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => openInspectorPanel('materials')}
                  >
                    <Cuboid size={16} />
                    Materials
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetShoppingList}
                    disabled={checkedShoppingMaterialCount === 0}
                  >
                    <RotateCcw size={16} />
                    Reset
                  </button>
                </div>
              </div>

              <div className="shopping-toolbar">
                <div className="segmented-control shopping-scope" role="group" aria-label="Shopping list scope">
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
                        setAppView('inspect');
                        setInspectorTab('selection');
                      }
                    }}
                  >
                    Selected Area
                  </button>
                </div>
                <div className="segmented-control shopping-mode" role="group" aria-label="Shopping material mode">
                  <button
                    type="button"
                    className={materialsMode === 'placed' ? 'is-active' : ''}
                    onClick={() => setMaterialsMode('placed')}
                  >
                    Placed
                  </button>
                  <button
                    type="button"
                    className={materialsMode === 'raw' ? 'is-active' : ''}
                    onClick={() => setMaterialsMode('raw')}
                  >
                    Raw
                  </button>
                </div>
                <label className="toggle-row compact-toggle">
                  <input
                    type="checkbox"
                    checked={integerCrafting}
                    onChange={(event) => setIntegerCrafting(event.target.checked)}
                  />
                  <span>Whole crafts</span>
                </label>
                <label className="material-search shopping-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={shoppingSearch}
                    onChange={(event) => setShoppingSearch(event.target.value)}
                    placeholder="Search shopping list"
                    aria-label="Search shopping list"
                  />
                </label>
                <div className="segmented-control shopping-layout-toggle" role="group" aria-label="Shopping list layout">
                  <button
                    type="button"
                    className={shoppingLayout === 'grid' ? 'is-active' : ''}
                    onClick={() => setShoppingLayout('grid')}
                    aria-pressed={shoppingLayout === 'grid'}
                    title="Grid view"
                  >
                    <Grid2X2 size={16} aria-hidden="true" />
                    <span>Grid</span>
                  </button>
                  <button
                    type="button"
                    className={shoppingLayout === 'list' ? 'is-active' : ''}
                    onClick={() => setShoppingLayout('list')}
                    aria-pressed={shoppingLayout === 'list'}
                    title="List view"
                  >
                    <List size={16} aria-hidden="true" />
                    <span>List</span>
                  </button>
                </div>
              </div>

              <div
                className="shopping-progress"
                style={{ '--shopping-progress': `${shoppingProgressPercent}%` } as CSSProperties}
                aria-label={`${shoppingProgressPercent}% collected`}
              >
                <div>
                  <span>Total</span>
                  <strong>{totalShoppingItems.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Collected</span>
                  <strong>{completedShoppingItems.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Remaining</span>
                  <strong>{remainingShoppingItems.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Rows</span>
                  <strong>{checkedShoppingMaterialCount.toLocaleString()} / {visibleMaterials.length.toLocaleString()}</strong>
                </div>
              </div>

              <div className={`shopping-list is-${shoppingLayout}`} aria-live="polite">
                {shoppingGroups.map((group) => {
                  const checkedGroupItems = group.materials.filter((material) => (
                    checkedShoppingItems.has(shoppingItemKey(shoppingModeScope, material))
                  )).length;
                  const isGroupChecked = checkedGroupItems === group.materials.length;

                  return (
                    <section className="shopping-group" key={group.id} aria-label={group.label}>
                      <div className="shopping-group-heading">
                        <span>{group.label}</span>
                        <div className="shopping-group-summary">
                          <strong>{checkedGroupItems.toLocaleString()} / {group.materials.length.toLocaleString()}</strong>
                          <button
                            type="button"
                            className="shopping-group-toggle"
                            onClick={() => toggleShoppingGroup(group.materials)}
                            aria-pressed={isGroupChecked}
                          >
                            {isGroupChecked ? 'Clear group' : 'Select all'}
                          </button>
                        </div>
                      </div>
                      <div className="shopping-group-items">
                        {group.materials.map((material) => {
                          const itemKey = shoppingItemKey(shoppingModeScope, material);
                          const isChecked = checkedShoppingItems.has(itemKey);

                          return (
                            <button
                              type="button"
                              key={itemKey}
                              className={`shopping-row${isChecked ? ' is-checked' : ''}`}
                              onClick={() => toggleShoppingItem(material)}
                              aria-pressed={isChecked}
                            >
                              <BlockPreview
                                stateKey={material.stateKey}
                                color={material.color}
                                layers={material.thumbnailLayers}
                              />
                              <span className="shopping-row-label">
                                <strong>{material.label}</strong>
                              </span>
                              <span className="shopping-row-count">{material.count.toLocaleString()}</span>
                              <MaterialBreakdown materialId={material.id} count={material.count} />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
                {shoppingGroups.length === 0 && (
                  <p className="material-empty">
                    {materialsScope === 'cuboid' && !cuboidBounds
                      ? 'Select an area to create a shopping list for that region.'
                      : shoppingSearch.trim()
                        ? `No shopping list items match "${shoppingSearch.trim()}".`
                        : 'No non-air blocks in this shopping list.'}
                  </p>
                )}
                {materialsMode === 'raw' && recipeBreakdown.unresolved.length > 0 && (
                  <p className="raw-material-notice">
                    {recipeBreakdown.unresolved.length.toLocaleString()} item types had no recipe and were counted as raw.
                  </p>
                )}
              </div>
            </section>
          ) : (
            <>
          {selectedBlock && appView !== 'texture' && (
            <section className="selection-inspector-card" aria-label="Selected block details">
              <div className="selection-inspector-header">
                <div>
                  <p className="eyebrow">Selected Block</p>
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

              {appView === 'edit' && (
                <div className="placement-grid compact" aria-label="Adjacent placement directions">
                  {(['up', 'down', 'north', 'south', 'west', 'east'] as Direction[]).map((direction) => (
                    <button type="button" key={direction} onClick={() => placeAdjacentBlock(direction)}>
                      {directionLabel(direction)}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {appView === 'edit' && rotateTargetLabel && (
            <div
              className="canvas-rotation-controls"
              ref={rotationControlsRef}
              aria-label={`Rotate ${rotateTargetLabel.toLocaleLowerCase()}`}
            >
              <button
                type="button"
                className="rotation-arrow rotation-arrow-left"
                onClick={() => rotateSelection('counterclockwise')}
                disabled={materialsScope === 'cuboid' ? !cuboidBounds : !selectedBlock}
                title={`Rotate ${rotateTargetLabel.toLocaleLowerCase()} left`}
                aria-label={`Rotate ${rotateTargetLabel.toLocaleLowerCase()} left`}
              >
                <RotateCcw size={18} />
              </button>
              <span>{rotateTargetLabel}</span>
              <button
                type="button"
                className="rotation-arrow rotation-arrow-right"
                onClick={() => rotateSelection('clockwise')}
                disabled={materialsScope === 'cuboid' ? !cuboidBounds : !selectedBlock}
                title={`Rotate ${rotateTargetLabel.toLocaleLowerCase()} right`}
                aria-label={`Rotate ${rotateTargetLabel.toLocaleLowerCase()} right`}
              >
                <RotateCw size={18} />
              </button>
            </div>
          )}

          {model && appView === 'edit' && recentBuildBlocks.length > 0 && (
            <div className="edit-hotbar" role="toolbar" aria-label="Recently used build blocks">
              {recentBuildBlocks.map((stateKey, index) => {
                const preview = createVoxelBlock(0, 0, 0, stateKey);
                return (
                  <button
                    type="button"
                    key={`${stateKey}-${index}`}
                    className={selectedBuildBlock === stateKey ? 'is-active' : ''}
                    onClick={() => chooseBuildBlock(stateKey)}
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
              <button type="button" onClick={() => appView === 'texture' ? setAppView('texture') : showPanel('materials')} title={appView === 'texture' ? 'Texture adjustments' : 'Materials'}>
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

          {appView === 'texture' ? (
            <div className="texture-compare-canvases" aria-label="Texture comparison previews">
              <div className="texture-compare-pane">
                <span>Default</span>
                <Viewer3D
                  model={texturePreviewModel}
                  cameraMode="orbit"
                  spectatorSpeed={spectatorSpeed}
                  visibleLayer={0}
                  singleLayer={false}
                  autoRotate={false}
                  showGrid={false}
                  theme={theme}
                  hiddenMaterialIds={displayedHiddenMaterialIds}
                  playerHeadSelections={playerHeadSelections}
                  selectedBlock={null}
                  placementPreviewBlock={null}
                  cuboidBounds={null}
                  cuboidCorners={emptyCuboidCorners()}
                  textureAdjustments={{}}
                  textureEditMode={false}
                  onAxisOrientationChange={updateAxisGizmo}
                  viewerRef={defaultTextureViewerRef}
                />
              </div>
              <div className="texture-compare-pane">
                <span>Adjusted</span>
                <Viewer3D
                  model={texturePreviewModel}
                  cameraMode="orbit"
                  spectatorSpeed={spectatorSpeed}
                  visibleLayer={0}
                  singleLayer={false}
                  autoRotate={false}
                  showGrid={false}
                  theme={theme}
                  hiddenMaterialIds={displayedHiddenMaterialIds}
                  playerHeadSelections={playerHeadSelections}
                  selectedBlock={null}
                  placementPreviewBlock={null}
                  cuboidBounds={null}
                  cuboidCorners={emptyCuboidCorners()}
                  textureAdjustments={textureAdjustments}
                  textureEditMode
                  onTextureFaceSelect={handleTextureFaceSelect}
                  onTextureFaceDrag={dragSelectedTexture}
                  onAxisOrientationChange={updateAxisGizmo}
                  viewerRef={viewerRef}
                />
              </div>
            </div>
          ) : (
            <Viewer3D
              model={displayedModel}
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
              rotationTarget={appView === 'edit' && rotateTargetLabel ? (materialsScope === 'cuboid' && cuboidBounds ? 'cuboid' : 'block') : null}
              rotationControlRef={rotationControlsRef}
              textureAdjustments={textureAdjustments}
              onBlockSelect={handleBlockSelect}
              onAxisOrientationChange={updateAxisGizmo}
              viewerRef={viewerRef}
            />
          )}
            </>
          )}
        </section>

      {appView !== 'shopping' && appView !== 'resource' && (
      <aside className="control-rail" aria-label="Schematic controls">
        {error && (
          <section className="notice error" role="alert">
            <ScanSearch size={18} />
            <p>{error}</p>
          </section>
        )}

        {appView === 'texture' ? (
          <section className="texture-panel" aria-label="Texture adjustment editor">
            <div className="section-heading compact">
              <div>
                <h2>Texture Adjustments</h2>
                <p className="eyebrow">{textureLibraryItems.length.toLocaleString()} blocks</p>
              </div>
              <ImageIcon size={18} />
            </div>

            <label className="material-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={textureBlockSearch}
                onChange={(event) => setTextureBlockSearch(event.target.value)}
                placeholder="Find block to preview"
                aria-label="Find block to preview"
              />
            </label>

            <div className="texture-editor-layout">
              <div className="texture-block-list" aria-label="Texture block list">
                {textureLibraryItems.map((item) => (
                  <button
                    type="button"
                    key={item.stateKey}
                    className={selectedTextureBlock === item.stateKey ? 'is-active' : ''}
                    onClick={() => chooseTextureBlock(item.stateKey)}
                    title={item.label}
                    aria-pressed={selectedTextureBlock === item.stateKey}
                  >
                    <BlockPreview stateKey={item.stateKey} color={item.color} layers={materialThumbnailLayers(item.stateKey)} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              <section className="texture-face-editor" aria-label="Selected texture face">
                <div className="texture-face-summary">
                  <div>
                    <p className="eyebrow">Preview block</p>
                    <strong>{formatBlockName(selectedTextureBlock)}</strong>
                  </div>
                  <SlidersHorizontal size={18} />
                </div>

                {selectedTextureFace ? (
                  <>
                    <div className="texture-preview-frame">
                      {selectedTextureFace.textureId ? (
                        <img src={textureUrl(selectedTextureFace.textureId)} alt="" />
                      ) : (
                        <div className="texture-preview-empty">fallback</div>
                      )}
                    </div>
                    <dl className="texture-face-metadata">
                      <div>
                        <dt>Face</dt>
                        <dd>{selectedTextureFace.face}</dd>
                      </div>
                      <div>
                        <dt>Texture</dt>
                        <dd>{selectedTextureFace.textureId ?? 'fallback'}</dd>
                      </div>
                    </dl>
                    <div className="texture-control-grid">
                      <label>
                        <span>U offset</span>
                        <input
                          type="number"
                          step="0.5"
                          value={selectedTextureAdjustment.offsetU}
                          onChange={(event) => updateSelectedTextureAdjustment({ offsetU: Number(event.target.value) || 0 })}
                        />
                      </label>
                      <label>
                        <span>V offset</span>
                        <input
                          type="number"
                          step="0.5"
                          value={selectedTextureAdjustment.offsetV}
                          onChange={(event) => updateSelectedTextureAdjustment({ offsetV: Number(event.target.value) || 0 })}
                        />
                      </label>
                    </div>
                    <div className="texture-nudge-grid" aria-label="Nudge selected texture">
                      <button type="button" onClick={() => updateSelectedTextureAdjustment({ offsetV: selectedTextureAdjustment.offsetV - 1 })}>
                        <ChevronUp size={16} />
                      </button>
                      <button type="button" onClick={() => updateSelectedTextureAdjustment({ offsetU: selectedTextureAdjustment.offsetU - 1 })}>
                        <ChevronLeft size={16} />
                      </button>
                      <button type="button" onClick={() => updateSelectedTextureAdjustment({ offsetU: selectedTextureAdjustment.offsetU + 1 })}>
                        <ChevronRight size={16} />
                      </button>
                      <button type="button" onClick={() => updateSelectedTextureAdjustment({ offsetV: selectedTextureAdjustment.offsetV + 1 })}>
                        <ChevronDown size={16} />
                      </button>
                    </div>
                    <div className="rotation-actions">
                      <button type="button" onClick={rotateSelectedTexture}>
                        <RotateCw size={16} />
                        Rotate 90
                      </button>
                      <button type="button" onClick={resetSelectedTextureAdjustment}>
                        <RotateCcw size={16} />
                        Reset Face
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="panel-empty">Click a visible side of the preview block to select its texture.</p>
                )}

                <button
                  type="button"
                  className="primary-button texture-export-button"
                  onClick={exportTextureAdjustments}
                  disabled={exportedTextureAdjustmentCount === 0}
                >
                  <Download size={16} />
                  Export Adjustments
                </button>
                {textureExportText && (
                  <textarea
                    className="texture-export-text"
                    value={textureExportText}
                    readOnly
                    aria-label="Exported texture adjustment JSON"
                  />
                )}
              </section>
            </div>
          </section>
        ) : model && (
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
                      ? `${filteredMaterials.length.toLocaleString()} of ${visibleMaterials.length.toLocaleString()} materials`
                      : `${visibleMaterials.length.toLocaleString()} materials`}
                  </h2>
                  <p className="eyebrow">{visibleMaterialsLabel}</p>
                </div>
                <div className="material-heading-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={toggleAllMaterialVisibility}
                    disabled={hideableMaterialIds.length === 0}
                    aria-label={`${bulkMaterialVisibilityLabel} placed materials`}
                    title={bulkMaterialVisibilityLabel}
                  >
                    {allVisibleMaterialsHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                    {bulkMaterialVisibilityLabel}
                  </button>
                  <button
                    type="button"
                    className="secondary-button material-shopping-link"
                    onClick={openShoppingList}
                  >
                    <ClipboardList size={16} />
                    Shopping List
                  </button>
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
              <div className="segmented-control" role="group" aria-label="Material list mode">
                <button
                  type="button"
                  className={materialsMode === 'placed' ? 'is-active' : ''}
                  onClick={() => setMaterialsMode('placed')}
                >
                  Placed Blocks
                </button>
                <button
                  type="button"
                  className={materialsMode === 'raw' ? 'is-active' : ''}
                  onClick={() => setMaterialsMode('raw')}
                >
                  Raw Materials
                </button>
              </div>
              <label className="toggle-row compact-toggle material-crafting-toggle">
                <input
                  type="checkbox"
                  checked={integerCrafting}
                  onChange={(event) => setIntegerCrafting(event.target.checked)}
                />
                <span>Whole crafts</span>
              </label>
              {materialsMode === 'raw' && recipeBreakdown.unresolved.length > 0 && (
                <p className="raw-material-notice">
                  {recipeBreakdown.unresolved.length.toLocaleString()} item types had no recipe and were counted as raw.
                </p>
              )}
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
                  const isSelected = materialsMode === 'placed' && material.id === selectedMaterialId;
                  const breakdownId = `material-breakdown-${material.id}`;
                  const recipeTree = recipeTreeByMaterialId.get(normalizeRecipeItemId(material.id));

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
                          <BlockPreview
                            stateKey={material.stateKey}
                            color={material.color}
                            layers={material.thumbnailLayers}
                          />
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
                          disabled={materialsMode === 'raw'}
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
                          {materialsMode === 'placed' && recipeTree && (
                            <RecipeTree node={recipeTree} />
                          )}
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
              <>
              <div
                className="inspector-tabs"
                role="tablist"
                aria-label="Edit panels"
                style={{ '--tab-count': '3' } as CSSProperties}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={editPanelTab === 'tools'}
                  className={editPanelTab === 'tools' ? 'is-active' : ''}
                  onClick={() => setEditPanelTab('tools')}
                >
                  Block Library
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editPanelTab === 'rotate'}
                  className={editPanelTab === 'rotate' ? 'is-active' : ''}
                  onClick={() => setEditPanelTab('rotate')}
                >
                  Rotate
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editPanelTab === 'replace'}
                  className={editPanelTab === 'replace' ? 'is-active' : ''}
                  onClick={() => setEditPanelTab('replace')}
                >
                  Find & Replace
                </button>
              </div>

              <section className={`edit-panel inspector-panel${editPanelTab === 'tools' ? ' is-active' : ''}`} aria-label="Edit controls">
                <div className="edit-tool-grid" role="group" aria-label="Edit tool">
                  <button
                    type="button"
                    className={editPanelTab === 'tools' && editTool === 'select' ? 'is-active' : ''}
                    onClick={() => activateEditTool('select')}
                    aria-pressed={editPanelTab === 'tools' && editTool === 'select'}
                  >
                    <MousePointer2 size={17} />
                    Select
                  </button>
                  <button
                    type="button"
                    className={editPanelTab === 'tools' && editTool === 'build' ? 'is-active' : ''}
                    onClick={() => activateEditTool('build')}
                    aria-pressed={editPanelTab === 'tools' && editTool === 'build'}
                  >
                    <Brush size={17} />
                    Build
                  </button>
                </div>

                <section className="edit-library" aria-label="Block library">
                  <div className="section-heading compact">
                    <div>
                      <h2>Block Library</h2>
                      <p className="eyebrow">{visibleBlockLibraryCount.toLocaleString()} blocks</p>
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
                  <div className="block-library-grid" aria-label="Creative block grid">
                    {blockLibraryGroups.map((group) => (
                      <section className="block-library-group" key={group.id} aria-label={group.label}>
                        <div className="block-library-group-heading">
                          <span>{group.label}</span>
                          <strong>{group.items.length.toLocaleString()}</strong>
                        </div>
                        <div className="block-library-tile-grid">
                          {group.items.map((item) => {
                            const isSelected = selectedBuildBlock === item.stateKey;

                            return (
                              <div
                                className={`block-library-tile${isSelected ? ' is-selected' : ''}`}
                                key={item.stateKey}
                                data-tooltip={item.label}
                              >
                                <button
                                  type="button"
                                  className="block-library-pick"
                                  onClick={() => chooseBuildBlock(item.stateKey)}
                                  aria-label={`Use ${item.label}`}
                                  aria-pressed={isSelected}
                                >
                                  <BlockPreview stateKey={item.stateKey} color={item.color} layers={materialThumbnailLayers(item.stateKey)} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                    {blockLibraryGroups.length === 0 && (
                      <p className="material-empty">No blocks match that search.</p>
                    )}
                  </div>
                </section>

              </section>

              <section
                className={`edit-panel inspector-panel${editPanelTab === 'rotate' ? ' is-active' : ''}`}
                aria-label="Rotate blocks"
              >
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
                  {editNotice && <p className="edit-notice">{editNotice}</p>}
                </section>
              </section>

              <section
                className={`replace-panel inspector-panel${editPanelTab === 'replace' ? ' is-active' : ''}`}
                aria-label="Find and replace blocks"
              >
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
                        {allBuildBlocks.map((stateKey) => (
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
              </>
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
      )}
      </div>
      {showCelebration && appView === 'shopping' && (
        <ShoppingCelebration
          materials={visibleMaterials}
          onDone={() => setShowCelebration(false)}
        />
      )}
    </main>
  );
}

function BlockPreview({ stateKey, color, layers }: { stateKey: string; color: number; layers?: BlockThumbnailLayer[] }) {
  const previewRef = useRef<HTMLSpanElement | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(() => getCachedBlockThumbnail(stateKey, color, layers) ?? null);
  const [thumbnailState, setThumbnailState] = useState<ThumbnailLoadState>(() => {
    const cachedThumbnail = getCachedBlockThumbnail(stateKey, color, layers);
    if (cachedThumbnail === undefined) return 'idle';
    return cachedThumbnail ? 'ready' : 'failed';
  });
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '900px' });

    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cachedThumbnail = getCachedBlockThumbnail(stateKey, color, layers);
    if (cachedThumbnail !== undefined) {
      setThumbnailUrl(cachedThumbnail);
      setThumbnailState(cachedThumbnail ? 'ready' : 'failed');
      return;
    }

    if (!isVisible) return;

    let cancelled = false;
    setThumbnailUrl(null);
    setThumbnailState('loading');
    void createBlockThumbnail(stateKey, color, layers)
      .then((url) => {
        if (cancelled) return;
        setThumbnailUrl(url);
        setThumbnailState(url ? 'ready' : 'failed');
      })
      .catch(() => {
        if (cancelled) return;
        setThumbnailUrl(null);
        setThumbnailState('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [color, isVisible, layers, stateKey]);

  const fallbackColor = `#${color.toString(16).padStart(6, '0')}`;

  return (
    <span
      ref={previewRef}
      className="block-preview"
      data-shape="thumbnail"
      data-state={thumbnailState}
      aria-hidden="true"
      style={{
        '--block-fallback': fallbackColor,
        '--block-thumbnail': thumbnailUrl ? `url("${thumbnailUrl}")` : 'none',
      } as CSSProperties}
    >
      {thumbnailState === 'failed' && (
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
  return materialIdForStateKey(block.stateKey);
}

function materialIdForStateKey(stateKey: string): string {
  const id = stripBlockStateProperties(stateKey);
  const path = id.replace(/^minecraft:/, '');
  if (path === 'wall_sign') return id.replace(/wall_sign$/, 'sign');
  if (path === 'wall_hanging_sign') return id.replace(/wall_hanging_sign$/, 'hanging_sign');
  if (isWallSignStateKey(id)) return id.replace(/_wall_sign$/, '_sign');
  if (isWallHangingSignStateKey(id)) return id.replace(/_wall_hanging_sign$/, '_hanging_sign');
  return id;
}

function parseTextureAdjustmentKey(key: string): [string, string, ModelFaceName, string] {
  const parts = key.split('::');
  if (parts.length === 3) {
    const [blockId, face, textureId] = parts;
    return [blockId, '*', face as ModelFaceName, textureId];
  }

  const [blockId, partKey, face, textureId] = parts.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  return [blockId, partKey, face as ModelFaceName, textureId];
}

function createTexturePreviewModel(stateKey: string): SchematicModel {
  const blocks = previewBlocksForTextureEditor(stateKey);
  const dimensions = previewDimensionsForTextureEditor(stateKey);

  return finalizeSchematicModel({
    name: formatBlockName(stateKey),
    source: 'Sample',
    dimensions,
    origin: { x: 0, y: 0, z: 0 },
    blocks,
    paletteSize: new Set(blocks.map((block) => block.stateKey)).size,
    warnings: [],
  });
}

function previewBlocksForTextureEditor(stateKey: string): VoxelBlock[] {
  if (isDoorStateKey(stateKey)) {
    const baseState = stripBlockStateProperties(stateKey);
    const parsed = parseStateKey(stateKey);
    const doorProperties = {
      facing: parsed?.properties.facing ?? 'south',
      hinge: parsed?.properties.hinge ?? 'left',
      open: parsed?.properties.open ?? 'false',
    };

    return [
      createVoxelBlock(0, 0, 0, withBlockStateProperties(baseState, { ...doorProperties, half: 'lower' })),
      createVoxelBlock(0, 1, 0, withBlockStateProperties(baseState, { ...doorProperties, half: 'upper' })),
    ];
  }

  if (isPitcherCropStateKey(stateKey)) {
    const baseState = stripBlockStateProperties(stateKey);
    const parsed = parseStateKey(stateKey);
    const age = parsed?.properties.age ?? '4';

    return [
      createVoxelBlock(0, 0, 0, withBlockStateProperties(baseState, { age, half: 'lower' })),
      createVoxelBlock(0, 1, 0, withBlockStateProperties(baseState, { age, half: 'upper' })),
    ];
  }

  if (!isBedStateKey(stateKey)) return [createVoxelBlock(0, 0, 0, stateKey)];

  const baseState = stripBlockStateProperties(stateKey);
  return [
    createVoxelBlock(0, 0, 0, withBlockStateProperties(baseState, { facing: 'south', occupied: 'false', part: 'foot' })),
    createVoxelBlock(0, 0, 1, withBlockStateProperties(baseState, { facing: 'south', occupied: 'false', part: 'head' })),
  ];
}

function previewDimensionsForTextureEditor(stateKey: string): SchematicModel['dimensions'] {
  if (isBedStateKey(stateKey)) return { width: 1, height: 1, length: 2 };
  if (isDoorStateKey(stateKey) || isPitcherCropStateKey(stateKey)) return { width: 1, height: 2, length: 1 };
  return { width: 1, height: 1, length: 1 };
}

function isBedStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey).replace(/^minecraft:/, '').endsWith('_bed');
}

function stripBlockStateProperties(stateKey: string): string {
  return stateKey.split('[', 1)[0];
}

function withBlockStateProperties(stateKey: string, properties: Record<string, string>): string {
  const id = stripBlockStateProperties(stateKey);
  const existing = new Map<string, string>();
  const rawProperties = /\[(?<properties>.*)\]$/.exec(stateKey)?.groups?.properties;
  if (rawProperties) {
    for (const pair of rawProperties.split(',')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) existing.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(properties)) {
    existing.set(key, value);
  }
  return `${id}[${Array.from(existing.entries()).map(([key, value]) => `${key}=${value}`).join(',')}]`;
}

function compareBlockLibraryItems(a: string, b: string): number {
  const categoryDelta = creativeCategoryRank(creativeCategoryForBlock(a)) - creativeCategoryRank(creativeCategoryForBlock(b));
  if (categoryDelta !== 0) return categoryDelta;
  return creativeInventoryRank(a) - creativeInventoryRank(b)
    || formatBlockName(a).localeCompare(formatBlockName(b));
}

function groupBlocksByCreativeCategory(items: BlockLibraryItem[]): BlockLibraryGroup[] {
  return creativeCategoryOrder.flatMap((category) => {
    const categoryItems = items
      .filter((item) => item.category === category.id)
      .sort((a, b) => compareBlockLibraryItems(a.stateKey, b.stateKey));

    return categoryItems.length > 0 ? [{ id: category.id, label: category.label, items: categoryItems }] : [];
  });
}

function groupBlocksByColor(items: BlockLibraryItem[]): BlockLibraryGroup[] {
  return colorGroupOrder.flatMap((group) => {
    const groupItems = items
      .filter((item) => item.colorGroup === group.id)
      .sort(compareBlocksByColor);

    return groupItems.length > 0 ? [{ id: group.id, label: group.label, items: groupItems }] : [];
  });
}

function creativeCategoryRank(id: CreativeCategoryId): number {
  return creativeCategoryOrder.findIndex((category) => category.id === id);
}

function creativeInventoryRank(stateKey: string): number {
  const id = baseBlockId(stateKey);
  const category = creativeCategoryForBlock(stateKey);
  const inventoryRank = creativeInventoryKeywordRank(category, id);
  const categoryBase = creativeCategoryRank(category) * 1_000;

  if (category === 'colored_blocks') {
    return categoryBase + inventoryRank * 100 + colorPrefixRank(id) * 10 + blockVariantRank(stripColorPrefix(id));
  }
  if (category === 'natural_blocks') {
    return categoryBase + inventoryRank * 100 + orderedBlockRank(id, creativeNaturalOrder) + blockVariantRank(id);
  }
  if (category === 'functional_blocks') {
    return categoryBase + inventoryRank * 100 + orderedBlockRank(id, creativeFunctionalOrder) + woodTypeRank(id) + blockVariantRank(id);
  }
  if (category === 'redstone_blocks') {
    return categoryBase + inventoryRank * 100 + orderedBlockRank(id, creativeRedstoneOrder) + blockVariantRank(id);
  }
  if (category === 'tools_and_utilities') {
    return categoryBase + inventoryRank * 100 + orderedBlockRank(id, creativeUtilityOrder) + blockVariantRank(id);
  }

  return categoryBase + inventoryRank * 100 + orderedBlockRank(id, creativeBuildingOrder) + woodTypeRank(id) + blockVariantRank(id);
}

function creativeInventoryTabLabel(id: CreativeCategoryId): string {
  const tab = creativeInventoryData.minecraftCreativeInventory.tabs[id];
  return tab?.label ?? formatBlockName(id);
}

function createCreativeInventoryKeywordOrder(): Record<CreativeCategoryId, string[]> {
  return {
    building_blocks: creativeInventoryKeywordsForTab('building_blocks'),
    colored_blocks: creativeInventoryKeywordsForTab('colored_blocks'),
    natural_blocks: creativeInventoryKeywordsForTab('natural_blocks'),
    functional_blocks: creativeInventoryKeywordsForTab('functional_blocks'),
    redstone_blocks: creativeInventoryKeywordsForTab('redstone_blocks'),
    tools_and_utilities: creativeInventoryKeywordsForTab('tools_and_utilities'),
  };
}

function creativeInventoryKeywordsForTab(id: CreativeCategoryId): string[] {
  const tab = creativeInventoryData.minecraftCreativeInventory.tabs[id];
  const organization = 'organization' in tab && Array.isArray(tab.organization) ? tab.organization : [];
  const keywords: string[] = [];

  for (const group of organization) {
    const inventoryGroup = group as { items?: string[]; variants?: string[] };
    for (const item of [...(inventoryGroup.items ?? []), ...(inventoryGroup.variants ?? [])]) {
      keywords.push(normalizeInventoryKeyword(item));
    }
  }

  return keywords.filter((keyword, index) => keyword && keywords.indexOf(keyword) === index);
}

function creativeInventoryKeywordRank(category: CreativeCategoryId, id: string): number {
  const keywords = creativeInventoryKeywordOrder[category];
  const match = keywords
    .map((keyword, index) => ({ keyword, index }))
    .filter(({ keyword }) => inventoryKeywordMatchesBlockId(keyword, id))
    .sort((a, b) => b.keyword.length - a.keyword.length || a.index - b.index)[0];

  return match ? match.index : keywords.length;
}

function inventoryKeywordMatchesBlockId(keyword: string, id: string): boolean {
  if (keyword === id) return true;

  const singularKeyword = singularInventoryKeyword(keyword);
  if (singularKeyword !== keyword && inventoryKeywordMatchesBlockId(singularKeyword, id)) return true;

  return id.startsWith(`${keyword}_`)
    || id.endsWith(`_${keyword}`)
    || id.includes(`_${keyword}_`);
}

function normalizeInventoryKeyword(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^colored_/, '')
    .replace(/^wooden_/, '')
    .replace(/_variants?$/, '')
    .replace(/_base_material$/, '')
    .replace(/^block_of_/, '')
    .replace(/^redstone_dust$/, 'redstone')
    .replace(/^target_block$/, 'target')
    .replace(/^jack_o_lantern$/, 'jack_o_lantern')
    .replace(/^lapis_lazuli_ore$/, 'lapis_ore')
    .replace(/^deepslate_ore$/, 'deepslate')
    .replace(/^wood$/, 'wood')
    .replace(/^logs$/, 'log')
    .replace(/^slabs$/, 'slab')
    .replace(/^stairs$/, 'stairs')
    .replace(/^fences$/, 'fence')
    .replace(/^buttons$/, 'button')
    .replace(/^doors$/, 'door')
    .replace(/^trapdoors$/, 'trapdoor')
    .replace(/^pressure_plates$/, 'pressure_plate')
    .replace(/^signs$/, 'sign')
    .replace(/^hanging_signs$/, 'hanging_sign')
    .replace(/^stained_glass_panes$/, 'stained_glass_pane')
    .replace(/^shulker_boxes$/, 'shulker_box')
    .replace(/^colored_beds$/, 'bed')
    .replace(/^beds$/, 'bed')
    .replace(/^banners$/, 'banner')
    .replace(/^candles$/, 'candle')
    .replace(/^froglights$/, 'froglight')
    .replace(/^saplings$/, 'sapling')
    .replace(/^tulips$/, 'tulip')
    .replace(/^vines$/, 'vine')
    .replace(/^axes$/, 'axe')
    .replace(/^hoes$/, 'hoe')
    .replace(/^fish_buckets$/, 'bucket')
    .replace(/^boats_with_chest$/, 'chest_boat')
    .replace(/^rafts_with_chest$/, 'chest_raft')
    .replace(/^firework_rockets$/, 'firework_rocket')
    .replace(/^music_discs$/, 'music_disc')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function singularInventoryKeyword(keyword: string): string {
  if (keyword.endsWith('ies')) return `${keyword.slice(0, -3)}y`;
  if (keyword.endsWith('es') && !keyword.endsWith('ss')) return keyword.slice(0, -2);
  if (keyword.endsWith('s') && !keyword.endsWith('ss')) return keyword.slice(0, -1);
  return keyword;
}

function orderedBlockRank(id: string, order: string[]): number {
  const exactIndex = order.indexOf(id);
  if (exactIndex >= 0) return exactIndex;

  const familyMatch = order
    .map((family, index) => ({ family, index }))
    .filter(({ family }) => id.startsWith(`${family}_`) || id.endsWith(`_${family}`))
    .sort((a, b) => b.family.length - a.family.length || a.index - b.index)[0];

  return familyMatch ? familyMatch.index : order.length + woodTypeRank(id);
}

function woodTypeRank(id: string): number {
  const woodIndex = woodTypeOrder.findIndex((wood) => id === wood || id.startsWith(`${wood}_`) || id.includes(`_${wood}_`));
  return woodIndex >= 0 ? woodIndex : woodTypeOrder.length;
}

function colorPrefixRank(id: string): number {
  const colorIndex = dyeColorOrder.findIndex((color) => id === color || id.startsWith(`${color}_`));
  return colorIndex >= 0 ? colorIndex : dyeColorOrder.length;
}

function stripColorPrefix(id: string): string {
  const color = dyeColorOrder.find((candidate) => id.startsWith(`${candidate}_`));
  return color ? id.slice(color.length + 1) : id;
}

function blockVariantRank(id: string): number {
  if (!id.includes('_')) return 0;

  const variantOrder = [
    'block',
    'ore',
    'raw',
    'chiseled',
    'cut',
    'polished',
    'smooth',
    'bricks',
    'brick',
    'tiles',
    'tile',
    'pillar',
    'planks',
    'log',
    'wood',
    'stem',
    'hyphae',
    'leaves',
    'sapling',
    'stairs',
    'slab',
    'wall',
    'fence_gate',
    'fence',
    'door',
    'trapdoor',
    'pressure_plate',
    'button',
    'hanging_sign',
    'sign',
    'wool',
    'carpet',
    'terracotta',
    'concrete',
    'concrete_powder',
    'glazed_terracotta',
    'stained_glass_pane',
    'stained_glass',
    'candle',
    'bed',
    'banner',
    'shulker_box',
  ];
  const variantMatch = variantOrder
    .map((variant, index) => ({ variant, index: index + 1 }))
    .filter(({ variant }) => id === variant || id.endsWith(`_${variant}`) || id.includes(`_${variant}_`))
    .sort((a, b) => b.variant.length - a.variant.length || a.index - b.index)[0];

  return variantMatch ? variantMatch.index : variantOrder.length + 1;
}

function creativeCategoryForBlock(stateKey: string): CreativeCategoryId {
  const id = baseBlockId(stateKey);

  if (isColoredBlock(id)) return 'colored_blocks';
  if (isRedstoneBlock(id)) return 'redstone_blocks';
  if (isToolUtilityBlock(id)) return 'tools_and_utilities';
  if (isBuildingBlock(id)) return 'building_blocks';
  if (isFunctionalBlock(id)) return 'functional_blocks';
  if (isNaturalBlock(id)) return 'natural_blocks';
  return 'building_blocks';
}

function isBuildingBlock(id: string): boolean {
  return orderedBlockRank(id, creativeBuildingOrder) < creativeBuildingOrder.length;
}

function isColoredBlock(id: string): boolean {
  return /(^|_)(wool|carpet|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|candle|banner|shulker_box|bed)$/.test(id)
    || colorNameFromBlock(id) !== null;
}

function isNaturalBlock(id: string): boolean {
  return /(^|_)(dirt|grass_block|podzol|mycelium|sand|gravel|clay|mud|snow|ice|nylium|netherrack|soul_sand|soul_soil|end_stone|obsidian|ore|leaves|log|wood|stem|hyphae|roots|vine|moss|coral|kelp|seagrass|sapling|flower|tulip|orchid|allium|bluet|daisy|dandelion|poppy|fern|bush|cactus|mushroom|fungus|wart|crop|wheat|carrots|potatoes|beetroots|melon|pumpkin|bamboo|sugar_cane|dripstone|amethyst|calcite|tuff|deepslate|basalt|blackstone|granite|diorite|andesite)$/.test(id)
    || id.includes('azalea')
    || id.includes('mangrove_propagule');
}

function isFunctionalBlock(id: string): boolean {
  return /(^|_)(crafting_table|furnace|blast_furnace|smoker|campfire|anvil|grindstone|stonecutter|cartography_table|fletching_table|smithing_table|loom|lectern|brewing_stand|cauldron|composter|barrel|chest|trapped_chest|ender_chest|shulker_box|enchanting_table|beacon|conduit|jukebox|note_block|bell|bed|respawn_anchor|lodestone|bookshelf|decorated_pot|flower_pot|lantern|torch|soul_torch|chain|ladder|scaffolding|glass_pane|door|trapdoor|fence|fence_gate|wall|sign|hanging_sign|shelf)$/.test(id);
}

function isRedstoneBlock(id: string): boolean {
  return /(^|_)(redstone|repeater|comparator|piston|observer|dispenser|dropper|hopper|target|lever|button|pressure_plate|tripwire|daylight_detector|sculk_sensor|calibrated_sculk_sensor|rail|powered_rail|detector_rail|activator_rail|tnt|crafter|copper_bulb|lightning_rod|command_block|structure_block|jigsaw)$/.test(id);
}

function isToolUtilityBlock(id: string): boolean {
  return /(^|_)(air|water|lava|light|barrier|structure_void|moving_piston|end_portal|nether_portal|spawner|trial_spawner|vault)$/.test(id);
}

function colorGroupForColor(color: number): ColorGroupId {
  const namedColor = colorNameFromBlockColor(color);
  if (namedColor) return namedColor;

  const { hue, saturation, lightness } = rgbToHsl(color);
  if (lightness >= 0.82 && saturation < 0.32) return 'white';
  if (lightness <= 0.18) return 'black';
  if (saturation < 0.18) return 'gray';
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 48 && lightness < 0.42) return 'brown';
  if (hue < 42) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 155) return 'green';
  if (hue < 195) return 'cyan';
  if (hue < 255) return 'blue';
  if (hue < 300) return 'purple';
  if (hue < 345) return 'pink';
  return 'gray';
}

function colorNameFromBlockColor(color: number): ColorGroupId | null {
  const { hue, saturation, lightness } = rgbToHsl(color);
  if (lightness > 0.88 && saturation < 0.2) return 'white';
  if (lightness < 0.12) return 'black';
  return null;
}

function compareBlocksByColor(a: BlockLibraryItem, b: BlockLibraryItem): number {
  const aHsl = rgbToHsl(a.color);
  const bHsl = rgbToHsl(b.color);
  return aHsl.hue - bHsl.hue
    || bHsl.saturation - aHsl.saturation
    || aHsl.lightness - bHsl.lightness
    || a.label.localeCompare(b.label);
}

function rgbToHsl(color: number): { hue: number; saturation: number; lightness: number } {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);

  return { hue: (hue + 360) % 360, saturation, lightness };
}

function baseBlockId(stateKey: string): string {
  return stateKey.replace(/^minecraft:/, '').split('[', 1)[0];
}

function colorNameFromBlock(id: string): ColorGroupId | null {
  const match = /^(white|light_gray|gray|black|brown|red|orange|yellow|lime|green|cyan|light_blue|blue|purple|magenta|pink)_/.exec(id);
  if (!match) return null;

  switch (match[1]) {
    case 'white':
    case 'light_gray':
      return 'white';
    case 'gray':
      return 'gray';
    case 'black':
      return 'black';
    case 'brown':
      return 'brown';
    case 'red':
      return 'red';
    case 'orange':
      return 'orange';
    case 'yellow':
      return 'yellow';
    case 'lime':
    case 'green':
      return 'green';
    case 'cyan':
    case 'light_blue':
      return 'cyan';
    case 'blue':
      return 'blue';
    case 'purple':
    case 'magenta':
      return 'purple';
    case 'pink':
      return 'pink';
    default:
      return null;
  }
}

function summarizeMaterials(blocks: VoxelBlock[]): MaterialSummary[] {
  const counts = new Map<string, MaterialSummary>();
  for (const block of blocks) {
    const id = materialIdForBlock(block);
    const quantity = materialQuantityForBlock(block);
    if (quantity === 0) continue;

    const current = counts.get(id) ?? {
      id,
      label: formatBlockName(id),
      count: 0,
      color: block.color,
      stateKey: id,
      thumbnailLayers: materialThumbnailLayers(block.stateKey),
    };
    current.count += quantity;
    counts.set(id, current);
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function materialSummaryForRecipeItem(material: { id: string; count: number }, placedMaterials: MaterialSummary[]): MaterialSummary {
  const id = normalizeRecipeItemId(material.id);
  const placedMatch = placedMaterials.find((candidate) => normalizeRecipeItemId(candidate.id) === id);
  if (placedMatch) {
    return {
      ...placedMatch,
      id,
      label: formatBlockName(id),
      count: material.count,
    };
  }

  const stateKey = recipeItemStateKey(id);
  const preview = createVoxelBlock(0, 0, 0, stateKey);
  return {
    id,
    label: formatBlockName(id),
    count: material.count,
    color: preview.color,
    stateKey,
    thumbnailLayers: materialThumbnailLayers(stateKey),
  };
}

function recipeItemStateKey(id: string): string {
  return id.startsWith('minecraft:') ? id : `minecraft:${id}`;
}

function shoppingItemKey(scopeKey: string, material: MaterialSummary): string {
  return `${scopeKey}:${material.id}:${material.count}`;
}

function shoppingScopeKey(model: SchematicModel, scope: MaterialsScope, bounds: CuboidBounds | null): string {
  if (scope === 'cuboid' && bounds) return `cuboid:${boundsKey(bounds)}`;
  return `build:${model.dimensions.width}x${model.dimensions.height}x${model.dimensions.length}`;
}

function shoppingStorageKey(model: SchematicModel, scopeKey: string, materials: MaterialSummary[]): string {
  const dimensions = `${model.dimensions.width}x${model.dimensions.height}x${model.dimensions.length}`;
  const materialHash = hashText(materials.map((material) => `${material.id}:${material.count}`).join('|'));
  const identity = hashText(`${model.name}|${model.source}|${dimensions}|${scopeKey}|${materialHash}`);
  return `${shoppingListStoragePrefix}:${identity}`;
}

function parseShoppingStorage(rawItems: string): string[] {
  try {
    const parsed = JSON.parse(rawItems);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function countCraftingSteps(nodes: BreakdownNode[]): number {
  return nodes.reduce((sum, node) => (
    sum
      + (node.isRaw ? 0 : 1)
      + countCraftingSteps(node.children)
  ), 0);
}

function estimateChestCount(materials: MaterialSummary[]): number {
  const slots = materials.reduce((sum, material) => (
    sum + Math.ceil(material.count / itemStackSize(material.id))
  ), 0);

  return Math.ceil(slots / 27);
}

function resourceTreeMatchesSearch(node: BreakdownNode, query: string): boolean {
  const id = node.id.toLocaleLowerCase();
  const label = formatBlockName(node.id).toLocaleLowerCase();

  return id.includes(query)
    || label.includes(query)
    || node.children.some((child) => resourceTreeMatchesSearch(child, query));
}

function groupResourceDependencyTrees(trees: BreakdownNode[]): ResourceGraphGroup[] {
  const groups = new Map<string, ResourceGraphGroup>();

  for (const tree of trees) {
    const groupMeta = resourceGroupForTree(tree);
    const paths = collectResourceFlowPaths(tree);
    const existing = groups.get(groupMeta.id) ?? {
      ...groupMeta,
      paths: [],
      maxColumns: 1,
    };

    existing.paths.push(...paths);
    existing.maxColumns = Math.max(existing.maxColumns, ...paths.map((path) => path.length));
    groups.set(groupMeta.id, existing);
  }

  return Array.from(groups.values()).sort((a, b) => (
    resourceGroupRank(a.id) - resourceGroupRank(b.id)
      || a.label.localeCompare(b.label)
  ));
}

function collectResourceFlowPaths(node: BreakdownNode): BreakdownNode[][] {
  const children = node.children.filter((child) => child.count > 0);

  if (children.length === 0) return [[node]];

  return children.flatMap((child) => (
    collectResourceFlowPaths(child).map((path) => [...path, node])
  ));
}

function resourceGroupForTree(node: BreakdownNode): { id: string; label: string; tone: string } {
  const ids = flattenResourceTreeIds(node);
  const wood = woodTypeOrder.find((candidate) => (
    ids.some((id) => {
      const normalized = id.replace(/^minecraft:/, '');
      return normalized === candidate
        || normalized.startsWith(`${candidate}_`)
        || normalized.includes(`_${candidate}_`);
    })
  ));

  if (wood) {
    return {
      id: wood,
      label: formatBlockName(wood).toLocaleUpperCase(),
      tone: 'wood',
    };
  }

  const category = shoppingCategoryForMaterial(node.id);
  return {
    id: category.id,
    label: category.label.toLocaleUpperCase(),
    tone: category.id,
  };
}

function flattenResourceTreeIds(node: BreakdownNode): string[] {
  return [node.id, ...node.children.flatMap(flattenResourceTreeIds)];
}

function resourceGroupRank(id: string): number {
  const woodRank = woodTypeOrder.indexOf(id);
  if (woodRank >= 0) return woodRank;

  return woodTypeOrder.length + shoppingCategoryRank(id);
}

function groupShoppingMaterials(materials: MaterialSummary[]): ShoppingMaterialGroup[] {
  const groups = new Map<string, ShoppingMaterialGroup>();
  for (const material of materials) {
    const category = shoppingCategoryForMaterial(material.id);
    const group = groups.get(category.id) ?? { ...category, materials: [] };
    group.materials.push(material);
    groups.set(category.id, group);
  }

  return Array.from(groups.values()).sort((a, b) => (
    shoppingCategoryRank(a.id) - shoppingCategoryRank(b.id)
      || a.label.localeCompare(b.label)
  ));
}

function shoppingCategoryForMaterial(materialId: string): { id: string; label: string } {
  const id = stripBlockStateProperties(materialId).replace(/^minecraft:/, '');
  if (woodTypeOrder.some((wood) => id.includes(wood))) return { id: 'wood', label: 'Wood' };
  if (id.includes('stone') || id.includes('deepslate') || id.includes('tuff') || id.includes('brick')
    || id.includes('andesite') || id.includes('diorite') || id.includes('granite') || id.includes('basalt')
    || id.includes('blackstone') || id.includes('quartz') || id.includes('sandstone') || id === 'cobblestone'
    || id === 'netherrack' || id === 'end_stone' || id === 'obsidian') {
    return { id: 'stone', label: 'Stone' };
  }
  if (id.includes('glass') || id.includes('pane')) return { id: 'glass', label: 'Glass' };
  if (id.includes('redstone') || id.includes('repeater') || id.includes('comparator') || id.includes('piston')
    || id.includes('observer') || id.includes('hopper') || id.includes('rail') || id.includes('lever')
    || id.includes('button') || id.includes('pressure_plate') || id.includes('dispenser') || id.includes('dropper')) {
    return { id: 'redstone', label: 'Redstone' };
  }
  if (id.includes('leaves') || id.includes('sapling') || id.includes('grass') || id.includes('dirt')
    || id.includes('flower') || id.includes('moss') || id.includes('sand') || id.includes('gravel')
    || id.includes('coral') || id.includes('vine') || id.includes('fern')) {
    return { id: 'nature', label: 'Nature' };
  }
  if (id.includes('torch') || id.includes('lantern') || id.includes('chest') || id.includes('barrel')
    || id.includes('furnace') || id.includes('crafting_table') || id.includes('anvil') || id.includes('bed')
    || id.includes('door') || id.includes('ladder') || id.includes('scaffolding')) {
    return { id: 'utility', label: 'Utility' };
  }
  if (dyeColorOrder.some((color) => id.includes(color)) || id.includes('terracotta') || id.includes('concrete')
    || id.includes('wool') || id.includes('banner') || id.includes('carpet') || id.includes('candle')) {
    return { id: 'decorative', label: 'Color & Decor' };
  }
  return { id: 'other', label: 'Other' };
}

function shoppingCategoryRank(id: string): number {
  return ['wood', 'stone', 'glass', 'redstone', 'nature', 'utility', 'decorative', 'other'].indexOf(id);
}

function materialQuantityForBlock(block: VoxelBlock): number {
  if (isDoorStateKey(block.stateKey) && parseStateKey(block.stateKey)?.properties.half === 'upper') return 0;
  if (isBedStateKey(block.stateKey) && parseStateKey(block.stateKey)?.properties.part === 'head') return 0;
  if (isPistonHeadStateKey(block.stateKey)) return 0;
  return isDoubleSlabStateKey(block.stateKey) ? 2 : 1;
}

function materialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] | undefined {
  if (isBedStateKey(stateKey)) return bedMaterialThumbnailLayers(stateKey);
  if (isDoorStateKey(stateKey)) return doorMaterialThumbnailLayers(stateKey);
  if (isTallGrassStateKey(stateKey)) return tallGrassMaterialThumbnailLayers(stateKey);
  if (isPitcherCropStateKey(stateKey)) return pitcherCropMaterialThumbnailLayers(stateKey);
  return undefined;
}

function doorMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
  const baseState = stripBlockStateProperties(stateKey);
  const parsed = parseStateKey(stateKey);
  const doorProperties = {
    facing: parsed?.properties.facing ?? 'north',
    hinge: parsed?.properties.hinge ?? 'left',
    open: parsed?.properties.open ?? 'false',
  };

  return [
    { stateKey: withBlockStateProperties(baseState, { ...doorProperties, half: 'lower' }) },
    { stateKey: withBlockStateProperties(baseState, { ...doorProperties, half: 'upper' }), offset: [0, 1, 0] },
  ];
}

function bedMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
  const baseState = stripBlockStateProperties(stateKey);
  const parsed = parseStateKey(stateKey);
  const thumbnailFacing = 'west';
  const bedProperties = {
    facing: thumbnailFacing,
    occupied: parsed?.properties.occupied ?? 'false',
  };

  return [
    { stateKey: withBlockStateProperties(baseState, { ...bedProperties, part: 'foot' }) },
    {
      stateKey: withBlockStateProperties(baseState, { ...bedProperties, part: 'head' }),
      offset: bedHeadOffset(thumbnailFacing),
    },
  ];
}

function pitcherCropMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
  const baseState = stripBlockStateProperties(stateKey);
  const parsed = parseStateKey(stateKey);
  const age = parsed?.properties.age ?? '4';

  return [
    { stateKey: withBlockStateProperties(baseState, { age, half: 'lower' }) },
    { stateKey: withBlockStateProperties(baseState, { age, half: 'upper' }), offset: [0, 1, 0] },
  ];
}

function tallGrassMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
  const baseState = stripBlockStateProperties(stateKey);

  return [
    { stateKey: withBlockStateProperties(baseState, { half: 'lower' }) },
    { stateKey: withBlockStateProperties(baseState, { half: 'upper' }), offset: [0, 1, 0] },
  ];
}

function isPitcherCropStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey) === 'minecraft:pitcher_crop';
}

function isPistonHeadStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey) === 'minecraft:piston_head';
}

function isTallGrassStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey) === 'minecraft:tall_grass';
}

function bedHeadOffset(facing: string): [number, number, number] {
  switch (facing) {
    case 'north':
      return [0, 0, -1];
    case 'east':
      return [1, 0, 0];
    case 'west':
      return [-1, 0, 0];
    case 'south':
    default:
      return [0, 0, 1];
  }
}

function isDoubleSlabStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey).replace(/^minecraft:/, '').endsWith('_slab')
    && parseStateKey(stateKey)?.properties.type === 'double';
}

function isDoorStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id.endsWith('_door') && !id.endsWith('_trapdoor');
}

function isWallSignStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id.endsWith('_wall_sign');
}

function isWallHangingSignStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id.endsWith('_wall_hanging_sign');
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
  const blockId = stripBlockStateProperties(id);

  return blockId
    .replace(/^minecraft:/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function MaterialBreakdown({ materialId, count }: { materialId: string; count: number }) {
  const breakdown = storageBreakdown(materialId, count);
  const label = `${count.toLocaleString()} items: ${breakdown.stacks.toLocaleString()} stacks of ${breakdown.stackSize.toLocaleString()} plus ${breakdown.remainder.toLocaleString()} items, ${breakdown.shulkerBoxes} shulker boxes`;

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

function RecipeTree({ node }: { node: BreakdownNode }) {
  if (node.isRaw || node.children.length === 0) {
    return (
      <div className="recipe-tree is-leaf">
        <span>Counted as raw</span>
      </div>
    );
  }

  return (
    <div className="recipe-tree" aria-label={`${formatBlockName(node.id)} recipe tree`}>
      <div className="recipe-tree-heading">
        <Hammer size={14} aria-hidden="true" />
        <span>{node.recipeUsed ? recipeTypeLabel(node.recipeUsed.type) : 'Recipe'}</span>
        {node.surplus ? <strong>+{formatQuantity(node.surplus)} surplus</strong> : null}
      </div>
      <div className="recipe-tree-children">
        {node.children.map((child) => (
          <RecipeTreeRow node={child} key={`${child.id}:${child.count}`} depth={0} />
        ))}
      </div>
    </div>
  );
}

function RecipeTreeRow({ node, depth }: { node: BreakdownNode; depth: number }) {
  const stateKey = recipeItemStateKey(node.id);
  const preview = createVoxelBlock(0, 0, 0, stateKey);

  return (
    <div className="recipe-tree-row-wrap">
      <div className="recipe-tree-row" style={{ '--recipe-depth': depth } as CSSProperties}>
        <BlockPreview stateKey={stateKey} color={preview.color} />
        <span>{formatBlockName(node.id)}</span>
        <strong>{formatQuantity(node.count)}</strong>
        <small>{node.isRaw ? 'Raw' : node.recipeUsed ? recipeTypeLabel(node.recipeUsed.type) : 'Recipe'}</small>
      </div>
      {!node.isRaw && node.children.length > 0 && (
        <div className="recipe-tree-branch">
          {node.children.map((child) => (
            <RecipeTreeRow node={child} key={`${child.id}:${child.count}:${depth}`} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceCalculatorBoard({
  schematicName,
  activeMaterialsLabel,
  activeMaterials,
  rawMaterials,
  resourceStats,
  filteredRecipeTrees,
  shoppingSearch,
  setShoppingSearch,
  materialsScope,
  setMaterialsScope,
  cuboidBounds,
  beginCuboidSelection,
  setAppView,
  setInspectorTab,
  integerCrafting,
  setIntegerCrafting,
  openInspectorPanel,
}: {
  schematicName: string;
  activeMaterialsLabel: string;
  activeMaterials: MaterialSummary[];
  rawMaterials: MaterialSummary[];
  resourceStats: ResourceCalculatorStats;
  filteredRecipeTrees: BreakdownNode[];
  shoppingSearch: string;
  setShoppingSearch: (value: string) => void;
  materialsScope: MaterialsScope;
  setMaterialsScope: (scope: MaterialsScope) => void;
  cuboidBounds: CuboidBounds | null;
  beginCuboidSelection: () => void;
  setAppView: (view: AppView) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  integerCrafting: boolean;
  setIntegerCrafting: (value: boolean) => void;
  openInspectorPanel: (tab: InspectorTab) => void;
}) {
  return (
    <section className="resource-board" aria-label="Resource Calculator">
      <aside className="resource-sidebar" aria-label="Resource summary">
        <div className="resource-file-card">
          <p className="eyebrow">Schematic</p>
          <strong>{schematicName}</strong>
          <span>{activeMaterialsLabel}</span>
        </div>

        <div className="resource-output-card">
          <p className="eyebrow">Total Output</p>
          <strong>{resourceStats.totalOutputItems.toLocaleString()}</strong>
          <span>Total crafted items</span>
        </div>

        <dl className="resource-stat-list">
          <div>
            <dt>Total Items</dt>
            <dd>{resourceStats.totalOutputItems.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Unique Items</dt>
            <dd>{resourceStats.uniqueOutputItems.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Crafting Steps</dt>
            <dd>{resourceStats.craftingSteps.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Chests Needed</dt>
            <dd>{resourceStats.chestsNeeded.toLocaleString()}</dd>
          </div>
        </dl>

        <ResourceMaterialSummary
          title="Final Materials"
          materials={activeMaterials}
          emptyLabel="No final materials."
        />

        <ResourceMaterialSummary
          title="Base Ingredients"
          materials={rawMaterials}
          emptyLabel="No base ingredients."
        />
      </aside>

      <section className="resource-tree-panel" aria-label="Dependency tree">
        <div className="resource-tree-header">
          <div>
            <p className="eyebrow">Dependency Tree</p>
            <h2>Resource Calculator</h2>
          </div>
          <div className="resource-tree-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => openInspectorPanel('materials')}
            >
              <Cuboid size={16} />
              Materials
            </button>
          </div>
        </div>

        <div className="resource-toolbar">
          <div className="segmented-control shopping-scope" role="group" aria-label="Resource Calculator scope">
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
                  setAppView('inspect');
                  setInspectorTab('selection');
                }
              }}
            >
              Selected Area
            </button>
          </div>

          <label className="toggle-row compact-toggle">
            <input
              type="checkbox"
              checked={integerCrafting}
              onChange={(event) => setIntegerCrafting(event.target.checked)}
            />
            <span>Whole crafts</span>
          </label>

          <label className="material-search shopping-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={shoppingSearch}
              onChange={(event) => setShoppingSearch(event.target.value)}
              placeholder="Search dependencies"
              aria-label="Search dependencies"
            />
          </label>
        </div>

        <div className="resource-metrics">
          <div>
            <span>Raw Items</span>
            <strong>{resourceStats.rawMaterialItems.toLocaleString()}</strong>
          </div>
          <div>
            <span>Base Ingredients</span>
            <strong>{resourceStats.uniqueRawMaterials.toLocaleString()}</strong>
          </div>
          <div>
            <span>Crafting Steps</span>
            <strong>{resourceStats.craftingSteps.toLocaleString()}</strong>
          </div>
          <div>
            <span>Missing Recipes</span>
            <strong>{resourceStats.unresolvedItems.toLocaleString()}</strong>
          </div>
        </div>

        <div className="resource-tree-scroll">
          <ResourceDependencyGraph
            trees={filteredRecipeTrees}
            placedMaterials={activeMaterials}
          />

          {filteredRecipeTrees.length === 0 && (
            <p className="material-empty">
              {shoppingSearch.trim()
                ? `No dependencies match "${shoppingSearch.trim()}".`
                : 'No dependencies to show.'}
            </p>
          )}
        </div>
      </section>
    </section>
  );
}

function ResourceMaterialSummary({
  title,
  materials,
  emptyLabel,
}: {
  title: string;
  materials: MaterialSummary[];
  emptyLabel: string;
}) {
  return (
    <section className="resource-list-card" aria-label={title}>
      <div className="resource-list-heading">
        <span>{title}</span>
        <strong>{materials.length.toLocaleString()}</strong>
      </div>

      <div className="resource-mini-list">
        {materials.slice(0, 16).map((material) => (
          <div className="resource-mini-row" key={`${title}:${material.id}`}>
            <BlockPreview
              stateKey={material.stateKey}
              color={material.color}
              layers={material.thumbnailLayers}
            />
            <span>{material.label}</span>
            <strong>{formatQuantity(material.count)}</strong>
          </div>
        ))}

        {materials.length === 0 && <p>{emptyLabel}</p>}
        {materials.length > 16 && (
          <p className="resource-mini-more">+{(materials.length - 16).toLocaleString()} more</p>
        )}
      </div>
    </section>
  );
}

function ResourceDependencyGraph({
  trees,
  placedMaterials,
}: {
  trees: BreakdownNode[];
  placedMaterials: MaterialSummary[];
}) {
  const groups = useMemo(() => groupResourceDependencyTrees(trees), [trees]);

  return (
    <div className="resource-graph" aria-label="Material dependency graph">
      {groups.map((group) => (
        <section
          className={`resource-graph-group is-${group.tone}`}
          key={group.id}
          aria-label={`${group.label} dependencies`}
          style={{ '--resource-flow-columns': group.maxColumns } as CSSProperties}
        >
          <div className="resource-group-label">{group.label}</div>

          <div className="resource-flow-stack">
            {group.paths.map((path, index) => (
              <ResourceFlowRow
                key={`${group.id}:${index}:${path.map((node) => `${node.id}-${node.count}`).join('>')}`}
                path={path}
                maxColumns={group.maxColumns}
                placedMaterials={placedMaterials}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ResourceFlowRow({
  path,
  maxColumns,
  placedMaterials,
}: {
  path: BreakdownNode[];
  maxColumns: number;
  placedMaterials: MaterialSummary[];
}) {
  return (
    <div
      className="resource-flow-row"
      style={{ '--resource-flow-columns': maxColumns } as CSSProperties}
    >
      {path.map((node, index) => {
        const column = index + 1;
        const isTerminal = index === path.length - 1;

        return (
          <div
            className={`resource-flow-node${isTerminal ? ' is-terminal' : ''}`}
            key={`${node.id}:${node.count}:${index}`}
            style={{ gridColumn: column } as CSSProperties}
          >
            <ResourceFlowCard
              node={node}
              placedMaterials={placedMaterials}
              isTerminal={isTerminal}
            />
          </div>
        );
      })}
    </div>
  );
}

function ResourceFlowCard({
  node,
  placedMaterials,
  isTerminal,
}: {
  node: BreakdownNode;
  placedMaterials: MaterialSummary[];
  isTerminal: boolean;
}) {
  const material = materialSummaryForRecipeItem({ id: node.id, count: node.count }, placedMaterials);
  const crafts = node.recipeUsed
    ? (node.count + (node.surplus ?? 0)) / node.recipeUsed.output
    : 0;

  return (
    <article className={`resource-flow-card${node.isRaw ? ' is-raw' : ''}${isTerminal ? ' is-output' : ''}`}>
      <BlockPreview
        stateKey={material.stateKey}
        color={material.color}
        layers={material.thumbnailLayers}
      />

      <div className="resource-flow-copy">
        <strong>{material.label}</strong>
        <span>{formatQuantity(node.count)}</span>
        {node.recipeUsed ? (
          <small>
            {recipeTypeLabel(node.recipeUsed.type)} {formatQuantity(crafts)}x
            {node.surplus ? ` - +${formatQuantity(node.surplus)} surplus` : ''}
          </small>
        ) : (
          <small>Base ingredient</small>
        )}
      </div>

      {!node.isRaw && node.recipeUsed && (
        <span className="resource-recipe-pill">
          {node.recipeUsed.output}x
        </span>
      )}
    </article>
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

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
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
  const id = stripBlockStateProperties(materialId).replace(/^minecraft:/, '');
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
