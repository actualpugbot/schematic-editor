import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Box,
  Boxes,
  Braces,
  Brush,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Cuboid,
  DoorOpen,
  Download,
  Eraser,
  ExternalLink,
  EyeOff,
  FileUp,
  Flame,
  Focus,
  Grid2X2,
  ImageIcon,
  Layers,
  Lightbulb,
  List,
  MousePointer2,
  Moon,
  Move3d,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Replace,
  RotateCcw,
  RotateCw,
  Rotate3D,
  ScanSearch,
  Search,
  ShieldAlert,
  ShoppingCart,
  Siren,
  Skull,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  Waves,
  X,
} from 'lucide-react';
import {
  Viewer3D,
  type AxisGizmoOrientation,
  type CameraMode,
  type PlacementPoint,
  type SavedCameraPosition,
  type SelectionButton,
  type TextureAdjustmentMap,
  type TextureFaceHit,
  type Viewer3DHandle,
  textureAdjustmentKey,
} from './components/Viewer3D';
import { FeaturedBuilder } from './components/FeaturedBuilder';
import { MaterialList, type MaterialListItem } from './components/MaterialList';
import { ShoppingCelebration } from './components/ShoppingCelebration';
import {
  createBlockThumbnail,
  defaultBlockThumbnailResolution,
  getCachedBlockThumbnail,
  highDetailBlockThumbnailResolution,
  preloadBlockThumbnails,
  type BlockThumbnailLayer,
} from './lib/blockThumbnails';
import { alwaysMaterialSpriteStateKey } from './lib/materialSpriteOverrides';
import { loadMaterialSpriteLookup, materialSpriteTintForStateKey, materialSpriteUrlForStateKey } from './lib/materialSprites';
import { parseBlockStateKey as parseMinecraftBlockStateKey, textureUrl, type ModelFaceName } from './lib/minecraftModels';
import { writeNbt, type NbtDocument } from './lib/nbt';
import {
  canBreakDown,
  chooseRecipeIndex,
  defaultRecipeTypePreference,
  explodeMaterials,
  getRecipeBundle,
  getRecipes,
  loadRecipeBundle,
  normalizeRecipeItemId,
  recipeTypeLabel,
  type BreakdownNode,
  type BreakdownOptions,
  type Recipe,
  type RecipeType,
} from './lib/recipes';
import {
  createLegacySchematicDocument,
  createLitematicSchematicDocument,
  createSampleModel,
  createSpongeSchematicDocument,
  createStarterModel,
  createVoxelBlock,
  finalizeSchematicModel,
  parseSchematicDocument,
  renameSchematicDocument,
  type SchematicExportFormat,
  type PlayerHeadTexture,
  type SchematicModel,
  type VoxelBlock,
} from './lib/schematic';
import {
  describeNbt,
  runAudit,
  type AuditCategory,
  type AuditFinding,
  type NbtDisplayNode,
} from './lib/audit';
import allBlockIds from './lib/data/block_ids.generated.json';
import defaultSchematicUrl from '../mossy_roof_house.litematic?url';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type MaterialBaseMode = 'base' | 'craft';
interface MaterialBasePreferences {
  modes: Record<string, MaterialBaseMode>;
  recipes: Record<string, number>;
}
type DraggedFileKind = 'none' | 'unsupported-file' | 'unknown-file' | 'schematic-file';
type InspectorTab = 'selection' | 'materials' | 'layers';
type EditPanelTab = 'tools' | 'rotate' | 'replace';
type AppView = 'inspect' | 'edit' | 'texture' | 'shopping' | 'shulker' | 'resource' | 'audit' | 'thumbnail-debug';
type EditTool = 'select' | 'build';
type Theme = 'light' | 'dark';
type SchematicOrigin = 'default' | 'uploaded' | 'new';
type MaterialsScope = 'build' | 'cuboid';
type ShoppingLayout = 'grid' | 'list';
type ShulkerViewMode = 'box' | 'type';
type ThumbnailLoadState = 'idle' | 'loading' | 'ready' | 'failed';
type CuboidCornerId = 'a' | 'b';
type Direction = 'up' | 'down' | 'north' | 'south' | 'west' | 'east';
type RotationDirection = 'clockwise' | 'counterclockwise';
type ControlRailSide = 'left' | 'right';

const UV_VIEW_ENABLED = false;
const THUMBNAIL_DEBUG_ENABLED = false;
// TEMPORARY: in-list thumbnail tuning tools (per-row rotate, floating "copy
// adjustments JSON", and an all-blocks test loader). Flip to false (or delete the
// gated blocks) once the captured adjustments are baked into
// thumbnail_display_adjustments.json.
const TEMP_THUMBNAIL_TOOLS = true;

/** Sentinel picker value meaning "use each occurrence's recommended replacement". */
const AUDIT_RECOMMENDED = '__recommended__';

type AuditIcon = typeof ScanSearch;

/** Section icon per audit category id; falls back to a generic block icon. */
const auditCategoryIcons: Record<string, AuditIcon> = {
  command_block: Terminal,
  structure_block: Boxes,
  spawner: Skull,
  beacon: Sparkles,
  light: Lightbulb,
  barrier: EyeOff,
  infested: Bug,
  bubble_column: Waves,
  nether_portal: Flame,
  end_portal: DoorOpen,
  jigsaw: Cuboid,
  sculk_shrieker: Siren,
  piston: Move3d,
  structure_void: EyeOff,
};

function auditCategoryIcon(category: AuditCategory): AuditIcon {
  return auditCategoryIcons[category.id] ?? Cuboid;
}

/** Renders a parsed block-entity NBT compound as an indented, read-only tree. */
function NbtTree({ nodes, depth = 0 }: { nodes: NbtDisplayNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node, index) => (
        <div key={`${depth}-${node.key}-${index}`} className="audit-nbt-row" style={{ paddingLeft: depth * 12 }}>
          <span className="audit-nbt-key">{node.key}</span>
          <span className="audit-nbt-type">{node.type}</span>
          {node.value !== undefined && <span className="audit-nbt-value">{node.value}</span>}
          {node.children && node.children.length > 0 && <NbtTree nodes={node.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}
const defaultExportFormat: SchematicExportFormat = '.litematic';
const defaultSchematicFileName = 'mossy_roof_house.litematic';
const defaultSchematicName = 'Mossy Roof House';
const exportFormatOptions: Array<{
  value: SchematicExportFormat;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: '.litematic',
    label: 'Litematic (.litematic)',
    shortLabel: 'Litematic',
    description: 'Best for modern Litematica builds and round-tripping edits.',
  },
  {
    value: '.schem',
    label: 'Sponge (.schem)',
    shortLabel: 'Sponge',
    description: 'Good for Sponge-compatible tools and newer schematic workflows.',
  },
  {
    value: '.schematic',
    label: 'Legacy (.schematic)',
    shortLabel: 'Legacy',
    description: 'Older MCEdit-style export with limited block-state support.',
  },
];

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

interface SelectionArea {
  id: string;
  name: string;
  corners: CuboidCorners;
  updatedAt: number;
}

interface SavedCameraView {
  id: string;
  name: string;
  position: SavedCameraPosition;
  isDefault: boolean;
  updatedAt: number;
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
  // Canonical, canvas-independent state key used to render the material's
  // thumbnail (and look up its display adjustment). See materialDisplayStateKey.
  displayStateKey: string;
  thumbnailLayers?: BlockThumbnailLayer[];
}

interface ShoppingMaterialGroup {
  id: string;
  label: string;
  materials: MaterialSummary[];
}

interface ShulkerStack {
  material: MaterialSummary;
  count: number;
}

interface ShulkerBoxPlan {
  id: string;
  label: string;
  groupLabel: string;
  color: string;
  slots: Array<ShulkerStack | null>;
  slotKeys: Array<string | null>;
  filledSlotKeys: string[];
  itemCount: number;
  usedSlots: number;
}

type ShulkerBoxPlanCache = Record<ShulkerViewMode, ShulkerBoxPlan[]>;
type ShulkerVisibleBoxCounts = Record<ShulkerViewMode, number>;

interface ThumbnailDisplayAdjustment {
  scale: number;
  rotateX: number;
  rotateY: number;
  previewStateKey?: string;
  previewLayers?: BlockThumbnailLayer[];
}

type ThumbnailDisplayAdjustmentMap = Record<string, ThumbnailDisplayAdjustment>;

interface ThumbnailDebugItem {
  key: string;
  stateKey: string;
  label: string;
  color: number;
  category: string;
  family: 'block' | 'item';
  layers?: BlockThumbnailLayer[];
  sources: string[];
}

interface ThumbnailPreviewRequest {
  stateKey: string;
  layers?: BlockThumbnailLayer[];
}

type ThumbnailOrientationMode = 'facing' | 'horizontal_facing' | 'rotation' | 'axis' | null;

interface ThumbnailOrientationSummary {
  mode: ThumbnailOrientationMode;
  value: string | null;
  label: string | null;
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
const themeStorageKey = 'build-planner-theme';
const leftRailCollapsedStorageKey = 'build-planner-left-rail-collapsed';
const controlRailSideStorageKey = 'build-planner-control-rail-side';
const stageBackgroundColorStorageKey = 'build-planner-stage-background-color';
const materialBaseStorageKey = 'build-planner-material-bases';
const shoppingListStoragePrefix = 'build-planner-shopping-list';
const shulkerViewStoragePrefix = 'build-planner-shulker-view';
const selectionStoragePrefix = 'build-planner-selections';
const cameraStoragePrefix = 'build-planner-cameras';
const legacyStoragePrefix = 'schematic-editor-';
const storagePrefix = 'build-planner-';

// One-time rebrand migration: copy any saved state from the old `schematic-editor-`
// keys (theme, saved cameras, selections, shopping/shulker lists) onto the new
// `build-planner-` keys so existing users keep their settings. Runs at module load,
// before any state initializer reads storage. Legacy keys are left in place.
function migrateLegacyStorage(): void {
  try {
    const storage = window.localStorage;
    const migratedFlag = `${storagePrefix}storage-migrated`;
    if (storage.getItem(migratedFlag) === '1') return;

    const legacyKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(legacyStoragePrefix)) {
        legacyKeys.push(key);
      }
    }

    for (const legacyKey of legacyKeys) {
      const nextKey = `${storagePrefix}${legacyKey.slice(legacyStoragePrefix.length)}`;
      // Don't clobber anything the rebranded app has already written.
      if (storage.getItem(nextKey) === null) {
        const value = storage.getItem(legacyKey);
        if (value !== null) {
          storage.setItem(nextKey, value);
        }
      }
    }

    storage.setItem(migratedFlag, '1');
  } catch {
    // localStorage can be unavailable (privacy mode); skip migration silently.
  }
}

migrateLegacyStorage();

const emptyBuildBlock = 'minecraft:air';
const shulkerInventorySlots = 27;
const shulkerConsolidationSlotThreshold = Math.floor(shulkerInventorySlots / 2);
const initialShulkerBoxRenderCount = 4;
const shulkerBoxRenderBatchSize = 4;
const maxStackSize = 64;
const shulkerBoxThumbnailColors = [
  'white',
  'light_gray',
  'gray',
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'lime',
  'cyan',
  'light_blue',
  'blue',
  'purple',
  'magenta',
  'pink',
] as const;
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
const creativeCategoryOrder: CreativeCategoryId[] = [
  'building_blocks',
  'colored_blocks',
  'natural_blocks',
  'functional_blocks',
  'redstone_blocks',
  'tools_and_utilities',
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
const defaultThumbnailDisplayAdjustment: ThumbnailDisplayAdjustment = {
  scale: 1,
  rotateX: 0,
  rotateY: 0,
};
const lightStageBackgroundColor = '#f1f5f8';
const darkStageBackgroundColor = '#25303a';
const legacyLightStageBackgroundColor = '#f4f8f8';

function defaultStageBackgroundColor(theme: Theme): string {
  return theme === 'dark' ? darkStageBackgroundColor : lightStageBackgroundColor;
}

function normalizeHexColor(color: string): string {
  return color.trim().toLowerCase();
}
const thumbnailVerticalFacingBlockIds = new Set([
  'minecraft:amethyst_cluster',
  'minecraft:small_amethyst_bud',
  'minecraft:medium_amethyst_bud',
  'minecraft:large_amethyst_bud',
  'minecraft:calibrated_sculk_sensor',
  'minecraft:command_block',
  'minecraft:chain_command_block',
  'minecraft:crafter',
  'minecraft:dispenser',
  'minecraft:dropper',
  'minecraft:end_rod',
  'minecraft:hopper',
  'minecraft:lightning_rod',
  'minecraft:observer',
  'minecraft:piston',
  'minecraft:piston_head',
  'minecraft:repeating_command_block',
  'minecraft:sticky_piston',
  'minecraft:trial_spawner',
  'minecraft:vault',
]);
type CreativeInventoryData = typeof import('./lib/data/creative_inventory.json');

let creativeInventoryData: CreativeInventoryData | null = null;
let creativeInventoryKeywordOrderCache: Record<CreativeCategoryId, string[]> | null = null;
let loadedThumbnailDisplayAdjustments: ThumbnailDisplayAdjustmentMap = {};
let appDataPromise: Promise<void> | null = null;

function loadMaterialBasePreferences(): MaterialBasePreferences {
  const empty: MaterialBasePreferences = { modes: {}, recipes: {} };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(materialBaseStorageKey);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<MaterialBasePreferences>;
    const modes: Record<string, MaterialBaseMode> = {};
    for (const [id, mode] of Object.entries(parsed.modes ?? {})) {
      if (mode === 'base' || mode === 'craft') modes[id] = mode;
    }
    const recipes: Record<string, number> = {};
    for (const [id, index] of Object.entries(parsed.recipes ?? {})) {
      if (typeof index === 'number' && Number.isInteger(index) && index >= 0) recipes[id] = index;
    }
    return { modes, recipes };
  } catch {
    return empty;
  }
}

// The recipe/inventory/thumbnail data is only needed after first paint, so it is
// code-split out of the entry chunk and fetched eagerly in the background.
function loadAppData(): Promise<void> {
  appDataPromise ??= Promise.all([
    import('./lib/data/creative_inventory.json').then((module) => {
      creativeInventoryData = module.default;
      creativeInventoryKeywordOrderCache = null;
    }),
    import('./lib/data/thumbnail_display_adjustments.json').then((module) => {
      loadedThumbnailDisplayAdjustments = module.default as unknown as ThumbnailDisplayAdjustmentMap;
    }),
    loadRecipeBundle(),
    loadMaterialSpriteLookup(),
  ]).then(() => undefined);
  return appDataPromise;
}

void loadAppData();

const ThumbnailDisplayAdjustmentsContext = createContext<ThumbnailDisplayAdjustmentMap>({});
const blockPreviewVisibilityRootMargin = '420px';
const blockPreviewVisibilityCallbacks = new Map<Element, () => void>();
let blockPreviewVisibilityObserver: IntersectionObserver | null = null;

function observeBlockPreviewVisibility(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return () => {};
  }

  if (!blockPreviewVisibilityObserver) {
    blockPreviewVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = blockPreviewVisibilityCallbacks.get(entry.target);
        if (!callback) continue;
        blockPreviewVisibilityCallbacks.delete(entry.target);
        blockPreviewVisibilityObserver?.unobserve(entry.target);
        callback();
      }
    }, { rootMargin: blockPreviewVisibilityRootMargin });
  }

  blockPreviewVisibilityCallbacks.set(element, onVisible);
  blockPreviewVisibilityObserver.observe(element);

  return () => {
    blockPreviewVisibilityCallbacks.delete(element);
    blockPreviewVisibilityObserver?.unobserve(element);
  };
}

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
const scrollbarVisibilityDurationMs = 900;

function useTransientScrollbarVisibility() {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    let hideTimer: ReturnType<typeof window.setTimeout> | undefined;

    const showScrollbars = () => {
      root.dataset.scrollbarsVisible = 'true';
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        delete root.dataset.scrollbarsVisible;
        hideTimer = undefined;
      }, scrollbarVisibilityDurationMs);
    };

    window.addEventListener('scroll', showScrollbars, { capture: true, passive: true });

    return () => {
      window.removeEventListener('scroll', showScrollbars, { capture: true });
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      delete root.dataset.scrollbarsVisible;
    };
  }, []);
}

function App() {
  useTransientScrollbarVisibility();

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const savedTheme = window.localStorage.getItem(themeStorageKey);
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(leftRailCollapsedStorageKey) === 'true';
  });
  const [controlRailSide, setControlRailSide] = useState<ControlRailSide>(() => {
    if (typeof window === 'undefined') return 'right';
    return window.localStorage.getItem(controlRailSideStorageKey) === 'left' ? 'left' : 'right';
  });
  const [stageBackgroundColor, setStageBackgroundColor] = useState(() => {
    if (typeof window === 'undefined') return defaultStageBackgroundColor(theme);
    const savedColor = window.localStorage.getItem(stageBackgroundColorStorageKey);
    if (savedColor && /^#[0-9a-f]{6}$/i.test(savedColor)) {
      const normalized = normalizeHexColor(savedColor);
      return normalized === legacyLightStageBackgroundColor
        ? defaultStageBackgroundColor(theme)
        : normalized;
    }
    return defaultStageBackgroundColor(theme);
  });
  const [model, setModel] = useState<SchematicModel | null>(null);
  const [schematicOrigin, setSchematicOrigin] = useState<SchematicOrigin>('default');
  const [appView, setAppView] = useState<AppView>('inspect');
  const [auditReplaceChoice, setAuditReplaceChoice] = useState<Record<string, string>>({});
  const [expandedAuditGroups, setExpandedAuditGroups] = useState<Set<string>>(() => new Set());
  const [openAuditNbt, setOpenAuditNbt] = useState<Set<string>>(() => new Set());
  const [schematicName, setSchematicName] = useState('');
  const [isEditingSchematicName, setIsEditingSchematicName] = useState(false);
  const [schematicDocument, setSchematicDocument] = useState<NbtDocument | null>(null);
  const [schematicExtension, setSchematicExtension] = useState('.litematic');
  const [exportFormat, setExportFormat] = useState<SchematicExportFormat>(defaultExportFormat);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [hasEditChanges, setHasEditChanges] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadProgressMessage, setLoadProgressMessage] = useState('Loading featured schematic...');
  const [error, setError] = useState('');
  const [visibleBottomLayer, setVisibleBottomLayer] = useState(0);
  const [visibleTopLayer, setVisibleTopLayer] = useState(model?.dimensions.height ? model.dimensions.height - 1 : 0);
  const [singleVisibleLayer, setSingleVisibleLayer] = useState(0);
  const [renderedVisibleBottomLayer, setRenderedVisibleBottomLayer] = useState(0);
  const [renderedVisibleTopLayer, setRenderedVisibleTopLayer] = useState(model?.dimensions.height ? model.dimensions.height - 1 : 0);
  const [showGrid, setShowGrid] = useState(true);
  const [selectedBlock, setSelectedBlock] = useState<VoxelBlock | null>(null);
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(() => new Set());
  const [materialSearch, setMaterialSearch] = useState('');
  const [selectionMaterialSearch, setSelectionMaterialSearch] = useState('');
  const [layerMaterialSearch, setLayerMaterialSearch] = useState('');
  const [thumbnailDebugSearch, setThumbnailDebugSearch] = useState('');
  const [thumbnailDisplayAdjustments, setThumbnailDisplayAdjustments] = useState<ThumbnailDisplayAdjustmentMap>(
    loadedThumbnailDisplayAdjustments,
  );
  const [appDataVersion, setAppDataVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadAppData().then(() => {
      if (cancelled) return;
      setThumbnailDisplayAdjustments(loadedThumbnailDisplayAdjustments);
      setAppDataVersion((version) => version + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [selectedThumbnailDebugKey, setSelectedThumbnailDebugKey] = useState('');
  const [thumbnailAdjustmentsCopied, setThumbnailAdjustmentsCopied] = useState(false);
  const [hiddenMaterialIds, setHiddenMaterialIds] = useState<Set<string>>(() => new Set());
  const integerCrafting = true;
  const [materialBaseModes, setMaterialBaseModes] = useState<Map<string, MaterialBaseMode>>(
    () => new Map(Object.entries(loadMaterialBasePreferences().modes)),
  );
  const [recipeChoices, setRecipeChoices] = useState<Map<string, number>>(
    () => new Map(Object.entries(loadMaterialBasePreferences().recipes)),
  );
  const [shoppingSearch, setShoppingSearch] = useState('');
  const [shoppingLayout, setShoppingLayout] = useState<ShoppingLayout>('grid');
  const [collapsedShoppingGroups, setCollapsedShoppingGroups] = useState<Set<string>>(() => new Set());
  const [shulkerViewMode, setShulkerViewMode] = useState<ShulkerViewMode>('box');
  const [shulkerTypeAutoConsolidated, setShulkerTypeAutoConsolidated] = useState(false);
  const [collapsedShulkerBoxes, setCollapsedShulkerBoxes] = useState<Set<string>>(() => new Set());
  const [visibleShulkerBoxCounts, setVisibleShulkerBoxCounts] = useState<ShulkerVisibleBoxCounts>(() => ({
    box: initialShulkerBoxRenderCount,
    type: initialShulkerBoxRenderCount,
  }));
  const [checkedPlanSteps, setCheckedPlanSteps] = useState<Set<string>>(() => new Set());
  const [checkedShoppingItems, setCheckedShoppingItems] = useState<Set<string>>(() => new Set());
  const [checkedShulkerSlots, setCheckedShulkerSlots] = useState<Set<string>>(() => new Set());
  const [playerHeadSelections, setPlayerHeadSelections] = useState<Record<string, string>>({});
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('materials');
  const [editPanelTab, setEditPanelTab] = useState<EditPanelTab>('tools');
  const [cuboidSelectionMode, setCuboidSelectionMode] = useState(false);
  const [cuboidCorners, setCuboidCorners] = useState<CuboidCorners>(() => emptyCuboidCorners());
  const [selectionAreas, setSelectionAreas] = useState<SelectionArea[]>([]);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null);
  const [selectionUndoStack, setSelectionUndoStack] = useState<CuboidCorners[]>([]);
  const [editUndoStack, setEditUndoStack] = useState<SchematicModel[]>([]);
  const [savedCameraViews, setSavedCameraViews] = useState<SavedCameraView[]>([]);
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
  const thumbnailAdjustmentsCopiedTimeoutRef = useRef<number | null>(null);
  const layerPanelRef = useRef<HTMLElement | null>(null);
  const schematicNameInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [celebrationView, setCelebrationView] = useState<'shopping' | 'shulker' | null>(null);
  const skipNextShoppingPersistRef = useRef(false);
  const skipNextShulkerPersistRef = useRef(false);
  const skipNextSelectionPersistRef = useRef(false);
  const skipNextCameraPersistRef = useRef(false);
  const pendingCameraPositionRef = useRef<SavedCameraPosition | null>(null);
  const prevShoppingProgressRef = useRef(0);
  const prevShoppingStorageRef = useRef('');
  const prevShulkerProgressRef = useRef(0);
  const prevShulkerStorageRef = useRef('');
  const shulkerLoadMoreRef = useRef<HTMLParagraphElement | null>(null);
  const dragDepthRef = useRef(0);
  const visibleLayerFrameRef = useRef<number | null>(null);
  const pendingVisibleLayerRangeRef = useRef<{ bottomLayer: number; topLayer: number; singleLayer: number } | null>(null);
  const visibleBottomWorldY = model ? model.origin.y + visibleBottomLayer : visibleBottomLayer;
  const visibleTopWorldY = model ? model.origin.y + visibleTopLayer : visibleTopLayer;
  const selectedBlockWorldX = selectedBlock && model ? model.origin.x + selectedBlock.x : null;
  const selectedBlockWorldY = selectedBlock && model ? model.origin.y + selectedBlock.y : null;
  const selectedBlockWorldZ = selectedBlock && model ? model.origin.z + selectedBlock.z : null;
  const spectatorSpeed = 11;
  const showUploadOverlay = isDraggingFile;
  const currentExportFormatOption = exportFormatOptions.find((option) => option.value === exportFormat) ?? exportFormatOptions[0];

  useEffect(() => () => {
    if (thumbnailAdjustmentsCopiedTimeoutRef.current !== null) {
      window.clearTimeout(thumbnailAdjustmentsCopiedTimeoutRef.current);
    }
    if (visibleLayerFrameRef.current !== null) {
      window.cancelAnimationFrame(visibleLayerFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isExportMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || exportMenuRef.current?.contains(target)) return;
      setIsExportMenuOpen(false);
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExportMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isExportMenuOpen]);

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
    return model.blocks.filter((block) =>
      block.y >= renderedVisibleBottomLayer
      && block.y <= renderedVisibleTopLayer
      && !hiddenMaterialIds.has(materialIdForBlock(block))
    ).length;
  }, [hiddenMaterialIds, model, renderedVisibleBottomLayer, renderedVisibleTopLayer]);

  const materials = useMemo<MaterialSummary[]>(() => {
    if (!model) return [];

    return [
      ...summarizeMaterials(model.blocks),
      ...summarizeExtraMaterials(model.extraMaterials),
    ].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
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

  const layerMaterials = useMemo<MaterialSummary[]>(() => {
    if (!model) return [];
    return summarizeMaterials(model.blocks.filter((block) =>
      block.y >= renderedVisibleBottomLayer
      && block.y <= renderedVisibleTopLayer
    ));
  }, [model, renderedVisibleBottomLayer, renderedVisibleTopLayer]);

  const activeMaterials = materialsScope === 'cuboid'
    ? cuboidMaterials
    : materials;
  const resourceCalculatorUrl = useMemo(() => resourceCalculatorUrlForMaterials(activeMaterials), [activeMaterials]);
  const breakdownOptions = useMemo<BreakdownOptions>(() => {
    const rawOverrides = new Set<string>();
    const craftOverrides = new Set<string>();
    for (const [id, mode] of materialBaseModes) {
      if (mode === 'base') rawOverrides.add(id);
      else if (mode === 'craft') craftOverrides.add(id);
    }
    return {
      rawOverrides,
      craftOverrides,
      recipeChoice: recipeChoices,
      recipeTypePreference: defaultRecipeTypePreference,
      integerCrafting,
    };
  }, [integerCrafting, materialBaseModes, recipeChoices]);
  const recipeBreakdown = useMemo(
    () => explodeMaterials(activeMaterials, breakdownOptions),
    [activeMaterials, appDataVersion, breakdownOptions],
  );
  const materialBaseOverrideCount = materialBaseModes.size + recipeChoices.size;
  const rawMaterials = useMemo<MaterialSummary[]>(() => (
    recipeBreakdown.raw.map((material) => materialSummaryForRecipeItem(material, activeMaterials))
  ), [activeMaterials, recipeBreakdown]);
  const craftPlan = useMemo(() => {
    const stepMap = new Map<string, { id: string; method: RecipeType; output: number; outputCount: number; inputs: Map<string, number> }>();
    const depthCache = new Map<string, number>();

    const visit = (node: BreakdownNode): number => {
      if (node.isRaw || !node.recipeUsed || node.children.length === 0) return 0;
      let maxChild = 0;
      for (const child of node.children) maxChild = Math.max(maxChild, visit(child));
      const depth = maxChild + 1;
      const existing = stepMap.get(node.id);
      if (existing) {
        existing.outputCount += node.count;
        for (const child of node.children) existing.inputs.set(child.id, (existing.inputs.get(child.id) ?? 0) + child.count);
      } else {
        const inputs = new Map<string, number>();
        for (const child of node.children) inputs.set(child.id, (inputs.get(child.id) ?? 0) + child.count);
        stepMap.set(node.id, { id: node.id, method: node.recipeUsed.type, output: node.recipeUsed.output, outputCount: node.count, inputs });
      }
      depthCache.set(node.id, Math.max(depthCache.get(node.id) ?? 0, depth));
      return depth;
    };

    for (const tree of recipeBreakdown.trees) visit(tree);

    const steps = [...stepMap.values()].map((step) => {
      const summary = materialSummaryForRecipeItem({ id: step.id, count: step.outputCount }, activeMaterials);
      const inputs = [...step.inputs.entries()].map(([id, count]) => {
        const inputSummary = materialSummaryForRecipeItem({ id, count }, activeMaterials);
        return { ...inputSummary, count };
      });
      return {
        ...summary,
        count: step.outputCount,
        method: step.method,
        crafts: Math.max(1, Math.ceil(step.outputCount / step.output)),
        inputs,
        depth: depthCache.get(step.id) ?? 1,
        category: shoppingCategoryForMaterial(step.id),
      };
    });

    steps.sort((a, b) => a.depth - b.depth || b.count - a.count);

    const byCategory = new Map<string, { id: string; label: string; steps: typeof steps }>();
    for (const step of steps) {
      const group = byCategory.get(step.category.id) ?? { id: step.category.id, label: step.category.label, steps: [] };
      group.steps.push(step);
      byCategory.set(step.category.id, group);
    }

    return { steps, groups: [...byCategory.values()] };
  }, [recipeBreakdown, activeMaterials]);
  const visibleMaterials = activeMaterials;
  const shoppingScope = useMemo(() => (
    model ? shoppingScopeKey(model, materialsScope, cuboidBounds) : 'none'
  ), [cuboidBoundsKey, materialsScope, model]);
  const shoppingStorage = useMemo(() => (
    model ? shoppingStorageKey(model, shoppingScope, activeMaterials) : ''
  ), [activeMaterials, model, shoppingScope]);
  const shoppingItemKeys = useMemo(() => (
    new Set(activeMaterials.map((material) => shoppingItemKey(shoppingScope, material)))
  ), [activeMaterials, shoppingScope]);
  const shoppingMaterials = useMemo(() => {
    const query = shoppingSearch.trim().toLocaleLowerCase();
    if (!query) return activeMaterials;

    return activeMaterials.filter((material) => {
      const label = material.label.toLocaleLowerCase();
      const id = material.id.toLocaleLowerCase();
      return label.includes(query) || id.includes(query);
    });
  }, [activeMaterials, shoppingSearch]);
  const shoppingGroups = useMemo(() => groupShoppingMaterials(shoppingMaterials), [shoppingMaterials]);
  const shulkerBoxPlanCache = useMemo<ShulkerBoxPlanCache>(() => ({
    box: packMaterialsIntoShulkerBoxes(activeMaterials, 'box'),
    type: packMaterialsIntoShulkerBoxes(activeMaterials, 'type'),
  }), [activeMaterials]);
  const shulkerBoxes = useMemo(() => {
    const boxes = shulkerBoxPlanCache[shulkerViewMode];
    if (shulkerViewMode !== 'type' || !shulkerTypeAutoConsolidated) return boxes;
    return consolidateLesserFilledShulkerBoxes(boxes);
  }, [shulkerBoxPlanCache, shulkerTypeAutoConsolidated, shulkerViewMode]);
  const shulkerConsolidatableBoxCount = useMemo(() => (
    shulkerBoxPlanCache.type.filter(isLesserFilledShulkerBox).length
  ), [shulkerBoxPlanCache.type]);
  const shulkerStorageMode = shulkerViewMode === 'type' && shulkerTypeAutoConsolidated
    ? 'type-consolidated'
    : shulkerViewMode;
  const shulkerStorage = useMemo(() => (
    model ? shulkerStorageKey(model, shoppingScope, shulkerStorageMode, activeMaterials) : ''
  ), [activeMaterials, model, shoppingScope, shulkerStorageMode]);
  const shulkerSlotKeys = useMemo(() => (
    new Set(
      shulkerBoxes.flatMap((box) => box.filledSlotKeys),
    )
  ), [shulkerBoxes]);
  const visibleShulkerBoxCount = Math.min(visibleShulkerBoxCounts[shulkerViewMode], shulkerBoxes.length);
  const visibleShulkerBoxes = useMemo(() => (
    shulkerBoxes.slice(0, visibleShulkerBoxCount)
  ), [shulkerBoxes, visibleShulkerBoxCount]);
  const visibleShulkerThumbnailQueue = useMemo(() => (
    visibleShulkerBoxes.flatMap((box) => (
      box.slots.flatMap((slot) => (slot && !alwaysMaterialSpriteStateKey(slot.material.displayStateKey)
        ? [{
          stateKey: slot.material.displayStateKey,
          color: slot.material.color,
          layers: slot.material.thumbnailLayers,
        }]
        : []))
    ))
  ), [visibleShulkerBoxes]);
  const shulkerFilledSlotCount = useMemo(() => (
    shulkerBoxes.reduce((sum, box) => sum + box.usedSlots, 0)
  ), [shulkerBoxes]);
  const checkedShulkerSlotCount = useMemo(() => (
    Array.from(shulkerSlotKeys).filter((slotKey) => checkedShulkerSlots.has(slotKey)).length
  ), [checkedShulkerSlots, shulkerSlotKeys]);
  const shulkerProgressPercent = shulkerFilledSlotCount > 0
    ? Math.round((checkedShulkerSlotCount / shulkerFilledSlotCount) * 100)
    : 0;
  const checkedShoppingMaterialCount = useMemo(() => (
    activeMaterials.filter((material) => checkedShoppingItems.has(shoppingItemKey(shoppingScope, material))).length
  ), [activeMaterials, checkedShoppingItems, shoppingScope]);
  const totalShoppingItems = useMemo(() => (
    activeMaterials.reduce((sum, material) => sum + material.count, 0)
  ), [activeMaterials]);
  const completedShoppingItems = useMemo(() => (
    activeMaterials.reduce((sum, material) => (
      checkedShoppingItems.has(shoppingItemKey(shoppingScope, material)) ? sum + material.count : sum
    ), 0)
  ), [activeMaterials, checkedShoppingItems, shoppingScope]);
  const remainingShoppingItems = Math.max(0, totalShoppingItems - completedShoppingItems);
  const shoppingProgressPercent = totalShoppingItems > 0
    ? Math.round((completedShoppingItems / totalShoppingItems) * 100)
    : 0;
  const filteredMaterials = useMemo(() => {
    return filterMaterials(visibleMaterials, materialSearch);
  }, [materialSearch, visibleMaterials]);
  const filteredCuboidMaterials = useMemo(() => (
    filterMaterials(cuboidMaterials, selectionMaterialSearch)
  ), [cuboidMaterials, selectionMaterialSearch]);
  const filteredLayerMaterials = useMemo(() => (
    filterMaterials(layerMaterials, layerMaterialSearch)
  ), [layerMaterials, layerMaterialSearch]);

  const cuboidDimensions = cuboidBounds ? dimensionsForBounds(cuboidBounds) : null;

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
    const fromModel = model?.blocks.map((block) => materialIdForBlock(block)) ?? [];
    const allBlocks = new Set([...commonBuildBlocks, ...fromModel, ...allBlockIds]);

    return Array.from(allBlocks).sort(compareBlockLibraryItems);
  }, [appDataVersion, model]);

  const auditFindings = useMemo<AuditFinding[]>(() => (model ? runAudit(model) : []), [model]);
  const auditFlaggedCount = useMemo(
    () => auditFindings.reduce((total, finding) => total + finding.occurrences.length, 0),
    [auditFindings],
  );

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
  const blockLibraryStateKeys = useMemo(() => new Set(blockLibraryItems.map((item) => item.stateKey)), [blockLibraryItems]);
  const recipeThumbnailStateKeys = useMemo(() => {
    const bundle = getRecipeBundle();
    if (!bundle) return [];
    const itemIds = new Set<string>();

    for (const [outputId, recipes] of Object.entries(bundle.recipes)) {
      itemIds.add(normalizeRecipeItemId(outputId));
      for (const recipe of recipes) {
        for (const inputId of Object.keys(recipe.inputs)) {
          itemIds.add(normalizeRecipeItemId(inputId));
        }
      }
    }

    for (const rawId of bundle.raw) {
      itemIds.add(normalizeRecipeItemId(rawId));
    }

    return Array.from(itemIds, (id) => recipeItemStateKey(id)).sort((a, b) => a.localeCompare(b));
  }, [appDataVersion]);
  const thumbnailDebugItems = useMemo<ThumbnailDebugItem[]>(() => {
    const entries = new Map<string, ThumbnailDebugItem & { sourceSet: Set<string> }>();
    const upsertItem = (
      stateKey: string,
      {
        label,
        family,
        category,
        source,
        layers,
      }: {
        label: string;
        family: 'block' | 'item';
        category: string;
        source: string;
        layers?: BlockThumbnailLayer[];
      },
    ) => {
      const key = thumbnailDisplayAdjustmentKey(stateKey);
      const existing = entries.get(key);
      if (existing) {
        existing.sourceSet.add(source);
        if (!existing.layers && layers) existing.layers = layers;
        return;
      }

      const preview = createVoxelBlock(0, 0, 0, stateKey);
      entries.set(key, {
        key,
        stateKey,
        label,
        color: preview.color,
        category,
        family,
        layers,
        sources: [],
        sourceSet: new Set([source]),
      });
    };

    for (const item of blockLibraryItems) {
      upsertItem(item.stateKey, {
        label: item.label,
        family: 'block',
        category: `Block Library / ${creativeInventoryTabLabel(item.category)}`,
        source: 'Block Library',
        layers: materialThumbnailLayers(item.stateKey),
      });
    }

    for (const stateKey of recipeThumbnailStateKeys) {
      const isBlock = blockLibraryStateKeys.has(stateKey);
      upsertItem(stateKey, {
        label: formatBlockName(stateKey),
        family: isBlock ? 'block' : 'item',
        category: isBlock ? 'Materials & Recipes / Blocks' : 'Materials & Recipes / Items',
        source: 'Materials & Recipes',
        layers: isBlock ? materialThumbnailLayers(stateKey) : undefined,
      });
    }

    return Array.from(entries.values())
      .map(({ sourceSet, ...item }) => ({
        ...item,
        sources: Array.from(sourceSet).sort(),
      }))
      .sort((a, b) => (
        a.family.localeCompare(b.family)
          || a.label.localeCompare(b.label)
          || a.stateKey.localeCompare(b.stateKey)
      ));
  }, [blockLibraryItems, blockLibraryStateKeys, recipeThumbnailStateKeys]);
  const filteredThumbnailDebugItems = useMemo(() => {
    const query = thumbnailDebugSearch.trim().toLocaleLowerCase();
    if (!query) return thumbnailDebugItems;

    return thumbnailDebugItems.filter((item) => (
      item.label.toLocaleLowerCase().includes(query)
      || item.stateKey.toLocaleLowerCase().includes(query)
      || item.category.toLocaleLowerCase().includes(query)
      || item.sources.some((source) => source.toLocaleLowerCase().includes(query))
    ));
  }, [thumbnailDebugItems, thumbnailDebugSearch]);
  const selectedThumbnailDebugItem = useMemo(() => (
    thumbnailDebugItems.find((item) => item.key === selectedThumbnailDebugKey)
      ?? filteredThumbnailDebugItems[0]
      ?? thumbnailDebugItems[0]
      ?? null
  ), [filteredThumbnailDebugItems, selectedThumbnailDebugKey, thumbnailDebugItems]);
  const selectedThumbnailDisplayAdjustment = selectedThumbnailDebugItem
    ? thumbnailDisplayAdjustments[selectedThumbnailDebugItem.key] ?? defaultThumbnailDisplayAdjustment
    : defaultThumbnailDisplayAdjustment;
  const selectedThumbnailPreviewRequest = useMemo<ThumbnailPreviewRequest | null>(() => {
    if (!selectedThumbnailDebugItem) return null;
    return resolveThumbnailPreviewRequest(
      selectedThumbnailDebugItem.stateKey,
      selectedThumbnailDebugItem.layers,
      selectedThumbnailDisplayAdjustment,
    );
  }, [selectedThumbnailDebugItem, selectedThumbnailDisplayAdjustment]);
  const selectedThumbnailOrientation = useMemo<ThumbnailOrientationSummary | null>(() => (
    selectedThumbnailPreviewRequest ? summarizeThumbnailOrientation(selectedThumbnailPreviewRequest) : null
  ), [selectedThumbnailPreviewRequest]);
  const selectedThumbnailHorizontalDirections = useMemo(() => {
    if (!selectedThumbnailPreviewRequest) return [] as Direction[];
    if (selectedThumbnailOrientation?.mode === 'axis') return [] as Direction[];
    return (['north', 'east', 'south', 'west'] as const).filter((direction) => (
      canSetThumbnailPreviewRequestDirection(selectedThumbnailPreviewRequest, direction)
    ));
  }, [selectedThumbnailOrientation?.mode, selectedThumbnailPreviewRequest]);
  const selectedThumbnailVerticalDirections = useMemo(() => {
    if (!selectedThumbnailPreviewRequest) return [] as Direction[];
    if (selectedThumbnailOrientation?.mode === 'axis') return [] as Direction[];
    if (!supportsVerticalThumbnailDirection(selectedThumbnailPreviewRequest)) return [] as Direction[];
    return (['up', 'down'] as const).filter((direction) => (
      canSetThumbnailPreviewRequestDirection(selectedThumbnailPreviewRequest, direction)
    ));
  }, [selectedThumbnailOrientation?.mode, selectedThumbnailPreviewRequest]);
  const selectedThumbnailAxes = useMemo(() => {
    if (!selectedThumbnailPreviewRequest || selectedThumbnailOrientation?.mode !== 'axis') return [] as Array<'x' | 'y' | 'z'>;
    return (['x', 'y', 'z'] as const).filter((axis) => canSetThumbnailPreviewRequestAxis(selectedThumbnailPreviewRequest, axis));
  }, [selectedThumbnailOrientation?.mode, selectedThumbnailPreviewRequest]);
  const exportedThumbnailDisplayAdjustments = useMemo(() => (
    serializeThumbnailDisplayAdjustments(thumbnailDisplayAdjustments)
  ), [thumbnailDisplayAdjustments]);
  const adjustedThumbnailItemCount = Object.keys(exportedThumbnailDisplayAdjustments).length;

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
  const textureViewActive = UV_VIEW_ENABLED && appView === 'texture';
  const displayedModel = textureViewActive ? texturePreviewModel : model;
  const displayedHiddenMaterialIds = useMemo(() => new Set<string>(), []);
  const modelStorageIdentity = useMemo(() => (
    model ? schematicStorageIdentity(model) : ''
  ), [model]);
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
    if (!UV_VIEW_ENABLED && appView === 'texture') {
      setAppView('inspect');
    }
  }, [appView]);

  useEffect(() => {
    if (!thumbnailDebugItems.length) return;
    if (selectedThumbnailDebugKey && thumbnailDebugItems.some((item) => item.key === selectedThumbnailDebugKey)) return;
    setSelectedThumbnailDebugKey(thumbnailDebugItems[0].key);
  }, [selectedThumbnailDebugKey, thumbnailDebugItems]);

  useEffect(() => {
    if (loadState !== 'ready') return;

    const controller = new AbortController();
    const previewQueue = [
      { stateKey: selectedBuildBlock, color: selectedBuildBlockPreview.color },
      ...recentBuildBlocks.map((stateKey) => {
        const preview = createVoxelBlock(0, 0, 0, stateKey);
        return { stateKey, color: preview.color };
      }),
      ...materials.slice(0, 64)
        .filter((material) => !alwaysMaterialSpriteStateKey(material.displayStateKey))
        .map((material) => ({
          stateKey: material.displayStateKey,
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
    if (loadState !== 'ready' || appView !== 'shulker' || visibleShulkerThumbnailQueue.length === 0) return;

    const controller = new AbortController();
    preloadBlockThumbnails(visibleShulkerThumbnailQueue, {
      batchSize: 18,
      priority: 'interactive',
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [appView, loadState, visibleShulkerThumbnailQueue]);

  useEffect(() => {
    if (!THUMBNAIL_DEBUG_ENABLED || appView !== 'thumbnail-debug') return;

    const controller = new AbortController();
    preloadBlockThumbnails(filteredThumbnailDebugItems.slice(0, 480).map((item) => ({
      stateKey: item.stateKey,
      color: item.color,
      layers: item.layers,
    })), {
      batchSize: 24,
      priority: 'interactive',
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [appView, filteredThumbnailDebugItems]);

  useEffect(() => {
    if (THUMBNAIL_DEBUG_ENABLED || appView !== 'thumbnail-debug') return;
    setAppView('inspect');
  }, [appView]);

  useEffect(() => {
    setVisibleShulkerBoxCounts({
      box: Math.min(initialShulkerBoxRenderCount, shulkerBoxPlanCache.box.length),
      type: Math.min(initialShulkerBoxRenderCount, shulkerBoxPlanCache.type.length),
    });
  }, [shulkerBoxPlanCache]);

  useEffect(() => {
    if (appView !== 'shulker' || visibleShulkerBoxCount >= shulkerBoxes.length) return;

    const loadMore = () => {
      setVisibleShulkerBoxCounts((counts) => ({
        ...counts,
        [shulkerViewMode]: Math.min(counts[shulkerViewMode] + shulkerBoxRenderBatchSize, shulkerBoxes.length),
      }));
    };
    const sentinel = shulkerLoadMoreRef.current;
    if (!sentinel) {
      const batchTimer = globalThis.setTimeout(loadMore, 120);
      return () => globalThis.clearTimeout(batchTimer);
    }

    if (!('IntersectionObserver' in window)) {
      const batchTimer = globalThis.setTimeout(loadMore, 120);
      return () => globalThis.clearTimeout(batchTimer);
    }

    let frame = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(loadMore);
    }, {
      root: null,
      rootMargin: '520px 0px',
      threshold: 0.01,
    });
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [appView, shulkerBoxes.length, shulkerViewMode, visibleShulkerBoxCount]);

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
    if (!shulkerStorage) {
      setCheckedShulkerSlots(new Set());
      return;
    }

    const rawSlots = window.localStorage.getItem(shulkerStorage);
    const storedSlots = rawSlots ? parseShoppingStorage(rawSlots) : [];
    const nextSlots = storedSlots.filter((slotKey) => shulkerSlotKeys.has(slotKey));
    skipNextShulkerPersistRef.current = true;
    setCheckedShulkerSlots(new Set(nextSlots));
  }, [shulkerSlotKeys, shulkerStorage]);

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
    if (!shulkerStorage) return;
    if (skipNextShulkerPersistRef.current) {
      skipNextShulkerPersistRef.current = false;
      return;
    }

    const nextSlots = Array.from(checkedShulkerSlots).filter((slotKey) => shulkerSlotKeys.has(slotKey));
    window.localStorage.setItem(shulkerStorage, JSON.stringify(nextSlots));
  }, [checkedShulkerSlots, shulkerSlotKeys, shulkerStorage]);

  useEffect(() => {
    if (prevShoppingStorageRef.current !== shoppingStorage) {
      prevShoppingStorageRef.current = shoppingStorage;
      prevShoppingProgressRef.current = shoppingProgressPercent;
      setCelebrationView((current) => (current === 'shopping' ? null : current));
      return;
    }
    if (shoppingProgressPercent === 100 && totalShoppingItems > 0 && prevShoppingProgressRef.current < 100) {
      setCelebrationView('shopping');
    }
    prevShoppingProgressRef.current = shoppingProgressPercent;
  }, [shoppingProgressPercent, totalShoppingItems, shoppingStorage]);

  useEffect(() => {
    if (prevShulkerStorageRef.current !== shulkerStorage) {
      prevShulkerStorageRef.current = shulkerStorage;
      prevShulkerProgressRef.current = shulkerProgressPercent;
      setCelebrationView((current) => (current === 'shulker' ? null : current));
      return;
    }
    if (shulkerProgressPercent === 100 && shulkerFilledSlotCount > 0 && prevShulkerProgressRef.current < 100) {
      setCelebrationView('shulker');
    }
    prevShulkerProgressRef.current = shulkerProgressPercent;
  }, [shulkerFilledSlotCount, shulkerProgressPercent, shulkerStorage]);

  useEffect(() => {
    const boxIds = new Set(shulkerBoxes.map((box) => box.id));
    setCollapsedShulkerBoxes((current) => {
      const next = new Set(Array.from(current).filter((boxId) => boxIds.has(boxId)));
      return next.size === current.size ? current : next;
    });
  }, [shulkerBoxes]);

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
    if (!model || !modelStorageIdentity) return;

    const storedSelections = parseSelectionAreas(window.localStorage.getItem(selectionStorageKey(modelStorageIdentity)));
    const nextSelections = storedSelections
      .map((area) => ({ ...area, corners: clampCuboidCornersToModel(area.corners, model) }))
      .filter((area) => area.corners.a || area.corners.b);
    setSelectionAreas(nextSelections);
    skipNextSelectionPersistRef.current = true;
    const firstComplete = nextSelections.find((area) => area.corners.a && area.corners.b) ?? nextSelections[0] ?? null;
    setActiveSelectionId(firstComplete?.id ?? null);
    setCuboidCorners(firstComplete?.corners ?? emptyCuboidCorners());
    setSelectionUndoStack([]);

    const storedCameras = parseSavedCameraViews(window.localStorage.getItem(cameraStorageKey(modelStorageIdentity)));
    skipNextCameraPersistRef.current = true;
    setSavedCameraViews(storedCameras);
    const defaultView = storedCameras.find((view) => view.isDefault);
    if (defaultView) {
      pendingCameraPositionRef.current = defaultView.position;
      window.requestAnimationFrame(() => viewerRef.current?.applyCameraPosition(defaultView.position));
    }
  }, [model, modelStorageIdentity]);

  useEffect(() => {
    if (!modelStorageIdentity) return;
    if (skipNextSelectionPersistRef.current) {
      skipNextSelectionPersistRef.current = false;
      return;
    }
    window.localStorage.setItem(selectionStorageKey(modelStorageIdentity), JSON.stringify(selectionAreas));
  }, [modelStorageIdentity, selectionAreas]);

  useEffect(() => {
    if (!modelStorageIdentity) return;
    if (skipNextCameraPersistRef.current) {
      skipNextCameraPersistRef.current = false;
      return;
    }
    window.localStorage.setItem(cameraStorageKey(modelStorageIdentity), JSON.stringify(savedCameraViews));
  }, [modelStorageIdentity, savedCameraViews]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    const preferences: MaterialBasePreferences = {
      modes: Object.fromEntries(materialBaseModes),
      recipes: Object.fromEntries(recipeChoices),
    };
    if (materialBaseModes.size === 0 && recipeChoices.size === 0) {
      window.localStorage.removeItem(materialBaseStorageKey);
    } else {
      window.localStorage.setItem(materialBaseStorageKey, JSON.stringify(preferences));
    }
  }, [materialBaseModes, recipeChoices]);

  useEffect(() => {
    setStageBackgroundColor((current) => {
      const normalized = normalizeHexColor(current);
      if (
        normalized === defaultStageBackgroundColor(theme === 'dark' ? 'light' : 'dark')
        || normalized === legacyLightStageBackgroundColor
      ) {
        return defaultStageBackgroundColor(theme);
      }
      return current;
    });
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(leftRailCollapsedStorageKey, String(leftRailCollapsed));
  }, [leftRailCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(controlRailSideStorageKey, controlRailSide);
  }, [controlRailSide]);

  useEffect(() => {
    window.localStorage.setItem(stageBackgroundColorStorageKey, stageBackgroundColor);
  }, [stageBackgroundColor]);

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
      && selectedBlock.y >= visibleBottomLayer
      && selectedBlock.y <= visibleTopLayer;
    if (!isFromCurrentModel || !isVisible) {
      setSelectedBlock(null);
    }
  }, [hiddenMaterialIds, model, selectedBlock, visibleBottomLayer, visibleTopLayer]);

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

  const beginSchematicLoad = (message: string) => {
    setLoadState('loading');
    setLoadProgressMessage(message);
    setError('');
    setModel(null);
    setSelectedBlock(null);
    setCuboidCorners(emptyCuboidCorners());
    setSelectionAreas([]);
    setActiveSelectionId(null);
    setSelectionUndoStack([]);
    setMaterialsScope('build');
  };

  const applySchematic = (nextModel: SchematicModel, nextDocument: NbtDocument | null, nextExtension: string, nextOrigin: SchematicOrigin = 'uploaded') => {
    setModel(nextModel);
    setSchematicOrigin(nextOrigin);
    setSchematicName(nextModel.name);
    setIsEditingSchematicName(false);
    setSchematicDocument(nextDocument);
    setSchematicExtension(nextExtension);
    setExportFormat(defaultExportFormat);
    setHasEditChanges(false);
    setVisibleBottomLayer(0);
    setVisibleTopLayer(nextModel.dimensions.height - 1);
    setSingleVisibleLayer(0);
    setRenderedVisibleBottomLayer(0);
    setRenderedVisibleTopLayer(nextModel.dimensions.height - 1);
    setSelectedBlock(null);
    setExpandedMaterialIds(new Set());
    setMaterialSearch('');
    setPlayerHeadSelections({});
    setHiddenMaterialIds(new Set());
    setCuboidCorners(emptyCuboidCorners());
    setSelectionAreas([]);
    setActiveSelectionId(null);
    setSelectionUndoStack([]);
    setEditUndoStack([]);
    setSavedCameraViews([]);
    setMaterialsScope('build');
    setEditTool('select');
    setSelectedBuildBlock(emptyBuildBlock);
    setRecentBuildBlocks([]);
    setBlockSearch('');
    setReplaceFromBlock(nextModel.blocks[0]?.stateKey ?? '');
    setReplaceToBlock(emptyBuildBlock);
    setEditNotice('');
    setLoadProgressMessage('Schematic ready.');
    setLoadState('ready');
  };

  const createNewSchematic = () => {
    beginSchematicLoad('Creating an empty build platform...');
    applySchematic(createStarterModel(), null, defaultExportFormat, 'new');
    setAppView('edit');
  };

  useEffect(() => {
    let isCancelled = false;

    const loadDefaultSchematic = async () => {
      beginSchematicLoad('Loading featured schematic...');

      try {
        setLoadProgressMessage(`Fetching ${defaultSchematicFileName}...`);
        const response = await fetch(defaultSchematicUrl);
        if (!response.ok) {
          throw new Error(`Could not load ${defaultSchematicFileName}.`);
        }

        setLoadProgressMessage('Reading schematic data...');
        const buffer = await response.arrayBuffer();
        setLoadProgressMessage('Parsing blocks and materials...');
        const parsed = parseSchematicDocument(buffer, { fileName: defaultSchematicFileName });
        setLoadProgressMessage('Preparing the 3D stage...');
        const defaultModel = { ...parsed.model, name: defaultSchematicName };
        const defaultDocument = renameSchematicDocument(parsed.nbt, parsed.model.source, defaultSchematicName);
        if (isCancelled) return;
        applySchematic(defaultModel, defaultDocument, fileExtension(defaultSchematicFileName), 'default');
      } catch (caught) {
        if (isCancelled) return;

        const fallback = createSampleModel();
        applySchematic(fallback, null, defaultExportFormat, 'uploaded');
        setError(caught instanceof Error ? caught.message : 'Could not load the default schematic.');
      }
    };

    void loadDefaultSchematic();

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleFile = async (file: File) => {
    beginSchematicLoad(`Opening ${file.name}...`);

    try {
      setLoadProgressMessage('Reading file from your device...');
      const buffer = await file.arrayBuffer();
      setLoadProgressMessage('Parsing schematic data...');
      const parsed = parseSchematicDocument(buffer, { fileName: file.name });
      setLoadProgressMessage('Building materials and 3D geometry...');
      applySchematic(parsed.model, parsed.nbt, fileExtension(file.name), 'uploaded');
    } catch (caught) {
      setLoadState('error');
      setLoadProgressMessage('Could not load schematic.');
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

    const nextName = schematicName.trim() || model.name;
    try {
      const exportDocument = !hasEditChanges && schematicDocument && exportFormat === schematicExtension
        ? renameSchematicDocument(schematicDocument, model.source, nextName)
        : exportFormat === '.litematic'
          ? createLitematicSchematicDocument({ ...model, name: nextName }, nextName)
          : exportFormat === '.schematic'
            ? createLegacySchematicDocument({ ...model, name: nextName }, nextName)
            : createSpongeSchematicDocument({ ...model, name: nextName }, nextName);
      const bytes = writeNbt(exportDocument);
      const arrayBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(arrayBuffer).set(bytes);
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFileBaseName(nextName)}${exportFormat}`;
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

  const commitLayerRange = (bottomLayer = visibleBottomLayer, topLayer = visibleTopLayer) => {
    setRenderedVisibleBottomLayer(bottomLayer);
    setRenderedVisibleTopLayer(topLayer);
  };

  const cancelScheduledVisibleLayerRange = () => {
    pendingVisibleLayerRangeRef.current = null;
    if (visibleLayerFrameRef.current !== null) {
      window.cancelAnimationFrame(visibleLayerFrameRef.current);
      visibleLayerFrameRef.current = null;
    }
  };

  const setVisibleLayerRange = (
    bottomLayer: number,
    topLayer: number,
    singleLayer = singleVisibleLayer,
    options: { commit?: boolean; immediate?: boolean } = {},
  ) => {
    if (options.immediate) {
      cancelScheduledVisibleLayerRange();
      setSingleVisibleLayer(singleLayer);
      setVisibleBottomLayer(bottomLayer);
      setVisibleTopLayer(topLayer);
      if (options.commit) commitLayerRange(bottomLayer, topLayer);
      return;
    }

    pendingVisibleLayerRangeRef.current = { bottomLayer, topLayer, singleLayer };
    if (visibleLayerFrameRef.current !== null) return;

    visibleLayerFrameRef.current = window.requestAnimationFrame(() => {
      visibleLayerFrameRef.current = null;
      const pending = pendingVisibleLayerRangeRef.current;
      pendingVisibleLayerRangeRef.current = null;
      if (!pending) return;
      setSingleVisibleLayer(pending.singleLayer);
      setVisibleBottomLayer(pending.bottomLayer);
      setVisibleTopLayer(pending.topLayer);
    });
  };

  const stepLayer = (delta: number) => {
    if (!model) return;
    const nextLayer = clamp(singleVisibleLayer + delta, 0, model.dimensions.height - 1);
    setVisibleLayerRange(nextLayer, nextLayer, nextLayer, { commit: true, immediate: true });
  };

  const singleLayerPercent = model && model.dimensions.height > 1 ? (singleVisibleLayer / (model.dimensions.height - 1)) * 100 : 0;

  const showSingleLayer = (layer: number, shouldCommit = false) => {
    if (!model) return;
    const nextLayer = clamp(layer, 0, model.dimensions.height - 1);
    setVisibleLayerRange(nextLayer, nextLayer, nextLayer, { commit: shouldCommit, immediate: shouldCommit });
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      commitLayerRange();
    }, 140);

    return () => window.clearTimeout(timeout);
  }, [visibleBottomLayer, visibleTopLayer]);

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

  const setMaterialBaseMode = useCallback((rawId: string, mode: MaterialBaseMode | 'default') => {
    const id = normalizeRecipeItemId(rawId);
    setMaterialBaseModes((current) => {
      const next = new Map(current);
      if (mode === 'default') next.delete(id);
      else next.set(id, mode);
      return next;
    });
  }, []);

  const setMaterialRecipeChoice = useCallback((rawId: string, recipeIndex: number) => {
    const id = normalizeRecipeItemId(rawId);
    setRecipeChoices((current) => {
      const next = new Map(current);
      next.set(id, recipeIndex);
      return next;
    });
  }, []);

  const resetMaterialBases = useCallback(() => {
    setMaterialBaseModes(new Map());
    setRecipeChoices(new Map());
  }, []);

  const choosePlayerHeadTexture = (textureId: string) => {
    if (!selectedBlockKey) return;

    setPlayerHeadSelections((current) => ({
      ...current,
      [selectedBlockKey]: textureId,
    }));
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      setStageBackgroundColor((currentStageColor) => {
        const normalized = normalizeHexColor(currentStageColor);
        if (
          normalized === defaultStageBackgroundColor(current)
          || normalized === defaultStageBackgroundColor(nextTheme)
          || normalized === legacyLightStageBackgroundColor
        ) {
          return defaultStageBackgroundColor(nextTheme);
        }
        return currentStageColor;
      });
      return nextTheme;
    });
  };

  const toggleControlRailSide = () => {
    setControlRailSide((side) => {
      const nextSide = side === 'right' ? 'left' : 'right';
      if (nextSide === 'left') setLeftRailCollapsed(true);
      return nextSide;
    });
  };

  const panelRefForTab = (tab: InspectorTab) => (
    tab === 'selection' ? selectionPanelRef : tab === 'layers' ? layerPanelRef : materialPanelRef
  );

  const showPanel = (tab: InspectorTab) => {
    setInspectorTab(tab);
  };

  const revealPanel = (tab: InspectorTab) => {
    setInspectorTab(tab);
    const panel = panelRefForTab(tab);
    window.requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const beginCuboidSelection = (resetSelection = false, revealViewPanel = appView === 'inspect') => {
    if (resetSelection) {
      pushSelectionUndo(cuboidCorners);
      setCuboidCorners(emptyCuboidCorners());
      setActiveSelectionId(null);
      setMaterialsScope('build');
    }
    setCuboidSelectionMode(true);
    if (revealViewPanel) revealPanel('selection');
  };

  const pushSelectionUndo = (corners: CuboidCorners) => {
    setSelectionUndoStack((current) => [cloneCuboidCorners(corners), ...current].slice(0, 24));
  };

  const commitCuboidCorners = (nextCorners: CuboidCorners, options: { saveArea?: boolean } = {}) => {
    if (cuboidCornersKey(nextCorners) === cuboidCornersKey(cuboidCorners)) return;
    pushSelectionUndo(cuboidCorners);
    setCuboidCorners(nextCorners);

    if (activeSelectionId) {
      setSelectionAreas((current) => current.map((area) => (
        area.id === activeSelectionId
          ? { ...area, corners: nextCorners, updatedAt: Date.now() }
          : area
      )));
    } else if (options.saveArea && nextCorners.a && nextCorners.b) {
      const nextArea = createSelectionArea(nextCorners, selectionAreas.length + 1);
      setSelectionAreas((current) => [nextArea, ...current]);
      setActiveSelectionId(nextArea.id);
    }
  };

  const undoCuboidSelection = () => {
    setSelectionUndoStack((current) => {
      const [previous, ...rest] = current;
      if (!previous) return current;
      setCuboidCorners(previous);
      if (activeSelectionId) {
        setSelectionAreas((areas) => areas.map((area) => (
          area.id === activeSelectionId
            ? { ...area, corners: previous, updatedAt: Date.now() }
            : area
        )));
      }
      return rest;
    });
  };

  const saveCurrentSelection = () => {
    if (!cuboidCorners.a || !cuboidCorners.b) return;
    if (activeSelectionId) return;
    const nextArea = createSelectionArea(cuboidCorners, selectionAreas.length + 1);
    setSelectionAreas((current) => [nextArea, ...current]);
    setActiveSelectionId(nextArea.id);
    setMaterialsScope('cuboid');
  };

  const activateSelectionArea = (id: string) => {
    const area = selectionAreas.find((candidate) => candidate.id === id);
    if (!area) return;
    pushSelectionUndo(cuboidCorners);
    setActiveSelectionId(id);
    setCuboidCorners(area.corners);
    if (area.corners.a && area.corners.b) setMaterialsScope('cuboid');
  };

  const removeSelectionArea = (id: string) => {
    setSelectionAreas((current) => current.filter((area) => area.id !== id));
    if (activeSelectionId === id) {
      setActiveSelectionId(null);
      setCuboidCorners(emptyCuboidCorners());
      setMaterialsScope('build');
    }
  };

  const selectVisibleLayers = () => {
    if (!model) return;
    const nextCorners = {
      a: { x: 0, y: visibleBottomLayer, z: 0 },
      b: {
        x: Math.max(0, model.dimensions.width - 1),
        y: visibleTopLayer,
        z: Math.max(0, model.dimensions.length - 1),
      },
    };
    commitCuboidCorners(nextCorners, { saveArea: true });
    setCuboidSelectionMode(false);
    setMaterialsScope('cuboid');
  };

  const openInspectorPanel = (tab: InspectorTab) => {
    setAppView('inspect');
    // Just switch the tab — don't scrollIntoView the panel. The materials list
    // shares the control-rail scroll container, so revealing the panel would
    // snap the list back to the top every time you re-enter Inspect mode.
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
      commitCuboidCorners({
        ...cuboidCorners,
        [corner]: pointFromBlock(block),
      }, { saveArea: Boolean(otherCorner) });
      if (otherCorner) {
        // Both corners are now placed — the selection is complete, so leave
        // create-selection mode and let the `+` button return to inactive.
        setMaterialsScope('cuboid');
        setCuboidSelectionMode(false);
      }
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
    commitCuboidCorners(emptyCuboidCorners());
    setActiveSelectionId(null);
    setMaterialsScope('build');
  };

  const updateModelBlocks = (updater: (blocks: VoxelBlock[], currentModel: SchematicModel) => VoxelBlock[]) => {
    if (!model) return;

    const selectedKey = selectedBlock ? blockPositionKey(selectedBlock) : null;
    const blocks = updater(model.blocks, model)
      .filter((block) => blockInsideModel(block, model))
      .sort(compareBlocks);
    const nextModel = finalizeSchematicModel({
      ...model,
      source: 'Sponge .schem',
      blocks,
      paletteSize: new Set(blocks.map((block) => block.stateKey)).size,
      warnings: model.warnings,
    });
    if (selectedKey) {
      setSelectedBlock(blocks.find((block) => blockPositionKey(block) === selectedKey) ?? null);
    }
    setEditUndoStack((stack) => [model, ...stack].slice(0, 24));
    setHasEditChanges(true);
    setSchematicExtension('.schem');
    setModel(nextModel);
  };

  const undoLastEdit = () => {
    setEditUndoStack((current) => {
      const [previous, ...rest] = current;
      if (!previous) return current;
      setModel(previous);
      setSelectedBlock(null);
      setHasEditChanges(true);
      setSchematicExtension('.schem');
      setEditNotice('Undid last schematic edit.');
      return rest;
    });
  };

  const undoLastChange = () => {
    if (editUndoStack.length > 0) {
      undoLastEdit();
      return;
    }
    undoCuboidSelection();
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
      commitCuboidCorners({ a: boundsMinPoint(rotatedBounds), b: boundsMaxPoint(rotatedBounds) });
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

  const shiftSelectedArea = (direction: Direction) => {
    if (!model || !cuboidBounds) {
      setEditNotice('Select an area before moving it.');
      return;
    }

    const offset = directionOffset(direction);
    const shiftedBounds = translateBounds(cuboidBounds, offset);
    if (!boundsInsideModel(shiftedBounds, model)) {
      setEditNotice(`Selected area cannot move ${directionLabel(direction).toLocaleLowerCase()} outside the schematic bounds.`);
      return;
    }

    const sourceBlocks = model.blocks.filter((block) => blockInBounds(block, cuboidBounds));
    const sourceKeys = keysForBounds(cuboidBounds);
    const targetKeys = new Set(Array.from(sourceKeys, (key) => pointKey(translatePoint(pointFromKey(key), offset))));
    const shiftedBlocks = sourceBlocks.map((block) => createVoxelBlock(
      block.x + offset.x,
      block.y + offset.y,
      block.z + offset.z,
      block.stateKey,
    ));

    updateModelBlocks((blocks) => [
      ...blocks.filter((block) => !sourceKeys.has(blockPositionKey(block)) && !targetKeys.has(blockPositionKey(block))),
      ...shiftedBlocks,
    ]);
    commitCuboidCorners({
      a: cuboidCorners.a ? translatePoint(cuboidCorners.a, offset) : boundsMinPoint(shiftedBounds),
      b: cuboidCorners.b ? translatePoint(cuboidCorners.b, offset) : boundsMaxPoint(shiftedBounds),
    });
    setSelectedBlock((current) => {
      if (!current || !sourceKeys.has(blockPositionKey(current))) return null;
      const nextPoint = translatePoint(current, offset);
      return shiftedBlocks.find((block) => blockPositionKey(block) === pointKey(nextPoint)) ?? null;
    });
    setMaterialsScope('cuboid');
    setEditNotice(`${sourceBlocks.length.toLocaleString()} block${sourceBlocks.length === 1 ? '' : 's'} moved ${directionLabel(direction).toLocaleLowerCase()}.`);
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
    if (UV_VIEW_ENABLED) setAppView('texture');
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
      kind: 'build-planner-texture-adjustments',
      version: 1,
      selectedBlock: selectedTextureBlock,
      adjustments,
    };
    const text = JSON.stringify(payload, null, 2);
    setTextureExportText(text);
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const updateSelectedThumbnailScale = (value: number) => {
    if (!selectedThumbnailDebugItem) return;

    setThumbnailDisplayAdjustments((current) => {
      const previous = current[selectedThumbnailDebugItem.key] ?? defaultThumbnailDisplayAdjustment;
      const next = normalizeThumbnailDisplayAdjustment({
        ...previous,
        scale: value,
      });

      if (isDefaultThumbnailDisplayAdjustment(next)) {
        const updated = { ...current };
        delete updated[selectedThumbnailDebugItem.key];
        return updated;
      }

      return {
        ...current,
        [selectedThumbnailDebugItem.key]: next,
      };
    });
  };

  const updateSelectedThumbnailPreviewRequest = (request: ThumbnailPreviewRequest) => {
    if (!selectedThumbnailDebugItem) return;

    setThumbnailDisplayAdjustments((current) => {
      const previous = current[selectedThumbnailDebugItem.key] ?? defaultThumbnailDisplayAdjustment;
      const normalizedRequest = normalizeThumbnailPreviewRequest(request);
      const baseRequest = baseThumbnailPreviewRequest(selectedThumbnailDebugItem.stateKey, selectedThumbnailDebugItem.layers);
      const next = normalizeThumbnailDisplayAdjustment({
        ...previous,
        previewStateKey: thumbnailPreviewRequestsEqual(normalizedRequest, baseRequest) ? undefined : normalizedRequest.stateKey,
        previewLayers: thumbnailPreviewRequestsEqual(normalizedRequest, baseRequest) ? undefined : normalizedRequest.layers,
      });

      if (isDefaultThumbnailDisplayAdjustment(next)) {
        const updated = { ...current };
        delete updated[selectedThumbnailDebugItem.key];
        return updated;
      }

      return {
        ...current,
        [selectedThumbnailDebugItem.key]: next,
      };
    });
  };

  const rotateSelectedThumbnailPreview = (direction: RotationDirection) => {
    if (!selectedThumbnailPreviewRequest) return;
    updateSelectedThumbnailPreviewRequest(rotateThumbnailPreviewRequestY(selectedThumbnailPreviewRequest, direction));
  };

  const setSelectedThumbnailDirection = (direction: Direction) => {
    if (!selectedThumbnailPreviewRequest) return;
    updateSelectedThumbnailPreviewRequest(setThumbnailPreviewRequestDirection(selectedThumbnailPreviewRequest, direction));
  };

  const setSelectedThumbnailAxis = (axis: 'x' | 'y' | 'z') => {
    if (!selectedThumbnailPreviewRequest) return;
    updateSelectedThumbnailPreviewRequest(setThumbnailPreviewRequestAxis(selectedThumbnailPreviewRequest, axis));
  };

  const resetSelectedThumbnailDisplayAdjustment = () => {
    if (!selectedThumbnailDebugItem) return;
    setThumbnailDisplayAdjustments((current) => {
      const updated = { ...current };
      delete updated[selectedThumbnailDebugItem.key];
      return updated;
    });
  };

  const resetAllThumbnailDisplayAdjustments = () => {
    setThumbnailDisplayAdjustments(loadedThumbnailDisplayAdjustments);
  };

  const copyThumbnailDisplayAdjustments = () => {
    const text = JSON.stringify(exportedThumbnailDisplayAdjustments, null, 2);
    const copyOperation = navigator.clipboard?.writeText(text);
    if (!copyOperation) {
      setThumbnailAdjustmentsCopied(false);
      setEditNotice('Clipboard copy is not available in this browser.');
      return;
    }

    void copyOperation.then(() => {
      if (thumbnailAdjustmentsCopiedTimeoutRef.current !== null) {
        window.clearTimeout(thumbnailAdjustmentsCopiedTimeoutRef.current);
      }
      setThumbnailAdjustmentsCopied(true);
      thumbnailAdjustmentsCopiedTimeoutRef.current = window.setTimeout(() => {
        setThumbnailAdjustmentsCopied(false);
        thumbnailAdjustmentsCopiedTimeoutRef.current = null;
      }, 1800);
    }).catch(() => {
      setThumbnailAdjustmentsCopied(false);
      setEditNotice('Could not copy the thumbnail display adjustment JSON.');
    });
  };

  // --- TEMPORARY thumbnail tuning tools (gated by TEMP_THUMBNAIL_TOOLS) ---
  // Cycle how a material's thumbnail faces in the list. Stores the chosen
  // orientation as a previewStateKey/previewLayers override in the same
  // thumbnailDisplayAdjustments map the lists already read from, so the change is
  // visible immediately and captured by the Copy JSON export.
  const rotateMaterialThumbnail = (material: MaterialListItem) => {
    const adjustmentKey = material.displayStateKey ?? materialDisplayStateKey(material.stateKey);
    const layers = material.thumbnailLayers ?? materialThumbnailLayers(adjustmentKey);
    setThumbnailDisplayAdjustments((current) => {
      const previous = current[adjustmentKey] ?? defaultThumbnailDisplayAdjustment;
      const baseRequest = baseThumbnailPreviewRequest(adjustmentKey, layers);
      const currentRequest = resolveThumbnailPreviewRequest(adjustmentKey, layers, previous);
      const nextRequest = cycleThumbnailPreviewRequestFacing(currentRequest);
      if (thumbnailPreviewRequestsEqual(nextRequest, currentRequest)) return current;

      const matchesBase = thumbnailPreviewRequestsEqual(nextRequest, baseRequest);
      const next = normalizeThumbnailDisplayAdjustment({
        ...previous,
        previewStateKey: matchesBase ? undefined : nextRequest.stateKey,
        previewLayers: matchesBase ? undefined : nextRequest.layers,
      });

      if (isDefaultThumbnailDisplayAdjustment(next)) {
        const updated = { ...current };
        delete updated[adjustmentKey];
        return updated;
      }
      return { ...current, [adjustmentKey]: next };
    });
  };

  // Copies a paste-ready adjustments map plus a human-readable was/now list so the
  // captured orientations can be baked into thumbnail_display_adjustments.json.
  const copyMaterialThumbnailAdjustments = () => {
    const adjustments = exportedThumbnailDisplayAdjustments;
    const changes = Object.entries(adjustments).map(([block, adjustment]) => {
      const layers = materialThumbnailLayers(block);
      const baseRequest = baseThumbnailPreviewRequest(block, layers);
      const adjustedRequest = resolveThumbnailPreviewRequest(block, layers, adjustment);
      return {
        block,
        label: formatBlockName(block),
        was: summarizeThumbnailOrientation(baseRequest).label ?? 'default',
        now: summarizeThumbnailOrientation(adjustedRequest).label ?? 'default',
        scale: adjustment.scale,
      };
    });
    const text = JSON.stringify({
      _comment: 'Replace src/lib/data/thumbnail_display_adjustments.json with `adjustments` to make these permanent.',
      adjustments,
      changes,
    }, null, 2);

    const copyOperation = navigator.clipboard?.writeText(text);
    if (!copyOperation) {
      setThumbnailAdjustmentsCopied(false);
      setEditNotice('Clipboard copy is not available in this browser.');
      return;
    }
    void copyOperation.then(() => {
      if (thumbnailAdjustmentsCopiedTimeoutRef.current !== null) {
        window.clearTimeout(thumbnailAdjustmentsCopiedTimeoutRef.current);
      }
      setThumbnailAdjustmentsCopied(true);
      thumbnailAdjustmentsCopiedTimeoutRef.current = window.setTimeout(() => {
        setThumbnailAdjustmentsCopied(false);
        thumbnailAdjustmentsCopiedTimeoutRef.current = null;
      }, 1800);
    }).catch(() => {
      setThumbnailAdjustmentsCopied(false);
      setEditNotice('Could not copy the thumbnail adjustment JSON.');
    });
  };

  // Builds and loads an in-memory schematic with one of every known block so the
  // materials list shows them all for orientation tuning.
  const loadAllBlocksTestSchematic = () => {
    beginSchematicLoad('Generating an all-blocks test schematic...');
    const stateKeys = allBuildBlocks.filter((key) => materialDisplayStateKey(key) !== 'minecraft:air');
    const columns = Math.max(1, Math.ceil(Math.sqrt(stateKeys.length)));
    const rows = Math.max(1, Math.ceil(stateKeys.length / columns));
    const blocks = stateKeys.map((stateKey, index) => (
      createVoxelBlock(index % columns, 0, Math.floor(index / columns), stateKey)
    ));
    const allBlocksModel = finalizeSchematicModel({
      name: 'All Blocks (test)',
      source: 'Sample',
      dimensions: { width: columns, height: 1, length: rows },
      origin: { x: 0, y: 0, z: 0 },
      blocks,
      paletteSize: new Set(blocks.map((block) => block.stateKey)).size,
      warnings: [],
    });
    applySchematic(allBlocksModel, null, defaultExportFormat, 'new');
    setAppView('inspect');
    setInspectorTab('materials');
  };

  const openShoppingList = () => {
    if (!model) return;
    setShoppingSearch('');
    setAppView('shopping');
  };

  const openShulkerView = () => {
    if (!model) return;
    setAppView('shulker');
  };

  const openResourceCalculator = () => {
    if (!model) return;
    setShoppingSearch('');
    setAppView('resource');
  };

  const openAuditView = () => {
    if (!model) return;
    setAppView('audit');
  };

  const toggleAuditGroup = (categoryId: string) => {
    setExpandedAuditGroups((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const toggleAuditNbt = (key: string) => {
    setOpenAuditNbt((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const jumpToAuditBlock = (block: VoxelBlock) => {
    setSelectedBlock(block);
    openInspectorPanel('selection');
  };

  // Applies a replace/delete to every occurrence in one audit category. `target` is either a
  // concrete state key, AUDIT_RECOMMENDED (per-occurrence recommendation), or 'minecraft:air'
  // to delete. Reuses updateModelBlocks so the change is undoable and re-renders the model.
  const applyAuditCategory = (finding: AuditFinding, target: string) => {
    if (!model) return;
    const targetKeys = new Set(finding.occurrences.map((block) => blockPositionKey(block)));
    if (targetKeys.size === 0) return;

    updateModelBlocks((blocks) => blocks.flatMap((block) => {
      if (!targetKeys.has(blockPositionKey(block))) return [block];
      const resolved = target === AUDIT_RECOMMENDED
        ? finding.category.recommendedReplacement(block)
        : target;
      if (resolved === 'minecraft:air') return [];
      return [createVoxelBlock(block.x, block.y, block.z, resolved)];
    }));

    const count = targetKeys.size;
    const verb = target === 'minecraft:air' ? 'removed' : 'replaced';
    setEditNotice(`${count.toLocaleString()} ${finding.category.label.toLowerCase()} ${verb}.`);
  };

  const openThumbnailDebug = () => {
    if (!THUMBNAIL_DEBUG_ENABLED) return;
    setThumbnailDebugSearch('');
    setAppView('thumbnail-debug');
  };

  const saveCameraView = () => {
    const position = viewerRef.current?.getCameraPosition();
    if (!position) return;
    const nextView: SavedCameraView = {
      id: createStableId('camera'),
      name: `Camera ${savedCameraViews.length + 1}`,
      position,
      isDefault: savedCameraViews.length === 0,
      updatedAt: Date.now(),
    };
    setSavedCameraViews((current) => [nextView, ...current]);
  };

  const applyCameraView = (id: string) => {
    const view = savedCameraViews.find((candidate) => candidate.id === id);
    if (!view) return;
    viewerRef.current?.applyCameraPosition(view.position);
  };

  const thumbnailDebugActive = THUMBNAIL_DEBUG_ENABLED && appView === 'thumbnail-debug';

  // The main 3D viewer stays mounted across mode switches so the built scene is
  // cached and reappears instantly. It's only hidden (and its render loop
  // paused) while a full-panel view covers the viewport.
  const altPanelActive =
    thumbnailDebugActive ||
    (appView === 'resource' && Boolean(model)) ||
    (appView === 'shulker' && Boolean(model)) ||
    (appView === 'shopping' && Boolean(model)) ||
    (appView === 'audit' && Boolean(model));
  const persistentViewerHidden = loadState === 'loading' || textureViewActive || altPanelActive;

  const setDefaultCameraView = (id: string) => {
    setSavedCameraViews((current) => current.map((view) => ({
      ...view,
      isDefault: view.id === id,
      updatedAt: view.id === id ? Date.now() : view.updatedAt,
    })));
  };

  const removeCameraView = (id: string) => {
    setSavedCameraViews((current) => current.filter((view) => view.id !== id));
  };

  const handleViewerReady = () => {
    const pending = pendingCameraPositionRef.current;
    if (!pending) return;
    viewerRef.current?.applyCameraPosition(pending);
    pendingCameraPositionRef.current = null;
  };

  const toggleShoppingItem = (material: MaterialSummary) => {
    const key = shoppingItemKey(shoppingScope, material);
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

  const handleShoppingItemPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, material: MaterialSummary) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    toggleShoppingItem(material);
  };

  const handleShoppingItemClick = (event: ReactMouseEvent<HTMLButtonElement>, material: MaterialSummary) => {
    if (event.detail !== 0) return;
    toggleShoppingItem(material);
  };

  const toggleShoppingGroup = (materials: MaterialSummary[]) => {
    const keys = materials.map((material) => shoppingItemKey(shoppingScope, material));
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

  const toggleShoppingGroupCollapsed = (groupId: string) => {
    setCollapsedShoppingGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const resetShoppingList = () => {
    setCheckedShoppingItems(new Set());
  };

  const resetShulkerCompletion = () => {
    setCheckedShulkerSlots(new Set());
  };

  const toggleShulkerSlot = (box: ShulkerBoxPlan, slotIndex: number, slot: ShulkerStack) => {
    const key = shulkerSlotKey(box.id, slotIndex, slot);
    setCheckedShulkerSlots((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleShulkerSlotPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    box: ShulkerBoxPlan,
    slotIndex: number,
    slot: ShulkerStack,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    toggleShulkerSlot(box, slotIndex, slot);
  };

  const handleShulkerSlotClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    box: ShulkerBoxPlan,
    slotIndex: number,
    slot: ShulkerStack,
  ) => {
    if (event.detail !== 0) return;
    toggleShulkerSlot(box, slotIndex, slot);
  };

  const toggleShulkerBoxCompletion = (box: ShulkerBoxPlan) => {
    const keys = box.filledSlotKeys;
    setCheckedShulkerSlots((current) => {
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

  const toggleShulkerBoxCollapsed = (boxId: string) => {
    setCollapsedShulkerBoxes((current) => {
      const next = new Set(current);
      if (next.has(boxId)) {
        next.delete(boxId);
      } else {
        next.add(boxId);
      }
      return next;
    });
  };

  const stepCuboidCorner = (corner: CuboidCornerId, axis: 'x' | 'y' | 'z', delta: number) => {
    if (!model) return;
    const point = cuboidCorners[corner];
    if (!point) return;
    commitCuboidCorners({
      ...cuboidCorners,
      [corner]: {
        ...point,
        [axis]: clamp(point[axis] + delta, 0, maxCoordinateForAxis(model, axis)),
      },
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isAppEditableElement(event.target)) return;

      const key = event.key.toLocaleLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        if (editUndoStack.length > 0 || selectionUndoStack.length > 0) {
          event.preventDefault();
          undoLastChange();
        }
        return;
      }

      if (appView === 'edit' && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (deleteSelection()) event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appView, deleteSelection, editUndoStack.length, selectionUndoStack.length, undoLastChange]);

  return (
    <ThumbnailDisplayAdjustmentsContext.Provider value={thumbnailDisplayAdjustments}>
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
              <Box size={20} strokeWidth={2.4} />
            </div>
            <strong>Build Planner</strong>
            <span className="brand-beta">Beta</span>
          </div>
          <div className="topbar-divider" aria-hidden="true" />
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
              <h1>Open a schematic to begin</h1>
            )}
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="topbar-secondary"
            onClick={createNewSchematic}
            title="Create a new schematic"
          >
            <Plus size={16} />
            <span>New</span>
          </button>
          <div
            className={`topbar-export${isExportMenuOpen ? ' is-open' : ''}`}
            ref={exportMenuRef}
          >
            <button
              type="button"
              className="topbar-save topbar-save-main"
              onClick={() => {
                setIsExportMenuOpen(false);
                exportRenamedSchematic();
              }}
              disabled={!canSaveSchematic}
              title={`${hasEditChanges ? 'Export edited build' : 'Export schematic'} as ${currentExportFormatOption.label}`}
            >
              <Download size={16} />
              <span>Export</span>
            </button>
            <button
              type="button"
              className="topbar-save topbar-save-toggle"
              onClick={() => setIsExportMenuOpen((open) => !open)}
              aria-label="Choose export format"
              aria-haspopup="menu"
              aria-expanded={isExportMenuOpen}
              title={`Choose export format (${currentExportFormatOption.shortLabel})`}
            >
              <ChevronDown size={16} className="topbar-save-chevron" />
            </button>
            <div className="topbar-export-menu" role="menu" aria-label="Save format">
              {exportFormatOptions.map((option) => {
                const isActive = option.value === exportFormat;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    className={`topbar-export-option${isActive ? ' is-active' : ''}`}
                    aria-checked={isActive}
                    onClick={() => {
                      setExportFormat(option.value);
                      setIsExportMenuOpen(false);
                    }}
                    title={`Save as ${option.label}`}
                  >
                    <span className="topbar-export-option-copy">
                      <strong>{option.shortLabel}</strong>
                      <span>{option.description}</span>
                    </span>
                    {isActive ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <div className={`workspace${leftRailCollapsed ? ' is-left-rail-collapsed' : ''}${controlRailSide === 'left' ? ' is-control-rail-left' : ''}${appView === 'shopping' || appView === 'shulker' || appView === 'audit' ? ' is-shopping' : ''}${appView === 'resource' ? ' is-resource' : ''}${appView === 'audit' ? ' is-audit' : ''}${thumbnailDebugActive ? ' is-thumbnail-debug' : ''}`}>
        <aside className="left-rail" aria-label="Primary navigation">
          <div className="rail-head">
            <span className="rail-head-title">Tools</span>
            <button
              type="button"
              className="rail-collapse-button"
              onClick={() => setLeftRailCollapsed((value) => !value)}
              aria-label={leftRailCollapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
              aria-expanded={!leftRailCollapsed}
              title={leftRailCollapsed ? 'Expand rail' : 'Collapse rail'}
            >
              {leftRailCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>

          <div className="rail-cluster" role="tablist" aria-label="Workspace mode">
            <button
              type="button"
              role="tab"
              className={appView === 'inspect' && inspectorTab === 'materials' ? 'is-active' : ''}
              onClick={() => openInspectorPanel('materials')}
              aria-selected={appView === 'inspect' && inspectorTab === 'materials'}
              aria-label="Inspect"
              title="Inspect"
              disabled={!model}
            >
              <Search size={19} />
              <span>Inspect</span>
            </button>
            {UV_VIEW_ENABLED && (
              <button
                type="button"
                role="tab"
                className={textureViewActive ? 'is-active' : ''}
                onClick={() => setAppView('texture')}
                aria-selected={textureViewActive}
                aria-label="UV"
                title="UV"
                disabled={!model}
              >
                <ImageIcon size={19} />
                <span>UV</span>
              </button>
            )}
            <button
              type="button"
              role="tab"
              className={appView === 'resource' ? 'is-active' : ''}
              onClick={openResourceCalculator}
              aria-selected={appView === 'resource'}
              aria-label="Resource Calculator"
              title="Resource Calculator"
              disabled={!model}
            >
              <ClipboardList size={19} />
              <span>Resource Calculator</span>
            </button>
            <button
              type="button"
              role="tab"
              className={appView === 'shopping' ? 'is-active' : ''}
              onClick={openShoppingList}
              aria-selected={appView === 'shopping'}
              aria-label="Shopping List"
              title="Shopping List"
              disabled={!model}
            >
              <ShoppingCart size={19} />
              <span>Shopping List</span>
            </button>
            <button
              type="button"
              role="tab"
              className={appView === 'shulker' ? 'is-active' : ''}
              onClick={openShulkerView}
              aria-selected={appView === 'shulker'}
              aria-label="Shulker Box View"
              title="Shulker Box View"
              disabled={!model}
            >
              <Box size={19} />
              <span>Shulker Box View</span>
            </button>
            <button
              type="button"
              role="tab"
              className={appView === 'audit' ? 'is-active' : ''}
              onClick={openAuditView}
              aria-selected={appView === 'audit'}
              aria-label="Audit"
              title="Audit"
              disabled={!model}
            >
              <ShieldAlert size={19} />
              <span>Audit</span>
            </button>
            {THUMBNAIL_DEBUG_ENABLED ? (
              <button
                type="button"
                role="tab"
                className={thumbnailDebugActive ? 'is-active' : ''}
                onClick={openThumbnailDebug}
                aria-selected={thumbnailDebugActive}
                aria-label="Thumbnail Debug"
                title="Thumbnail Debug"
              >
                <SlidersHorizontal size={19} />
                <span>Thumbnail Debug</span>
              </button>
            ) : null}
          </div>

          <div
            className="rail-dropzone"
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <FileUp size={22} />
            <p>Import an existing schematic any time.</p>
            <span className="or">or</span>
            <button type="button" className="rail-browse" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>
              <span>Browse Files</span>
            </button>
          </div>

          <div className="rail-spacer" />

          <div className="rail-bottom-actions">
            <button
              type="button"
              className={`topbar-icon-btn${isDarkTheme ? ' is-on' : ''}`}
              onClick={toggleTheme}
              title={isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label={isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-pressed={isDarkTheme}
            >
              {isDarkTheme ? <Sun size={18} /> : <Moon size={18} />}
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
          className={`viewport-panel${appView === 'shopping' || appView === 'shulker' || appView === 'resource' || appView === 'audit' || thumbnailDebugActive ? ' shopping-viewport' : ''}${appView === 'resource' ? ' resource-viewport' : ''}${appView === 'shulker' ? ' shulker-viewport' : ''}${appView === 'audit' ? ' audit-viewport' : ''}${thumbnailDebugActive ? ' thumbnail-debug-viewport' : ''}${selectedBlock && !textureViewActive && appView !== 'shopping' && appView !== 'shulker' && appView !== 'resource' && appView !== 'audit' && !thumbnailDebugActive ? ' has-selection-modal' : ''}`}
          aria-label={appView === 'resource' ? 'Resource Calculator' : appView === 'shulker' ? 'Shulker Box View' : appView === 'shopping' ? 'Shopping list' : appView === 'audit' ? 'Schematic audit' : thumbnailDebugActive ? 'Thumbnail debug' : 'Schematic 3D viewport'}
        >
          <div className={`persistent-viewer${persistentViewerHidden ? ' is-hidden' : ''}`} aria-hidden={persistentViewerHidden}>
            <Viewer3D
              model={displayedModel}
              cameraMode={cameraMode}
              spectatorSpeed={spectatorSpeed}
              visibleBottomLayer={renderedVisibleBottomLayer}
              visibleTopLayer={renderedVisibleTopLayer}
              autoRotate={false}
              showGrid={showGrid}
              theme={theme}
              stageBackgroundColor={stageBackgroundColor}
              hiddenMaterialIds={hiddenMaterialIds}
              playerHeadSelections={playerHeadSelections}
              selectedBlock={selectedBlock}
              placementPreviewBlock={appView === 'edit' && selectedBuildBlock !== 'minecraft:air' ? selectedBuildBlockPreview : null}
              cuboidBounds={cuboidBounds}
              cuboidCorners={cuboidCorners}
              showCuboidCornerLabels={appView === 'inspect' && inspectorTab === 'selection' && Boolean(cuboidBounds)}
              rotationTarget={appView === 'edit' && rotateTargetLabel ? (materialsScope === 'cuboid' && cuboidBounds ? 'cuboid' : 'block') : null}
              rotationControlRef={rotationControlsRef}
              textureAdjustments={textureAdjustments}
              active={!persistentViewerHidden}
              onBlockSelect={handleBlockSelect}
              onAxisOrientationChange={updateAxisGizmo}
              onReady={handleViewerReady}
              viewerRef={viewerRef}
            />
          </div>
          {loadState === 'loading' ? (
            <div className="load-progress" role="status" aria-live="polite">
              <div className="load-spinner" aria-hidden="true" />
              <strong>Loading schematic</strong>
              <span>{loadProgressMessage}</span>
            </div>
          ) : thumbnailDebugActive ? (
            <section className="thumbnail-debug-board" aria-label="Thumbnail debug catalog">
              <div className="thumbnail-debug-header">
                <div className="shopping-title-block">
                  <p className="eyebrow">Thumbnail Debug</p>
                  <h2>Preview Defaults</h2>
                </div>
                <div className="thumbnail-debug-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetSelectedThumbnailDisplayAdjustment}
                    disabled={!selectedThumbnailDebugItem || !thumbnailDisplayAdjustments[selectedThumbnailDebugItem.key]}
                  >
                    <RotateCcw size={16} />
                    Reset Selected
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetAllThumbnailDisplayAdjustments}
                    disabled={adjustedThumbnailItemCount === 0}
                  >
                    <X size={16} />
                    Reset All
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={copyThumbnailDisplayAdjustments}
                  >
                    {thumbnailAdjustmentsCopied ? <Check size={15} aria-hidden="true" /> : <ClipboardList size={15} aria-hidden="true" />}
                    {thumbnailAdjustmentsCopied ? 'Copied JSON' : 'Copy JSON'}
                  </button>
                </div>
              </div>

              <div className="thumbnail-debug-toolbar">
                <label className="material-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={thumbnailDebugSearch}
                    onChange={(event) => setThumbnailDebugSearch(event.target.value)}
                    placeholder="Search blocks, items, or ids"
                    aria-label="Search thumbnail debug items"
                  />
                </label>
                <div className="thumbnail-debug-summary" aria-label="Thumbnail debug summary">
                  <span>{filteredThumbnailDebugItems.length.toLocaleString()} visible</span>
                  <span>{thumbnailDebugItems.length.toLocaleString()} total</span>
                  <span>{adjustedThumbnailItemCount.toLocaleString()} adjusted</span>
                </div>
              </div>

              <div className="thumbnail-debug-layout">
                <section className="thumbnail-debug-catalog" aria-label="Thumbnail catalog">
                  <div className="thumbnail-debug-grid">
                    {filteredThumbnailDebugItems.map((item) => {
                      const isSelected = selectedThumbnailDebugItem?.key === item.key;
                      const hasAdjustment = Boolean(thumbnailDisplayAdjustments[item.key]);

                      return (
                        <button
                          type="button"
                          key={item.key}
                          className={`thumbnail-debug-card${isSelected ? ' is-selected' : ''}${hasAdjustment ? ' is-adjusted' : ''}`}
                          onClick={() => setSelectedThumbnailDebugKey(item.key)}
                          aria-pressed={isSelected}
                        >
                          <span className="thumbnail-debug-card-preview">
                            <BlockPreview
                              stateKey={item.stateKey}
                              color={item.color}
                              layers={item.layers}
                            />
                          </span>
                          <span className="thumbnail-debug-card-meta">
                            <strong>{item.label}</strong>
                            <span>{item.family === 'block' ? 'Block' : 'Item'}</span>
                            <small>{item.stateKey}</small>
                          </span>
                        </button>
                      );
                    })}
                    {filteredThumbnailDebugItems.length === 0 && (
                      <p className="material-empty">No thumbnail entries match "{thumbnailDebugSearch.trim()}".</p>
                    )}
                  </div>
                </section>

                <aside className="thumbnail-debug-editor" aria-label="Thumbnail adjustment editor">
                  {selectedThumbnailDebugItem ? (
                    <>
                      <div className="thumbnail-debug-editor-head">
                        <div>
                          <p className="eyebrow">{selectedThumbnailDebugItem.family === 'block' ? 'Block' : 'Item'}</p>
                          <h3>{selectedThumbnailDebugItem.label}</h3>
                        </div>
                        {thumbnailDisplayAdjustments[selectedThumbnailDebugItem.key] && (
                          <span className="thumbnail-debug-adjusted-pill">Adjusted</span>
                        )}
                      </div>

                      <div className="thumbnail-debug-preview-stage">
                        <div className="thumbnail-debug-preview-samples">
                          <div>
                            <span>Small</span>
                            <BlockPreview
                              stateKey={selectedThumbnailDebugItem.stateKey}
                              color={selectedThumbnailDebugItem.color}
                              layers={selectedThumbnailDebugItem.layers}
                              size={28}
                            />
                          </div>
                          <div>
                            <span>Default</span>
                            <BlockPreview
                              stateKey={selectedThumbnailDebugItem.stateKey}
                              color={selectedThumbnailDebugItem.color}
                              layers={selectedThumbnailDebugItem.layers}
                              size={42}
                            />
                          </div>
                          <div>
                            <span>Large</span>
                            <BlockPreview
                              stateKey={selectedThumbnailDebugItem.stateKey}
                              color={selectedThumbnailDebugItem.color}
                              layers={selectedThumbnailDebugItem.layers}
                              size={68}
                            />
                          </div>
                        </div>
                      </div>

                      <dl className="thumbnail-debug-facts">
                        <div>
                          <dt>State Key</dt>
                          <dd>{selectedThumbnailDebugItem.stateKey}</dd>
                        </div>
                        <div>
                          <dt>Facing</dt>
                          <dd>{selectedThumbnailOrientation?.label ?? 'Not direction-aware'}</dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>{selectedThumbnailDebugItem.category}</dd>
                        </div>
                        <div>
                          <dt>Sources</dt>
                          <dd>{selectedThumbnailDebugItem.sources.join(' · ')}</dd>
                        </div>
                      </dl>

                      <div className="thumbnail-debug-controls">
                        <label className="thumbnail-debug-control">
                          <div>
                            <span>Scale</span>
                            <strong>{selectedThumbnailDisplayAdjustment.scale.toFixed(2)}x</strong>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="2.4"
                            step="0.05"
                            value={selectedThumbnailDisplayAdjustment.scale}
                            onChange={(event) => updateSelectedThumbnailScale(Number(event.target.value))}
                          />
                        </label>

                        <div className="thumbnail-debug-control">
                          <div>
                            <span>Rotate Around Y</span>
                            <strong>{selectedThumbnailOrientation?.label ?? 'No directional state'}</strong>
                          </div>
                          <div className="thumbnail-debug-direction-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => rotateSelectedThumbnailPreview('counterclockwise')}
                              disabled={!selectedThumbnailPreviewRequest || thumbnailPreviewRequestsEqual(
                                rotateThumbnailPreviewRequestY(selectedThumbnailPreviewRequest, 'counterclockwise'),
                                selectedThumbnailPreviewRequest,
                              )}
                            >
                              <RotateCcw size={16} />
                              Rotate Left
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => rotateSelectedThumbnailPreview('clockwise')}
                              disabled={!selectedThumbnailPreviewRequest || thumbnailPreviewRequestsEqual(
                                rotateThumbnailPreviewRequestY(selectedThumbnailPreviewRequest, 'clockwise'),
                                selectedThumbnailPreviewRequest,
                              )}
                            >
                              <RotateCw size={16} />
                              Rotate Right
                            </button>
                          </div>
                        </div>

                        <div className="thumbnail-debug-control">
                          <div>
                            <span>Set Facing</span>
                            <strong>Changes the rendered block state</strong>
                          </div>
                          {selectedThumbnailAxes.length > 0 && (
                            <div className="thumbnail-debug-direction-actions" role="group" aria-label="Set axis">
                              {(['x', 'y', 'z'] as const).map((axis) => {
                                const nextRequest = selectedThumbnailPreviewRequest
                                  ? setThumbnailPreviewRequestAxis(selectedThumbnailPreviewRequest, axis)
                                  : null;
                                const isActive = selectedThumbnailPreviewRequest && nextRequest
                                  ? thumbnailPreviewRequestsEqual(nextRequest, selectedThumbnailPreviewRequest)
                                  : false;

                                return (
                                  <button
                                    type="button"
                                    key={axis}
                                    className={`secondary-button${isActive ? ' is-active' : ''}`}
                                    onClick={() => setSelectedThumbnailAxis(axis)}
                                    disabled={!selectedThumbnailPreviewRequest || !canSetThumbnailPreviewRequestAxis(selectedThumbnailPreviewRequest, axis)}
                                    aria-pressed={isActive}
                                  >
                                    Axis {axis.toUpperCase()}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {selectedThumbnailHorizontalDirections.length > 0 && (
                            <div className="thumbnail-debug-direction-grid" role="group" aria-label="Set horizontal facing">
                              {(['north', 'east', 'south', 'west'] as const).map((direction) => {
                                const nextRequest = selectedThumbnailPreviewRequest
                                  ? setThumbnailPreviewRequestDirection(selectedThumbnailPreviewRequest, direction)
                                  : null;
                                const isActive = selectedThumbnailPreviewRequest && nextRequest
                                  ? thumbnailPreviewRequestsEqual(nextRequest, selectedThumbnailPreviewRequest)
                                  : false;

                                return (
                                  <button
                                    type="button"
                                    key={direction}
                                    className={`secondary-button${isActive ? ' is-active' : ''}`}
                                    onClick={() => setSelectedThumbnailDirection(direction)}
                                    disabled={!selectedThumbnailPreviewRequest || !canSetThumbnailPreviewRequestDirection(selectedThumbnailPreviewRequest, direction)}
                                    aria-pressed={isActive}
                                  >
                                    {direction}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {selectedThumbnailVerticalDirections.length > 0 && (
                            <div className="thumbnail-debug-direction-actions" role="group" aria-label="Set vertical facing">
                              {(['up', 'down'] as const).map((direction) => {
                                const nextRequest = selectedThumbnailPreviewRequest
                                  ? setThumbnailPreviewRequestDirection(selectedThumbnailPreviewRequest, direction)
                                  : null;
                                const isActive = selectedThumbnailPreviewRequest && nextRequest
                                  ? thumbnailPreviewRequestsEqual(nextRequest, selectedThumbnailPreviewRequest)
                                  : false;

                                return (
                                  <button
                                    type="button"
                                    key={direction}
                                    className={`secondary-button${isActive ? ' is-active' : ''}`}
                                    onClick={() => setSelectedThumbnailDirection(direction)}
                                    disabled={!selectedThumbnailPreviewRequest || !canSetThumbnailPreviewRequestDirection(selectedThumbnailPreviewRequest, direction)}
                                    aria-pressed={isActive}
                                  >
                                    {direction}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {selectedThumbnailAxes.length === 0
                            && selectedThumbnailHorizontalDirections.length === 0
                            && selectedThumbnailVerticalDirections.length === 0 && (
                            <p className="thumbnail-debug-control-note">This preview does not expose a directional state we can override yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="thumbnail-debug-export">
                        <div className="thumbnail-debug-export-head">
                          <strong>Default JSON</strong>
                          <span>Copy this into the thumbnail defaults map.</span>
                        </div>
                        <pre>{JSON.stringify(exportedThumbnailDisplayAdjustments, null, 2)}</pre>
                      </div>
                    </>
                  ) : (
                    <p className="material-empty">Choose a thumbnail from the catalog to start adjusting its default display.</p>
                  )}
                </aside>
              </div>
            </section>
          ) : appView === 'resource' && model ? (
            <section className="shopping-board resource-board" aria-label="Resource Calculator">
              <div className="shopping-header">
                <div className="shopping-title-block">
                  <p className="eyebrow">Crafting Plan</p>
                  <h2>{schematicName}</h2>
                </div>
                <div className="shopping-actions">
                  <a
                    className="primary-button resource-calculator-link"
                    href={resourceCalculatorUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open ${activeMaterials.length.toLocaleString()} material types in ResourceCalculator.com`}
                  >
                    <ExternalLink size={16} />
                    Open in ResourceCalculator
                  </a>
                  <div className="segmented-control shopping-scope" role="group" aria-label="Crafting plan scope">
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
                </div>
              </div>

              <div className="resource-bases-bar">
                <p className="resource-bases-hint">
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  <span>
                    Glass and dyes count as base materials. <strong>Break down</strong> any item to expand it
                    into its recipe, or <strong>Use as base</strong> to treat a crafted item as one you already have.
                  </span>
                </p>
                {materialBaseOverrideCount > 0 && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetMaterialBases}
                    title="Restore the default base materials"
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    Reset bases ({materialBaseOverrideCount})
                  </button>
                )}
              </div>

              <div className="craft-plan" aria-label="Crafting plan">
                <aside className="craft-plan-ingredients" aria-label="Base ingredients">
                  <div className="craft-plan-ingredients-head">
                    <h3>Base Ingredients</h3>
                    <span>{rawMaterials.length} types</span>
                  </div>
                  <div
                    className="craft-plan-progress"
                    style={{ '--plan-progress': `${rawMaterials.length ? Math.round((rawMaterials.filter((m) => checkedPlanSteps.has(`raw:${m.id}`)).length / rawMaterials.length) * 100) : 0}%` } as CSSProperties}
                  >
                    <span>{rawMaterials.length ? Math.round((rawMaterials.filter((m) => checkedPlanSteps.has(`raw:${m.id}`)).length / rawMaterials.length) * 100) : 0}% gathered</span>
                  </div>
                  <div className="craft-plan-ingredient-list">
                    {rawMaterials.map((material) => {
                      const key = `raw:${material.id}`;
                      const checked = checkedPlanSteps.has(key);
                      const breakable = canBreakDown(material.id);
                      const forcedBase = materialBaseModes.get(material.id) === 'base';
                      return (
                        <div className="craft-plan-ingredient-row" key={material.id}>
                          <button
                            type="button"
                            className={`craft-plan-ingredient${checked ? ' is-checked' : ''}`}
                            onClick={() => setCheckedPlanSteps((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key); else next.add(key);
                              return next;
                            })}
                            aria-pressed={checked}
                          >
                            <span className={`plan-check${checked ? ' is-on' : ''}`}>{checked && <Check size={12} strokeWidth={3} />}</span>
                            <MaterialPreview stateKey={material.stateKey} color={material.color} layers={material.thumbnailLayers} />
                            <span className="plan-ing-meta">
                              <strong>{material.label}{forcedBase && <span className="base-tag">base</span>}</strong>
                              <span>{material.count.toLocaleString()} · {Math.ceil(material.count / 64)} stacks</span>
                            </span>
                          </button>
                          {breakable && (
                            <button
                              type="button"
                              className="base-toggle-btn"
                              onClick={() => setMaterialBaseMode(material.id, 'craft')}
                              title={`Break ${material.label} down into its recipe`}
                            >
                              <ChevronDown size={13} aria-hidden="true" />
                              Break down
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {rawMaterials.length === 0 && <p className="material-empty">No base ingredients to gather.</p>}
                  </div>
                </aside>

                <div className="craft-plan-flow" aria-label="Crafting flow">
                  {craftPlan.groups.map((group) => (
                    <section className="craft-plan-group" key={group.id}>
                      <div className="craft-plan-group-head">
                        <h3>{group.label}</h3>
                        <span>{group.steps.length} {group.steps.length === 1 ? 'step' : 'steps'}</span>
                      </div>
                      <div className="craft-plan-steps">
                        {group.steps.map((step) => {
                          const checked = checkedPlanSteps.has(`step:${step.id}`);
                          const stepRecipes = getRecipes(step.id);
                          const selectedRecipeIndex = chooseRecipeIndex(step.id, breakdownOptions);
                          return (
                            <div className={`craft-plan-step${checked ? ' is-checked' : ''}`} key={step.id}>
                              <div className="craft-plan-step-main">
                                <div className="craft-plan-inputs">
                                  {step.inputs.map((input) => (
                                    <div className="craft-plan-chip" key={input.id}>
                                      <MaterialPreview stateKey={input.stateKey} color={input.color} layers={input.thumbnailLayers} />
                                      <span className="chip-label">{input.label}</span>
                                      <span className="chip-count">{input.count.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="craft-plan-arrow" aria-hidden="true">
                                  <span className="craft-plan-method">{recipeTypeLabel(step.method)}</span>
                                  <ChevronRight size={18} />
                                </div>
                                <button
                                  type="button"
                                  className="craft-plan-output"
                                  onClick={() => setCheckedPlanSteps((current) => {
                                    const next = new Set(current);
                                    const k = `step:${step.id}`;
                                    if (next.has(k)) next.delete(k); else next.add(k);
                                    return next;
                                  })}
                                  aria-pressed={checked}
                                >
                                  <span className={`plan-check${checked ? ' is-on' : ''}`}>{checked && <Check size={12} strokeWidth={3} />}</span>
                                  <MaterialPreview stateKey={step.stateKey} color={step.color} layers={step.thumbnailLayers} />
                                  <span className="plan-out-meta">
                                    <strong>{step.label}</strong>
                                    <span>{step.count.toLocaleString()} · {step.crafts.toLocaleString()} {step.crafts === 1 ? 'craft' : 'crafts'}</span>
                                  </span>
                                </button>
                              </div>
                              <div className="craft-plan-step-actions">
                                {stepRecipes.length > 1 && (
                                  <label className="recipe-pick">
                                    <span>Source</span>
                                    <select
                                      value={selectedRecipeIndex}
                                      onChange={(event) => setMaterialRecipeChoice(step.id, Number(event.target.value))}
                                    >
                                      {stepRecipes.map((recipe, index) => (
                                        <option key={index} value={index}>{describeRecipeSource(recipe)}</option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                                <button
                                  type="button"
                                  className="base-toggle-btn"
                                  onClick={() => setMaterialBaseMode(step.id, 'base')}
                                  title={`Treat ${step.label} as a base material you already have`}
                                >
                                  <Box size={13} aria-hidden="true" />
                                  Use as base
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                  {craftPlan.groups.length === 0 && (
                    <p className="material-empty">No crafting steps — every material is gathered directly.</p>
                  )}
                </div>

                <aside className="craft-plan-queue" aria-label="Do next">
                  <div className="craft-plan-queue-head">
                    <h3>Do Next</h3>
                    <span className="queue-badge">{craftPlan.steps.filter((s) => !checkedPlanSteps.has(`step:${s.id}`)).length}</span>
                  </div>
                  <div className="craft-plan-queue-list">
                    {craftPlan.steps.map((step, index) => {
                      const checked = checkedPlanSteps.has(`step:${step.id}`);
                      const fromLabel = step.inputs.map((input) => input.label).join(' + ');
                      return (
                        <button
                          type="button"
                          key={step.id}
                          className={`craft-plan-queue-item${checked ? ' is-checked' : ''}`}
                          onClick={() => setCheckedPlanSteps((current) => {
                            const next = new Set(current);
                            const k = `step:${step.id}`;
                            if (next.has(k)) next.delete(k); else next.add(k);
                            return next;
                          })}
                          aria-pressed={checked}
                        >
                          <span className="queue-index">{index + 1}</span>
                          <MaterialPreview stateKey={step.stateKey} color={step.color} layers={step.thumbnailLayers} />
                          <span className="queue-meta">
                            <strong>{recipeTypeLabel(step.method)} {step.label}</strong>
                            <span className="queue-count">{step.count.toLocaleString()} ({step.crafts.toLocaleString()} {step.crafts === 1 ? 'craft' : 'crafts'})</span>
                            <span className="queue-from">From {fromLabel}</span>
                          </span>
                          <span className={`plan-check${checked ? ' is-on' : ''}`}>{checked && <Check size={12} strokeWidth={3} />}</span>
                        </button>
                      );
                    })}
                    {craftPlan.steps.length === 0 && <p className="material-empty">Nothing to craft.</p>}
                  </div>
                </aside>
              </div>
            </section>
          ) : appView === 'shulker' && model ? (
            <section className="shopping-board shulker-board" aria-label="Shulker Box View">
              <div className="shopping-header">
                <div className="shopping-title-block">
                  <p className="eyebrow">Shulker Box View</p>
                  <h2>{schematicName}</h2>
                </div>
                <div className="shopping-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetShulkerCompletion}
                    disabled={checkedShulkerSlotCount === 0}
                    title="Reset completed slots for this shulker view"
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    Reset
                  </button>
                </div>
              </div>

              <div className="shopping-toolbar shulker-toolbar">
                <div className="segmented-control shopping-scope" role="group" aria-label="Shulker box scope">
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
                <div className="shulker-toolbar-right">
                  {shulkerViewMode === 'type' && (
                    <button
                      type="button"
                      className={`shulker-consolidate-button${shulkerTypeAutoConsolidated ? ' is-active' : ''}`}
                      onClick={() => setShulkerTypeAutoConsolidated((current) => !current)}
                      disabled={shulkerConsolidatableBoxCount < 2}
                      role="switch"
                      aria-checked={shulkerTypeAutoConsolidated}
                      title={shulkerConsolidatableBoxCount < 2
                        ? 'At least two boxes under half full are needed'
                        : 'Combine boxes with fewer than half their slots filled'}
                    >
                      <span className="shulker-consolidate-copy">
                        <span className="shulker-consolidate-label">Auto-consolidate</span>
                        <span className="shulker-consolidate-subtitle">Group similar items</span>
                      </span>
                      <span className="shulker-consolidate-switch" aria-hidden="true">
                        <span className="shulker-consolidate-thumb">
                          <Check size={13} strokeWidth={3} />
                        </span>
                      </span>
                    </button>
                  )}
                  <div className="segmented-control shulker-mode-toggle" role="group" aria-label="Organize shulker boxes">
                    <button
                      type="button"
                      className={shulkerViewMode === 'box' ? 'is-active' : ''}
                      onClick={() => setShulkerViewMode('box')}
                      aria-pressed={shulkerViewMode === 'box'}
                    >
                      By Box
                    </button>
                    <button
                      type="button"
                      className={shulkerViewMode === 'type' ? 'is-active' : ''}
                      onClick={() => setShulkerViewMode('type')}
                      aria-pressed={shulkerViewMode === 'type'}
                    >
                      By Item Type
                    </button>
                  </div>
                </div>
              </div>

              <div className="shulker-list" aria-live="polite">
                {visibleShulkerBoxes.map((box) => {
                  const checkedSlotCount = box.filledSlotKeys.filter((key) => checkedShulkerSlots.has(key)).length;
                  const isBoxChecked = box.filledSlotKeys.length > 0 && checkedSlotCount === box.filledSlotKeys.length;
                  const isBoxCollapsed = collapsedShulkerBoxes.has(box.id);
                  const boxItemsId = `shulker-box-${box.id}`;

                  return (
                    <section
                      className={`shulker-card${isBoxChecked ? ' is-complete' : ''}${isBoxCollapsed ? ' is-collapsed' : ''}`}
                      key={box.id}
                      aria-label={box.label}
                      style={{
                        '--shulker-accent': shulkerColorCss(box.color),
                      } as CSSProperties}
                    >
                      <div className="shulker-card-head">
                        <div className="shulker-card-title">
                          <BlockPreview
                            stateKey={shulkerBoxStateKey(box.color)}
                            color={shulkerBoxPreviewColor(box.color)}
                            size={38}
                          />
                          <h3>{box.label}</h3>
                        </div>
                        <div className="shulker-card-actions">
                          <span className="shulker-card-progress">
                            {checkedSlotCount.toLocaleString()} / {box.usedSlots.toLocaleString()} complete
                          </span>
                          {isBoxChecked && <span className="shopping-group-done-chip">Done</span>}
                          <button
                            type="button"
                            className="shopping-group-toggle shulker-group-toggle"
                            onClick={() => toggleShulkerBoxCompletion(box)}
                            aria-pressed={isBoxChecked}
                          >
                            <CheckCircle2 size={15} aria-hidden="true" />
                            {isBoxChecked ? 'Clear group' : 'Mark all complete'}
                          </button>
                          <button
                            type="button"
                            className="shopping-group-collapse shulker-card-collapse"
                            onClick={() => toggleShulkerBoxCollapsed(box.id)}
                            aria-expanded={!isBoxCollapsed}
                            aria-controls={isBoxCollapsed ? undefined : boxItemsId}
                            aria-label={`${isBoxCollapsed ? 'Expand' : 'Collapse'} ${box.label}`}
                          >
                            {isBoxCollapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
                          </button>
                        </div>
                      </div>
                      {!isBoxCollapsed && (
                        <div className="shulker-card-body" id={boxItemsId}>
                          <div className="shulker-card-body-inner">
                            <div className="shulker-grid" role="grid" aria-label={`${box.label} inventory`}>
                              {box.slots.map((slot, index) => {
                                if (!slot) {
                                  return (
                                    <div
                                      className="shulker-slot"
                                      key={`${box.id}-slot-${index}`}
                                      role="gridcell"
                                      aria-label="Empty slot"
                                    />
                                  );
                                }

                                const slotKey = box.slotKeys[index] ?? shulkerSlotKey(box.id, index, slot);
                                const isSlotChecked = checkedShulkerSlots.has(slotKey);

                                return (
                                  <button
                                    type="button"
                                    className={`shulker-slot has-item${isSlotChecked ? ' is-checked' : ''}`}
                                    key={`${box.id}-slot-${index}`}
                                    role="gridcell"
                                    aria-label={`${slot.material.label}, ${slot.count}. ${isSlotChecked ? 'Complete' : 'Not complete'}.`}
                                    aria-pressed={isSlotChecked}
                                    data-tooltip={slot.material.label}
                                    onPointerDown={(event) => handleShulkerSlotPointerDown(event, box, index, slot)}
                                    onClick={(event) => handleShulkerSlotClick(event, box, index, slot)}
                                  >
                                    <span className="shulker-slot-frame">
                                      <MaterialPreview
                                        stateKey={slot.material.stateKey}
                                        color={slot.material.color}
                                        layers={slot.material.thumbnailLayers}
                                        size={42}
                                      />
                                      <strong>{slot.count}</strong>
                                      <span className="shulker-slot-check" aria-hidden="true">
                                        <Check size={14} strokeWidth={3} />
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
                {visibleShulkerBoxCount < shulkerBoxes.length && (
                  <p className="shulker-loading-more" role="status" ref={shulkerLoadMoreRef}>
                    Loading {Math.min(visibleShulkerBoxCount, shulkerBoxes.length).toLocaleString()} of {shulkerBoxes.length.toLocaleString()} boxes
                  </p>
                )}
                {shulkerBoxes.length === 0 && (
                  <p className="material-empty">
                    {materialsScope === 'cuboid' && !cuboidBounds
                      ? 'Select an area to pack shulker boxes for that region.'
                      : 'No non-air blocks to pack into shulker boxes.'}
                  </p>
                )}
              </div>
            </section>
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
                    onClick={resetShoppingList}
                    disabled={checkedShoppingMaterialCount === 0}
                  >
                    <RotateCcw size={16} />
                    Reset
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
                  <strong>{checkedShoppingMaterialCount.toLocaleString()} / {activeMaterials.length.toLocaleString()}</strong>
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

              <div className={`shopping-list is-${shoppingLayout}`} aria-live="polite">
                {shoppingGroups.map((group) => {
                  const checkedGroupItems = group.materials.filter((material) => (
                    checkedShoppingItems.has(shoppingItemKey(shoppingScope, material))
                  )).length;
                  const isGroupChecked = checkedGroupItems === group.materials.length;
                  const isGroupCollapsed = collapsedShoppingGroups.has(group.id);
                  const groupItemsId = `shopping-group-${group.id}`;

                  return (
                    <section className={`shopping-group${isGroupCollapsed ? ' is-collapsed' : ''}`} key={group.id} aria-label={group.label}>
                      <div className="shopping-group-heading">
                        <div className="shopping-group-title">
                          <span className="shopping-group-label">{group.label}</span>
                          <span className="shopping-group-meta">
                            <strong>{checkedGroupItems.toLocaleString()} / {group.materials.length.toLocaleString()}</strong>
                            {isGroupChecked && <span className="shopping-group-done-chip">Done</span>}
                          </span>
                        </div>
                        <div className="shopping-group-summary">
                          <button
                            type="button"
                            className="shopping-group-toggle"
                            onClick={() => toggleShoppingGroup(group.materials)}
                            aria-pressed={isGroupChecked}
                          >
                            <CheckCircle2 size={15} aria-hidden="true" />
                            {isGroupChecked ? 'Clear group' : 'Mark all complete'}
                          </button>
                          <button
                            type="button"
                            className="shopping-group-collapse"
                            onClick={() => toggleShoppingGroupCollapsed(group.id)}
                            aria-expanded={!isGroupCollapsed}
                            aria-controls={groupItemsId}
                            aria-label={`${isGroupCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                          >
                            {isGroupCollapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
                          </button>
                        </div>
                      </div>
                      <div className="shopping-group-items" id={groupItemsId} hidden={isGroupCollapsed}>
                        {group.materials.map((material) => {
                          const itemKey = shoppingItemKey(shoppingScope, material);
                          const isChecked = checkedShoppingItems.has(itemKey);

                          return (
                            <button
                              type="button"
                              key={itemKey}
                              className={`shopping-item material-item${isChecked ? ' is-checked' : ''}`}
                              onPointerDown={(event) => handleShoppingItemPointerDown(event, material)}
                              onClick={(event) => handleShoppingItemClick(event, material)}
                              aria-pressed={isChecked}
                            >
                              <span className="material-row shopping-material-row">
                                <span className="material-pick shopping-pick">
                                  <MaterialPreview
                                    stateKey={material.stateKey}
                                    color={material.color}
                                    layers={material.thumbnailLayers}
                                  />
                                  <span className="material-name">{material.label}</span>
                                  <span className="material-actions shopping-item-actions">
                                    {shouldShowCompactMaterialBreakdown(material.id, material.count) && (
                                      <span className="material-breakdown shopping-breakdown">
                                        <MaterialBreakdown materialId={material.id} count={material.count} compact />
                                      </span>
                                    )}
                                    <strong className="material-count-badge">{material.count.toLocaleString()}</strong>
                                    <Check className="shopping-checkmark" size={15} aria-hidden="true" />
                                  </span>
                                </span>
                              </span>
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
              </div>
            </section>
          ) : appView === 'audit' && model ? (
            <section className="shopping-board audit-board" aria-label="Schematic audit report">
              <div className="shopping-header">
                <div className="shopping-title-block">
                  <p className="eyebrow">Audit</p>
                  <h2>Technical &amp; Hidden Blocks</h2>
                </div>
              </div>

              <div className="shopping-toolbar audit-toolbar">
                <p className="audit-summary">
                  {auditFlaggedCount === 0
                    ? 'No flagged blocks found.'
                    : `${auditFlaggedCount.toLocaleString()} flagged block${auditFlaggedCount === 1 ? '' : 's'} across ${auditFindings.length} type${auditFindings.length === 1 ? '' : 's'}.`}
                </p>
              </div>

              {auditFindings.length === 0 ? (
                <p className="material-empty">
                  This schematic contains no light blocks, barriers, command blocks, or other technical or hidden blocks.
                </p>
              ) : (
                <div className="audit-list">
                  {auditFindings.map((finding) => {
                    const category = finding.category;
                    const Icon = auditCategoryIcon(category);
                    const isExpanded = expandedAuditGroups.has(category.id);
                    const choice = auditReplaceChoice[category.id] ?? AUDIT_RECOMMENDED;
                    const itemsId = `audit-items-${category.id}`;

                    return (
                      <section className="shopping-group audit-group" key={category.id}>
                        <div className="audit-group-head">
                          <button
                            type="button"
                            className="audit-group-toggle"
                            onClick={() => toggleAuditGroup(category.id)}
                            aria-expanded={isExpanded}
                            aria-controls={itemsId}
                          >
                            <span className="audit-group-icon"><Icon size={18} /></span>
                            <span className="audit-group-title">{category.label}</span>
                            <span className="audit-count">{finding.occurrences.length.toLocaleString()}</span>
                            <ChevronDown size={16} className={`audit-chevron${isExpanded ? ' is-open' : ''}`} />
                          </button>
                          <p className="audit-desc">
                            {category.description}
                            {category.note ? ` ${category.note}` : ''}
                          </p>
                          <div className="audit-controls">
                            <label className="audit-replace-pick">
                              <span>Replace with</span>
                              <select
                                value={choice}
                                onChange={(event) =>
                                  setAuditReplaceChoice((current) => ({ ...current, [category.id]: event.target.value }))}
                              >
                                <option value={AUDIT_RECOMMENDED}>{`Recommended — ${category.recommendedLabel}`}</option>
                                {allBuildBlocks.map((stateKey) => (
                                  <option key={stateKey} value={stateKey}>{formatBlockName(stateKey)}</option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => applyAuditCategory(finding, choice)}
                            >
                              <Replace size={15} />
                              Replace all
                            </button>
                            <button
                              type="button"
                              className="secondary-button audit-danger"
                              onClick={() => applyAuditCategory(finding, 'minecraft:air')}
                            >
                              <Trash2 size={15} />
                              Delete all
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <ul className="audit-occurrences" id={itemsId}>
                            {finding.occurrences.map((block) => {
                              const key = blockPositionKey(block);
                              const meta = category.metadata(block);
                              const nbtOpen = openAuditNbt.has(key);

                              return (
                                <li className="audit-item" key={key}>
                                  <div className="audit-item-row">
                                    <code className="audit-coord">
                                      {model.origin.x + block.x}, {model.origin.y + block.y}, {model.origin.z + block.z}
                                    </code>
                                    <div className="audit-meta">
                                      {meta.length === 0 ? (
                                        <span className="audit-chip is-muted">No extra data</span>
                                      ) : (
                                        meta.map((entry, index) => (
                                          <span className="audit-chip" key={index}>
                                            <span className="audit-chip-label">{entry.label}</span>
                                            <span className="audit-chip-value">{entry.value}</span>
                                          </span>
                                        ))
                                      )}
                                    </div>
                                    <div className="audit-item-actions">
                                      <button
                                        type="button"
                                        className="audit-link"
                                        onClick={() => jumpToAuditBlock(block)}
                                        title="Show in 3D view"
                                      >
                                        <Focus size={14} />
                                        <span>Jump</span>
                                      </button>
                                      {block.blockEntity && (
                                        <button
                                          type="button"
                                          className="audit-link"
                                          onClick={() => toggleAuditNbt(key)}
                                          aria-expanded={nbtOpen}
                                          title="Show raw block-entity NBT"
                                        >
                                          <Braces size={14} />
                                          <span>NBT</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="audit-link audit-danger"
                                        onClick={() => eraseBlock(block)}
                                        title="Delete this block"
                                        aria-label="Delete this block"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                  {nbtOpen && block.blockEntity && (
                                    <div className="audit-nbt">
                                      <NbtTree nodes={describeNbt(block.blockEntity)} />
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          ) : (
            <>
          {selectedBlock && !textureViewActive && (
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
                title="Orbit camera"
                aria-label="Orbit camera"
              >
                <Orbit size={19} />
              </button>
              <button
                type="button"
                className={cameraMode === 'spectator' ? 'is-active' : ''}
                onClick={() => setCameraMode('spectator')}
                aria-pressed={cameraMode === 'spectator'}
                title="Fly camera"
                aria-label="Fly camera"
              >
                <Move3d size={19} />
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
                onClick={saveCameraView}
                title="Save camera position"
                aria-label="Save camera position"
                disabled={cameraMode === 'spectator'}
              >
                <Plus size={19} />
              </button>
            </div>
          </div>

          {savedCameraViews.length > 0 && !textureViewActive && (
            <div className="camera-saves" aria-label="Saved camera positions">
              {savedCameraViews.map((view) => (
                <div className="camera-save-row" key={view.id}>
                  <button type="button" onClick={() => applyCameraView(view.id)}>
                    {view.name}
                  </button>
                  <button
                    type="button"
                    className={view.isDefault ? 'is-active' : ''}
                    onClick={() => setDefaultCameraView(view.id)}
                    title={view.isDefault ? 'Default camera' : 'Set as default camera'}
                    aria-label={view.isDefault ? `${view.name} is the default camera` : `Set ${view.name} as default camera`}
                  >
                    <Focus size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCameraView(view.id)}
                    title={`Remove ${view.name}`}
                    aria-label={`Remove ${view.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {appView === 'inspect' && model && schematicOrigin === 'default' && (
            <FeaturedBuilder name="MildMadi" />
          )}

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

          <span className="mc-disclaimer">
            Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
          </span>

          {textureViewActive && (
            <div className="texture-compare-canvases" aria-label="Texture comparison previews">
              <div className="texture-compare-pane">
                <span>Default</span>
                <Viewer3D
                  model={texturePreviewModel}
                  cameraMode="orbit"
                  spectatorSpeed={spectatorSpeed}
                  visibleBottomLayer={0}
                  visibleTopLayer={0}
                  autoRotate={false}
                  showGrid={false}
                  theme={theme}
                  stageBackgroundColor={stageBackgroundColor}
                  hiddenMaterialIds={displayedHiddenMaterialIds}
                  playerHeadSelections={playerHeadSelections}
                  selectedBlock={null}
                  placementPreviewBlock={null}
                  cuboidBounds={null}
                  cuboidCorners={emptyCuboidCorners()}
                  showCuboidCornerLabels={false}
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
                  visibleBottomLayer={0}
                  visibleTopLayer={0}
                  autoRotate={false}
                  showGrid={false}
                  theme={theme}
                  stageBackgroundColor={stageBackgroundColor}
                  hiddenMaterialIds={displayedHiddenMaterialIds}
                  playerHeadSelections={playerHeadSelections}
                  selectedBlock={null}
                  placementPreviewBlock={null}
                  cuboidBounds={null}
                  cuboidCorners={emptyCuboidCorners()}
                  showCuboidCornerLabels={false}
                  textureAdjustments={textureAdjustments}
                  textureEditMode
                  onTextureFaceSelect={handleTextureFaceSelect}
                  onTextureFaceDrag={dragSelectedTexture}
                  onAxisOrientationChange={updateAxisGizmo}
                  viewerRef={viewerRef}
                />
              </div>
            </div>
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

        {textureViewActive ? (
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
                  <div className="control-rail-actions" role="presentation">
                    <button
                      type="button"
                      className={`control-rail-side-toggle${controlRailSide === 'left' ? ' is-on' : ' is-left-chevron'}`}
                      onClick={toggleControlRailSide}
                      title={controlRailSide === 'right' ? 'Move controls to left side' : 'Move controls to right side'}
                      aria-pressed={controlRailSide === 'left'}
                      aria-label={controlRailSide === 'right' ? 'Move controls to left side' : 'Move controls to right side'}
                    >
                      {controlRailSide === 'right' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                    </button>
                  </div>
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
                    onClick={() => (cuboidSelectionMode ? setCuboidSelectionMode(false) : beginCuboidSelection(hasCuboidSelection))}
                    title={cuboidSelectionMode ? 'Cancel area selection' : hasCuboidSelection ? 'Create new selected area' : 'Create selected area'}
                    aria-label={cuboidSelectionMode ? 'Cancel area selection' : hasCuboidSelection ? 'Create new selected area' : 'Create selected area'}
                    aria-pressed={cuboidSelectionMode}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={saveCurrentSelection}
                    title="Save selected area"
                    aria-label="Save selected area"
                    disabled={!cuboidBounds || Boolean(activeSelectionId)}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={undoCuboidSelection}
                    title="Undo selection change"
                    aria-label="Undo selection change"
                    disabled={selectionUndoStack.length === 0}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={selectVisibleLayers}
                    title="Select visible layers"
                    aria-label="Select visible layers"
                  >
                    <Layers size={16} />
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

              {selectionAreas.length > 0 && (
                <div className="selection-area-list" aria-label="Saved selected areas">
                  {selectionAreas.map((area) => {
                    const bounds = area.corners.a && area.corners.b ? normalizeCuboidBounds(area.corners.a, area.corners.b, model) : null;
                    const dimensions = bounds ? dimensionsForBounds(bounds) : null;
                    return (
                      <div className={`selection-area-row${area.id === activeSelectionId ? ' is-active' : ''}`} key={area.id}>
                        <button type="button" onClick={() => activateSelectionArea(area.id)}>
                          <strong>{area.name}</strong>
                          <span>{dimensions ? `${dimensions.width} x ${dimensions.height} x ${dimensions.length}` : 'Incomplete'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSelectionArea(area.id)}
                          title={`Remove ${area.name}`}
                          aria-label={`Remove ${area.name}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {cuboidBounds && cuboidDimensions ? (
                <>
                  <div className="cuboid-corner-editor" aria-label="Selected area corner coordinates">
                    <div className="cuboid-corner-editor-head">
                      <p>Selection bounds</p>
                      <Box size={16} strokeWidth={2.1} aria-hidden="true" />
                    </div>
                    <div className="cuboid-axis-header" aria-hidden="true">
                      <span className="cuboid-axis-header-spacer" />
                      {(['X', 'Y', 'Z'] as const).map((axis) => (
                        <span key={axis}>{axis}</span>
                      ))}
                    </div>
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
                    <div className="cuboid-move-panel" aria-label="Move selected area">
                      <div className="cuboid-corner-editor-head">
                        <p>Move selected area</p>
                        <Move3d size={16} strokeWidth={2.1} aria-hidden="true" />
                      </div>
                      <div className="cuboid-move-grid">
                        {(['up', 'down', 'north', 'south', 'west', 'east'] as Direction[]).map((direction) => {
                          const canMove = Boolean(cuboidBounds && boundsInsideModel(translateBounds(cuboidBounds, directionOffset(direction)), model));

                          return (
                            <button
                              type="button"
                              key={direction}
                              onClick={() => shiftSelectedArea(direction)}
                              disabled={!canMove}
                            >
                              {directionLabel(direction)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
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
              <section className="filtered-materials" aria-label="Selected Materials">
                <div className="filtered-materials-head">
                  <h3>Selected Materials</h3>
                  <span>
                    {selectionMaterialSearch.trim()
                      ? `${filteredCuboidMaterials.length.toLocaleString()} of ${cuboidMaterials.length.toLocaleString()} types`
                      : `${cuboidMaterials.length.toLocaleString()} types`}
                  </span>
                </div>
                <MaterialList
                  ariaLabel="Selected materials list"
                  materials={filteredCuboidMaterials}
                  selectedMaterialId={selectedMaterialId}
                  expandedMaterialIds={expandedMaterialIds}
                  hiddenMaterialIds={hiddenMaterialIds}
                  hasBreakdown={(material) => shouldShowCompactMaterialBreakdown(material.id, material.count)}
                  onToggleExpanded={toggleMaterialBreakdown}
                  onToggleVisibility={toggleMaterialVisibility}
                  renderPreview={(material) => (
                    <MaterialPreview stateKey={material.stateKey} color={material.color} layers={material.thumbnailLayers} />
                  )}
                  renderBreakdown={(material) => (
                    <MaterialBreakdown materialId={material.id} count={material.count} />
                  )}
                  onRotateMaterial={TEMP_THUMBNAIL_TOOLS ? rotateMaterialThumbnail : undefined}
                  emptyText={cuboidBounds ? 'No non-air blocks in this selection.' : 'Select an area to preview its materials.'}
                  searchValue={selectionMaterialSearch}
                  onSearchChange={setSelectionMaterialSearch}
                  searchPlaceholder="Search selected materials"
                  searchAriaLabel="Search selected materials"
                  emptySearchText={cuboidBounds ? (query) => `No selected materials match "${query}".` : undefined}
                />
              </section>
            </section>

            <section
              className={`layer-control inspector-panel${inspectorTab === 'layers' ? ' is-active' : ''}`}
              ref={layerPanelRef}
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Layer view</p>
                  <h2>Y {visibleBottomWorldY}-{visibleTopWorldY}</h2>
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

              <div className="layer-range">
                <label>
                  <span>Bottom</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0, model.dimensions.height - 1)}
                    value={visibleBottomLayer}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setVisibleLayerRange(Math.min(next, visibleTopLayer), visibleTopLayer);
                    }}
                    onPointerUp={(event) => setVisibleLayerRange(
                      Math.min(Number(event.currentTarget.value), visibleTopLayer),
                      visibleTopLayer,
                      singleVisibleLayer,
                      { commit: true, immediate: true },
                    )}
                    onKeyUp={(event) => setVisibleLayerRange(
                      Math.min(Number(event.currentTarget.value), visibleTopLayer),
                      visibleTopLayer,
                      singleVisibleLayer,
                      { commit: true, immediate: true },
                    )}
                    onBlur={(event) => setVisibleLayerRange(
                      Math.min(Number(event.currentTarget.value), visibleTopLayer),
                      visibleTopLayer,
                      singleVisibleLayer,
                      { commit: true, immediate: true },
                    )}
                    aria-label="Bottom visible layer"
                  />
                </label>
                <label>
                  <span>Top</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0, model.dimensions.height - 1)}
                    value={visibleTopLayer}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setVisibleLayerRange(visibleBottomLayer, Math.max(next, visibleBottomLayer));
                    }}
                    onPointerUp={(event) => setVisibleLayerRange(
                      visibleBottomLayer,
                      Math.max(Number(event.currentTarget.value), visibleBottomLayer),
                      singleVisibleLayer,
                      { commit: true, immediate: true },
                    )}
                    onKeyUp={(event) => setVisibleLayerRange(
                      visibleBottomLayer,
                      Math.max(Number(event.currentTarget.value), visibleBottomLayer),
                      singleVisibleLayer,
                      { commit: true, immediate: true },
                    )}
                    onBlur={(event) => setVisibleLayerRange(
                      visibleBottomLayer,
                      Math.max(Number(event.currentTarget.value), visibleBottomLayer),
                      singleVisibleLayer,
                      { commit: true, immediate: true },
                    )}
                    aria-label="Top visible layer"
                  />
                </label>
              </div>
              <div className="slider-wrap" style={{ '--layer-progress': `${singleLayerPercent}%` } as CSSProperties}>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, model.dimensions.height - 1)}
                  value={singleVisibleLayer}
                  onChange={(event) => showSingleLayer(Number(event.target.value))}
                  onPointerUp={(event) => showSingleLayer(Number(event.currentTarget.value), true)}
                  onKeyUp={(event) => showSingleLayer(Number(event.currentTarget.value), true)}
                  onBlur={(event) => showSingleLayer(Number(event.currentTarget.value), true)}
                  aria-label="Single visible layer"
                />
              </div>

              <div className="mode-row">
                <span>{currentLayerBlockCount.toLocaleString()} blocks</span>
              </div>
              <section className="filtered-materials" aria-label="Visible Layer Materials">
                <div className="filtered-materials-head">
                  <h3>Visible Layer Materials</h3>
                  <span>
                    {layerMaterialSearch.trim()
                      ? `${filteredLayerMaterials.length.toLocaleString()} of ${layerMaterials.length.toLocaleString()} types`
                      : `${layerMaterials.length.toLocaleString()} types`}
                  </span>
                </div>
                <MaterialList
                  ariaLabel="Visible layer materials list"
                  materials={filteredLayerMaterials}
                  selectedMaterialId={selectedMaterialId}
                  expandedMaterialIds={expandedMaterialIds}
                  hiddenMaterialIds={hiddenMaterialIds}
                  hasBreakdown={(material) => shouldShowCompactMaterialBreakdown(material.id, material.count)}
                  onToggleExpanded={toggleMaterialBreakdown}
                  onToggleVisibility={toggleMaterialVisibility}
                  renderPreview={(material) => (
                    <MaterialPreview stateKey={material.stateKey} color={material.color} layers={material.thumbnailLayers} />
                  )}
                  renderBreakdown={(material) => (
                    <MaterialBreakdown materialId={material.id} count={material.count} />
                  )}
                  onRotateMaterial={TEMP_THUMBNAIL_TOOLS ? rotateMaterialThumbnail : undefined}
                  emptyText="No visible non-air blocks in this layer range."
                  searchValue={layerMaterialSearch}
                  onSearchChange={setLayerMaterialSearch}
                  searchPlaceholder="Search visible layer materials"
                  searchAriaLabel="Search visible layer materials"
                  emptySearchText={(query) => `No visible layer materials match "${query}".`}
                />
              </section>
            </section>

            <section
              className={`material-list material-list-panel inspector-panel${inspectorTab === 'materials' ? ' is-active' : ''}`}
              ref={materialPanelRef}
            >
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
              <MaterialList
                ariaLabel="Materials list"
                materials={filteredMaterials}
                selectedMaterialId={selectedMaterialId}
                expandedMaterialIds={expandedMaterialIds}
                hiddenMaterialIds={hiddenMaterialIds}
                hasBreakdown={(material) => shouldShowCompactMaterialBreakdown(material.id, material.count)}
                onToggleExpanded={toggleMaterialBreakdown}
                onToggleVisibility={toggleMaterialVisibility}
                renderPreview={(material) => (
                  <MaterialPreview stateKey={material.stateKey} color={material.color} layers={material.thumbnailLayers} />
                )}
                renderBreakdown={(material) => (
                  <MaterialBreakdown materialId={material.id} count={material.count} />
                )}
                onRotateMaterial={TEMP_THUMBNAIL_TOOLS ? rotateMaterialThumbnail : undefined}
                emptyText={materialsScope === 'cuboid' && !cuboidBounds
                  ? 'Select an area to list materials for that region.'
                  : 'No non-air blocks in this area.'}
                searchValue={materialSearch}
                onSearchChange={setMaterialSearch}
                searchPlaceholder="Search materials"
                searchAriaLabel="Search materials"
                emptySearchText={materialsScope === 'cuboid' && !cuboidBounds ? undefined : (query) => `No materials match "${query}".`}
                onItemRef={(id, node) => {
                  if (node) {
                    materialItemRefs.current.set(id, node);
                  } else {
                    materialItemRefs.current.delete(id);
                  }
                }}
              />
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
                  <div className="edit-transform-move">
                    <div className="section-heading compact">
                      <div>
                        <h2>Move</h2>
                        <p className="eyebrow">Selected area</p>
                      </div>
                      <Move3d size={18} />
                    </div>
                    <div className="cuboid-move-grid">
                      {(['up', 'down', 'north', 'south', 'west', 'east'] as Direction[]).map((direction) => {
                        const canMove = Boolean(cuboidBounds && boundsInsideModel(translateBounds(cuboidBounds, directionOffset(direction)), model));

                        return (
                          <button
                            type="button"
                            key={direction}
                            onClick={() => shiftSelectedArea(direction)}
                            disabled={!canMove}
                          >
                            {directionLabel(direction)}
                          </button>
                        );
                      })}
                    </div>
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
      {celebrationView === 'shopping' && appView === 'shopping' && (
        <ShoppingCelebration
          materials={visibleMaterials}
          onDone={() => setCelebrationView(null)}
        />
      )}
      {celebrationView === 'shulker' && appView === 'shulker' && (
        <ShoppingCelebration
          materials={visibleMaterials}
          onDone={() => setCelebrationView(null)}
        />
      )}
      {/* TEMPORARY: in-list thumbnail tuning tools — see TEMP_THUMBNAIL_TOOLS. */}
      {TEMP_THUMBNAIL_TOOLS && loadState === 'ready' && (
        <div className="temp-thumb-tools" aria-label="Temporary thumbnail tuning tools">
          <span className="temp-thumb-tools-tag">Temp thumbnail tools</span>
          <button
            type="button"
            className="secondary-button"
            onClick={loadAllBlocksTestSchematic}
            title="Replace the current build with one of every block (for thumbnail tuning)"
          >
            <Boxes size={16} aria-hidden="true" />
            Load all blocks
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={copyMaterialThumbnailAdjustments}
            title="Copy the adjusted-block JSON to the clipboard"
          >
            {thumbnailAdjustmentsCopied ? <Check size={15} aria-hidden="true" /> : <ClipboardList size={15} aria-hidden="true" />}
            {thumbnailAdjustmentsCopied ? 'Copied JSON' : `Copy adjustments (${adjustedThumbnailItemCount})`}
          </button>
        </div>
      )}
      </main>
    </ThumbnailDisplayAdjustmentsContext.Provider>
  );
}

interface BlockPreviewProps {
  stateKey: string;
  color: number;
  layers?: BlockThumbnailLayer[];
  size?: number;
  rotateX?: number;
  rotateY?: number;
  adjustmentKey?: string;
  fallbackToSprite?: boolean;
  forceSpriteStateKey?: string | null;
}

const defaultBlockPreviewRenderSize = 48;
const highDetailBlockPreviewThreshold = 48;

function preferredBlockThumbnailResolution(size: number | undefined, scale: number): number {
  const baseSize = size ?? defaultBlockPreviewRenderSize;
  const effectiveSize = Math.max(baseSize, baseSize * Math.max(scale, 1));
  return effectiveSize >= highDetailBlockPreviewThreshold
    ? highDetailBlockThumbnailResolution
    : defaultBlockThumbnailResolution;
}

const BlockPreview = memo(function BlockPreview({
  stateKey,
  color,
  layers,
  size,
  rotateX,
  rotateY,
  adjustmentKey,
  fallbackToSprite = false,
  forceSpriteStateKey = null,
}: BlockPreviewProps) {
  const thumbnailDisplayAdjustments = useContext(ThumbnailDisplayAdjustmentsContext);
  const defaultAdjustment = thumbnailDisplayAdjustments[adjustmentKey ?? thumbnailDisplayAdjustmentKey(stateKey)]
    ?? defaultThumbnailDisplayAdjustment;
  const previewRequest = useMemo(
    () => resolveThumbnailPreviewRequest(stateKey, layers, defaultAdjustment),
    [defaultAdjustment, layers, stateKey],
  );
  const requestedThumbnailResolution = useMemo(
    () => preferredBlockThumbnailResolution(size, defaultAdjustment.scale),
    [defaultAdjustment.scale, size],
  );
  const forcedSpriteUrl = forceSpriteStateKey ? materialSpriteUrlForStateKey(forceSpriteStateKey) : null;
  const fallbackSpriteUrl = fallbackToSprite ? materialSpriteUrlForStateKey(stateKey) : null;
  const previewRef = useRef<HTMLSpanElement | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(() => (
    getCachedBlockThumbnail(previewRequest.stateKey, color, previewRequest.layers, {
      resolution: requestedThumbnailResolution,
    })
      ?? (
        requestedThumbnailResolution !== defaultBlockThumbnailResolution
          ? getCachedBlockThumbnail(previewRequest.stateKey, color, previewRequest.layers, {
            resolution: defaultBlockThumbnailResolution,
          })
          : undefined
      )
      ?? null
  ));
  const [thumbnailState, setThumbnailState] = useState<ThumbnailLoadState>(() => {
    const cachedThumbnail = getCachedBlockThumbnail(previewRequest.stateKey, color, previewRequest.layers, {
      resolution: requestedThumbnailResolution,
    });
    if (cachedThumbnail !== undefined) return cachedThumbnail ? 'ready' : 'failed';

    const cachedFallbackThumbnail = requestedThumbnailResolution !== defaultBlockThumbnailResolution
      ? getCachedBlockThumbnail(previewRequest.stateKey, color, previewRequest.layers, {
        resolution: defaultBlockThumbnailResolution,
      })
      : undefined;
    if (cachedFallbackThumbnail !== undefined) return cachedFallbackThumbnail ? 'ready' : 'failed';

    return 'idle';
  });
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (forcedSpriteUrl) return;
    const preview = previewRef.current;
    if (!preview) return;

    return observeBlockPreviewVisibility(preview, () => setIsVisible(true));
  }, [forcedSpriteUrl]);

  useEffect(() => {
    if (forcedSpriteUrl) return;
    const cachedThumbnail = getCachedBlockThumbnail(previewRequest.stateKey, color, previewRequest.layers, {
      resolution: requestedThumbnailResolution,
    });
    const cachedFallbackThumbnail = requestedThumbnailResolution !== defaultBlockThumbnailResolution
      ? getCachedBlockThumbnail(previewRequest.stateKey, color, previewRequest.layers, {
        resolution: defaultBlockThumbnailResolution,
      })
      : undefined;

    if (cachedThumbnail !== undefined) {
      setThumbnailUrl(cachedThumbnail ?? cachedFallbackThumbnail ?? null);
      setThumbnailState(cachedThumbnail || cachedFallbackThumbnail ? 'ready' : 'failed');
      return;
    }

    if (cachedFallbackThumbnail !== undefined) {
      setThumbnailUrl(cachedFallbackThumbnail);
      setThumbnailState(cachedFallbackThumbnail ? 'ready' : 'failed');
    } else {
      setThumbnailUrl(null);
      setThumbnailState(isVisible ? 'loading' : 'idle');
    }

    if (!isVisible || cachedFallbackThumbnail === null) return;

    let cancelled = false;
    if (!cachedFallbackThumbnail) {
      setThumbnailUrl(null);
      setThumbnailState('loading');
    }
    void createBlockThumbnail(previewRequest.stateKey, color, previewRequest.layers, {
      resolution: requestedThumbnailResolution,
    })
      .then((url) => {
        if (cancelled) return;
        setThumbnailUrl(url ?? cachedFallbackThumbnail ?? null);
        setThumbnailState(url || cachedFallbackThumbnail ? 'ready' : 'failed');
      })
      .catch(() => {
        if (cancelled) return;
        setThumbnailUrl(cachedFallbackThumbnail ?? null);
        setThumbnailState(cachedFallbackThumbnail ? 'ready' : 'failed');
      });

    return () => {
      cancelled = true;
    };
  }, [color, forcedSpriteUrl, isVisible, previewRequest.layers, previewRequest.stateKey, requestedThumbnailResolution]);
  const showingForcedSprite = Boolean(forcedSpriteUrl);
  const showingSpriteFallback = !thumbnailUrl && thumbnailState === 'failed' && Boolean(fallbackSpriteUrl);
  const showingSprite = showingForcedSprite || showingSpriteFallback;
  const resolvedRotateX = showingSprite ? 0 : (rotateX ?? defaultAdjustment.rotateX);
  const resolvedRotateY = showingSprite ? 0 : (rotateY ?? defaultAdjustment.rotateY);
  const previewUrl = forcedSpriteUrl ?? thumbnailUrl ?? (showingSpriteFallback ? fallbackSpriteUrl : null);
  const previewState = forcedSpriteUrl || previewUrl ? 'ready' : thumbnailState;
  const spriteTint = showingSprite ? materialSpriteTintForStateKey(forceSpriteStateKey ?? stateKey) : null;

  return (
    <span
      ref={previewRef}
      className="block-preview"
      data-shape={showingSprite ? 'sprite' : 'thumbnail'}
      data-state={previewState}
      data-tinted={spriteTint !== null ? 'true' : undefined}
      aria-hidden="true"
      style={{
        '--block-thumbnail': previewUrl ? `url("${previewUrl}")` : 'none',
        '--block-preview-size': size ? `${size}px` : undefined,
        '--block-preview-scale': showingSprite ? '1' : defaultAdjustment.scale.toString(),
        '--block-preview-rotate-x': `${resolvedRotateX}deg`,
        '--block-preview-rotate-y': `${resolvedRotateY}deg`,
        '--block-preview-tint': spriteTint !== null ? `#${spriteTint.toString(16).padStart(6, '0')}` : undefined,
      } as CSSProperties}
    >
      {previewState === 'failed' && (
        <>
          <span className="block-preview-face block-preview-top" />
          <span className="block-preview-face block-preview-left" />
          <span className="block-preview-face block-preview-right" />
        </>
      )}
    </span>
  );
});

const MaterialPreview = memo(function MaterialPreview(props: {
  stateKey: string;
  color: number;
  layers?: BlockThumbnailLayer[];
  size?: number;
}) {
  // Render every material thumbnail from a canonical, canvas-independent state key
  // (and canonical layers) so the list/shopping/shulker views show the block in a
  // deterministic orientation rather than however the first placed block faced.
  // The desired facing is applied on top via the thumbnail display adjustment,
  // keyed by this same base id.
  const displayStateKey = materialDisplayStateKey(props.stateKey);
  const layers = materialThumbnailLayers(displayStateKey) ?? props.layers;
  const forceSpriteStateKey = alwaysMaterialSpriteStateKey(displayStateKey);
  return (
    <BlockPreview
      {...props}
      stateKey={displayStateKey}
      layers={layers}
      fallbackToSprite
      forceSpriteStateKey={forceSpriteStateKey}
    />
  );
});

function thumbnailDisplayAdjustmentKey(stateKey: string): string {
  return stateKey;
}

function baseThumbnailPreviewRequest(stateKey: string, layers?: BlockThumbnailLayer[]): ThumbnailPreviewRequest {
  return normalizeThumbnailPreviewRequest({ stateKey, layers });
}

function resolveThumbnailPreviewRequest(
  stateKey: string,
  layers: BlockThumbnailLayer[] | undefined,
  adjustment: ThumbnailDisplayAdjustment,
): ThumbnailPreviewRequest {
  return normalizeThumbnailPreviewRequest({
    stateKey: adjustment.previewStateKey ?? stateKey,
    layers: adjustment.previewLayers ?? layers,
  });
}

function normalizeThumbnailPreviewRequest(request: ThumbnailPreviewRequest): ThumbnailPreviewRequest {
  return {
    stateKey: request.stateKey,
    layers: normalizeThumbnailPreviewLayers(request.layers),
  };
}

function normalizeThumbnailPreviewLayers(layers?: BlockThumbnailLayer[]): BlockThumbnailLayer[] | undefined {
  if (!layers || layers.length === 0) return undefined;

  return layers.map((layer) => ({
    stateKey: layer.stateKey,
    offset: layer.offset ? [...layer.offset] as [number, number, number] : undefined,
    modelId: layer.modelId,
  }));
}

function normalizeThumbnailDisplayAdjustment(adjustment: ThumbnailDisplayAdjustment): ThumbnailDisplayAdjustment {
  return {
    scale: clamp(Math.round(adjustment.scale * 100) / 100, 0.5, 2.4),
    rotateX: clamp(Math.round(adjustment.rotateX ?? 0), -60, 60),
    rotateY: clamp(Math.round(adjustment.rotateY ?? 0), -60, 60),
    previewStateKey: adjustment.previewStateKey,
    previewLayers: normalizeThumbnailPreviewLayers(adjustment.previewLayers),
  };
}

function isDefaultThumbnailDisplayAdjustment(adjustment: ThumbnailDisplayAdjustment): boolean {
  return adjustment.scale === defaultThumbnailDisplayAdjustment.scale
    && adjustment.rotateX === defaultThumbnailDisplayAdjustment.rotateX
    && adjustment.rotateY === defaultThumbnailDisplayAdjustment.rotateY
    && adjustment.previewStateKey === undefined
    && adjustment.previewLayers === undefined;
}

function serializeThumbnailDisplayAdjustments(adjustments: ThumbnailDisplayAdjustmentMap): ThumbnailDisplayAdjustmentMap {
  return Object.fromEntries(
    Object.entries(adjustments)
      .map(([key, adjustment]) => [key, normalizeThumbnailDisplayAdjustment(adjustment)] as const)
      .filter(([, adjustment]) => !isDefaultThumbnailDisplayAdjustment(adjustment))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function thumbnailPreviewRequestsEqual(left: ThumbnailPreviewRequest, right: ThumbnailPreviewRequest): boolean {
  return left.stateKey === right.stateKey && thumbnailPreviewLayersEqual(left.layers, right.layers);
}

function thumbnailPreviewLayersEqual(left?: BlockThumbnailLayer[], right?: BlockThumbnailLayer[]): boolean {
  if (!left?.length && !right?.length) return true;
  if (!left || !right || left.length !== right.length) return false;

  return left.every((layer, index) => {
    const other = right[index];
    if (!other || layer.stateKey !== other.stateKey) return false;
    if ((layer.modelId ?? '') !== (other.modelId ?? '')) return false;
    const leftOffset = layer.offset ?? [0, 0, 0];
    const rightOffset = other.offset ?? [0, 0, 0];
    return leftOffset[0] === rightOffset[0]
      && leftOffset[1] === rightOffset[1]
      && leftOffset[2] === rightOffset[2];
  });
}

function rotateThumbnailPreviewRequestY(
  request: ThumbnailPreviewRequest,
  direction: RotationDirection,
): ThumbnailPreviewRequest {
  return normalizeThumbnailPreviewRequest({
    stateKey: rotateBlockStateKeyY(request.stateKey, direction),
    layers: request.layers?.map((layer) => ({
      stateKey: rotateBlockStateKeyY(layer.stateKey, direction),
      offset: layer.offset ? rotateThumbnailLayerOffsetY(layer.offset, direction) : undefined,
    })),
  });
}

function rotateThumbnailLayerOffsetY(
  offset: [number, number, number],
  direction: RotationDirection,
): [number, number, number] {
  const [x, y, z] = offset;
  return direction === 'clockwise' ? [-z, y, x] : [z, y, -x];
}

function summarizeThumbnailOrientation(request: ThumbnailPreviewRequest): ThumbnailOrientationSummary {
  const properties = parseMinecraftBlockStateKey(primaryThumbnailPreviewStateKey(request)).properties;
  if (isDirection(properties.facing)) {
    return { mode: 'facing', value: properties.facing, label: formatThumbnailDirectionLabel(properties.facing) };
  }
  if (isHorizontalDirection(properties.horizontal_facing)) {
    return {
      mode: 'horizontal_facing',
      value: properties.horizontal_facing,
      label: formatThumbnailDirectionLabel(properties.horizontal_facing),
    };
  }
  if (isHorizontalDirection(properties.rotation)) {
    return { mode: 'rotation', value: properties.rotation, label: formatThumbnailDirectionLabel(properties.rotation) };
  }
  if (properties.rotation && /^\d+$/.test(properties.rotation)) {
    const direction = horizontalDirectionFromRotationValue(properties.rotation);
    return { mode: 'rotation', value: properties.rotation, label: `${formatThumbnailDirectionLabel(direction)} (${properties.rotation})` };
  }
  if (properties.axis === 'x' || properties.axis === 'y' || properties.axis === 'z') {
    return { mode: 'axis', value: properties.axis, label: `Axis ${properties.axis.toUpperCase()}` };
  }

  return { mode: null, value: null, label: null };
}

function primaryThumbnailPreviewStateKey(request: ThumbnailPreviewRequest): string {
  return request.layers?.[0]?.stateKey ?? request.stateKey;
}

function supportsVerticalThumbnailDirection(request: ThumbnailPreviewRequest): boolean {
  const stateKey = primaryThumbnailPreviewStateKey(request);
  const normalized = parseMinecraftBlockStateKey(stateKey);
  const facing = normalized.properties.facing;
  if (facing === 'up' || facing === 'down') return true;
  return thumbnailVerticalFacingBlockIds.has(normalized.id);
}

function canSetThumbnailPreviewRequestDirection(request: ThumbnailPreviewRequest, direction: Direction): boolean {
  return !thumbnailPreviewRequestsEqual(request, setThumbnailPreviewRequestDirection(request, direction));
}

function setThumbnailPreviewRequestDirection(request: ThumbnailPreviewRequest, direction: Direction): ThumbnailPreviewRequest {
  if (isHorizontalDirection(direction)) {
    const currentDirection = summarizeThumbnailOrientation(request).mode === 'axis'
      ? null
      : thumbnailPreviewHorizontalDirection(request);
    if (currentDirection) {
      let next = request;
      for (let turns = 0; turns < 4 && thumbnailPreviewHorizontalDirection(next) !== direction; turns += 1) {
        next = rotateThumbnailPreviewRequestY(next, 'clockwise');
      }
      if (thumbnailPreviewHorizontalDirection(next) === direction) return next;
    }
  }

  return normalizeThumbnailPreviewRequest({
    stateKey: setBlockStateKeyDirection(request.stateKey, direction),
    layers: request.layers?.map((layer) => ({
      stateKey: setBlockStateKeyDirection(layer.stateKey, direction),
      offset: layer.offset ? [...layer.offset] as [number, number, number] : undefined,
    })),
  });
}

function canSetThumbnailPreviewRequestAxis(request: ThumbnailPreviewRequest, axis: 'x' | 'y' | 'z'): boolean {
  return !thumbnailPreviewRequestsEqual(request, setThumbnailPreviewRequestAxis(request, axis));
}

function setThumbnailPreviewRequestAxis(request: ThumbnailPreviewRequest, axis: 'x' | 'y' | 'z'): ThumbnailPreviewRequest {
  return normalizeThumbnailPreviewRequest({
    stateKey: setBlockStateKeyAxis(request.stateKey, axis),
    layers: request.layers?.map((layer) => ({
      stateKey: setBlockStateKeyAxis(layer.stateKey, axis),
      offset: layer.offset ? [...layer.offset] as [number, number, number] : undefined,
    })),
  });
}

// TEMPORARY: advance a thumbnail preview to the "next" facing for the in-list
// rotate control. Cycles full facing including up/down where supported, horizontal
// facing (N→E→S→W), or axis (X→Y→Z); falls back to a Y rotation for
// connection/shape-driven blocks (fences, walls, rails). Returns the request
// unchanged when the block exposes no directional state we can advance.
function cycleThumbnailPreviewRequestFacing(request: ThumbnailPreviewRequest): ThumbnailPreviewRequest {
  const orientation = summarizeThumbnailOrientation(request);

  if (orientation.mode === 'facing') {
    const order: Direction[] = ['north', 'east', 'south', 'west', 'up', 'down'];
    const start = orientation.value ? order.indexOf(orientation.value as Direction) : -1;
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = order[(start + step + order.length) % order.length];
      const next = setThumbnailPreviewRequestDirection(request, candidate);
      if (!thumbnailPreviewRequestsEqual(next, request)) return next;
    }
  }

  if (orientation.mode === 'horizontal_facing' || orientation.mode === 'rotation') {
    const order: Direction[] = ['north', 'east', 'south', 'west'];
    const current = thumbnailPreviewHorizontalDirection(request);
    const start = current ? order.indexOf(current) : -1;
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = order[(start + step + order.length) % order.length];
      const next = setThumbnailPreviewRequestDirection(request, candidate);
      if (!thumbnailPreviewRequestsEqual(next, request)) return next;
    }
  }

  if (orientation.mode === 'axis') {
    const order: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
    const start = orientation.value ? order.indexOf(orientation.value as 'x' | 'y' | 'z') : -1;
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = order[(start + step + order.length) % order.length];
      const next = setThumbnailPreviewRequestAxis(request, candidate);
      if (!thumbnailPreviewRequestsEqual(next, request)) return next;
    }
  }

  return rotateThumbnailPreviewRequestY(request, 'clockwise');
}

function thumbnailPreviewHorizontalDirection(
  request: ThumbnailPreviewRequest,
): 'north' | 'east' | 'south' | 'west' | null {
  const properties = parseMinecraftBlockStateKey(primaryThumbnailPreviewStateKey(request)).properties;
  if (isHorizontalDirection(properties.facing)) return properties.facing;
  if (isHorizontalDirection(properties.horizontal_facing)) return properties.horizontal_facing;
  if (isHorizontalDirection(properties.rotation)) return properties.rotation;
  if (properties.rotation && /^\d+$/.test(properties.rotation)) return horizontalDirectionFromRotationValue(properties.rotation);
  return null;
}

function setBlockStateKeyDirection(stateKey: string, direction: Direction): string {
  const parsed = parseStateKey(stateKey);
  const normalized = parseMinecraftBlockStateKey(stateKey);
  const nextProperties = { ...normalized.properties };

  if (nextProperties.facing !== undefined && (direction === 'up' || direction === 'down' || isHorizontalDirection(direction))) {
    nextProperties.facing = direction;
    return formatStateKey(normalized.id, nextProperties, parsed?.order ?? []);
  }
  if (isHorizontalDirection(direction) && nextProperties.horizontal_facing !== undefined) {
    nextProperties.horizontal_facing = direction;
    return formatStateKey(normalized.id, nextProperties, parsed?.order ?? []);
  }
  if (isHorizontalDirection(direction) && nextProperties.rotation !== undefined) {
    if (isHorizontalDirection(nextProperties.rotation)) {
      nextProperties.rotation = direction;
    } else if (/^\d+$/.test(nextProperties.rotation)) {
      nextProperties.rotation = rotationValueForHorizontalDirection(direction);
    } else {
      return stateKey;
    }
    return formatStateKey(normalized.id, nextProperties, parsed?.order ?? []);
  }
  if (nextProperties.axis !== undefined) {
    nextProperties.axis = axisForDirection(direction);
    return formatStateKey(normalized.id, nextProperties, parsed?.order ?? []);
  }

  return stateKey;
}

function setBlockStateKeyAxis(stateKey: string, axis: 'x' | 'y' | 'z'): string {
  const parsed = parseStateKey(stateKey);
  const normalized = parseMinecraftBlockStateKey(stateKey);
  if (normalized.properties.axis === undefined) return stateKey;

  return formatStateKey(normalized.id, { ...normalized.properties, axis }, parsed?.order ?? []);
}

function horizontalDirectionFromRotationValue(rotation: string): 'north' | 'east' | 'south' | 'west' {
  const steps = ((Number.parseInt(rotation, 10) % 16) + 16) % 16;
  const quarterTurn = Math.round(steps / 4) % 4;
  return (['north', 'east', 'south', 'west'] as const)[quarterTurn];
}

function rotationValueForHorizontalDirection(direction: 'north' | 'east' | 'south' | 'west'): string {
  switch (direction) {
    case 'east':
      return '4';
    case 'south':
      return '8';
    case 'west':
      return '12';
    case 'north':
    default:
      return '0';
  }
}

function axisForDirection(direction: Direction): 'x' | 'y' | 'z' {
  if (direction === 'up' || direction === 'down') return 'y';
  if (direction === 'east' || direction === 'west') return 'x';
  return 'z';
}

function isDirection(value: string | undefined): value is Direction {
  return value === 'up'
    || value === 'down'
    || value === 'north'
    || value === 'south'
    || value === 'east'
    || value === 'west';
}

function formatThumbnailDirectionLabel(direction: Direction | string): string {
  return direction.charAt(0).toUpperCase() + direction.slice(1);
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
      <h3 className={`cuboid-corner-badge cuboid-corner-badge-${corner}`}>
        {corner.toUpperCase()}
      </h3>
      {(['x', 'y', 'z'] as const).map((axis) => {
        const coordinate = point ? point[axis] : 0;
        const worldCoordinate = originCoordinate(model, axis) + coordinate;
        const minAllowed = 0;
        const maxAllowed = maxCoordinateForAxis(model, axis);

        return (
          <div className="cuboid-axis-stepper" key={`${corner}-${axis}`}>
            <div className="cuboid-axis-buttons">
              <button
                type="button"
                onClick={() => onStep(corner, axis, -1)}
                disabled={coordinate <= minAllowed}
                title={`Decrease ${title} ${axis.toUpperCase()}`}
                aria-label={`Decrease ${title} ${axis.toUpperCase()}`}
              >
                <span aria-hidden="true">-</span>
              </button>
              <strong>{worldCoordinate}</strong>
              <button
                type="button"
                onClick={() => onStep(corner, axis, 1)}
                disabled={coordinate >= maxAllowed}
                title={`Increase ${title} ${axis.toUpperCase()}`}
                aria-label={`Increase ${title} ${axis.toUpperCase()}`}
              >
                <span aria-hidden="true">+</span>
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

function filterMaterials<T extends MaterialListItem>(materials: T[], search: string): T[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return materials;

  return materials.filter((material) => {
    const label = material.label.toLocaleLowerCase();
    const id = material.id.toLocaleLowerCase();
    return label.includes(query) || id.includes(query);
  });
}

function isAppEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable
    || tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT';
}

function materialIdForStateKey(stateKey: string): string {
  const id = stripBlockStateProperties(stateKey);
  const path = id.replace(/^minecraft:/, '');
  if (path === 'wall_sign') return id.replace(/wall_sign$/, 'sign');
  if (path === 'wall_hanging_sign') return id.replace(/wall_hanging_sign$/, 'hanging_sign');
  if (isWallSignStateKey(id)) return id.replace(/_wall_sign$/, '_sign');
  if (isWallHangingSignStateKey(id)) return id.replace(/_wall_hanging_sign$/, '_hanging_sign');
  if (path === 'wall_torch') return 'minecraft:torch';
  if (path === 'soul_wall_torch') return 'minecraft:soul_torch';
  if (path === 'redstone_wall_torch') return 'minecraft:redstone_torch';
  if (path === 'copper_wall_torch') return 'minecraft:copper_torch';
  // Wall-mounted variants share an item with their standing/floor counterpart, so
  // tally them together in the materials list (heads, skulls, banners, coral fans).
  if (path.endsWith('_wall_head')) return id.replace(/_wall_head$/, '_head');
  if (path.endsWith('_wall_skull')) return id.replace(/_wall_skull$/, '_skull');
  if (path.endsWith('_wall_banner')) return id.replace(/_wall_banner$/, '_banner');
  if (path.endsWith('_coral_wall_fan')) return id.replace(/_coral_wall_fan$/, '_coral_fan');
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
  return creativeCategoryOrder.flatMap((categoryId) => {
    const categoryItems = items
      .filter((item) => item.category === categoryId)
      .sort((a, b) => compareBlockLibraryItems(a.stateKey, b.stateKey));

    return categoryItems.length > 0 ? [{ id: categoryId, label: creativeInventoryTabLabel(categoryId), items: categoryItems }] : [];
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
  return creativeCategoryOrder.indexOf(id);
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
  const tab = creativeInventoryData?.minecraftCreativeInventory.tabs[id];
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
  const tab = creativeInventoryData?.minecraftCreativeInventory.tabs[id];
  const organization = tab && 'organization' in tab && Array.isArray(tab.organization) ? tab.organization : [];
  const keywords: string[] = [];

  for (const group of organization) {
    const inventoryGroup = group as { items?: string[]; variants?: string[] };
    for (const item of [...(inventoryGroup.items ?? []), ...(inventoryGroup.variants ?? [])]) {
      keywords.push(normalizeInventoryKeyword(item));
    }
  }

  return keywords.filter((keyword, index) => keyword && keywords.indexOf(keyword) === index);
}

function creativeInventoryKeywordOrderFor(category: CreativeCategoryId): string[] {
  if (!creativeInventoryKeywordOrderCache) {
    if (!creativeInventoryData) return [];
    creativeInventoryKeywordOrderCache = createCreativeInventoryKeywordOrder();
  }
  return creativeInventoryKeywordOrderCache[category];
}

function creativeInventoryKeywordRank(category: CreativeCategoryId, id: string): number {
  const keywords = creativeInventoryKeywordOrderFor(category);
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
    for (const material of materialEntriesForBlock(block)) {
      if (material.quantity === 0) continue;

      const preview = material.stateKey === block.stateKey ? block : createVoxelBlock(block.x, block.y, block.z, material.stateKey);
      const displayStateKey = materialDisplayStateKey(material.stateKey);
      const current = counts.get(material.id) ?? {
        id: material.id,
        label: formatBlockName(material.id),
        count: 0,
        color: preview.color,
        stateKey: material.stateKey,
        displayStateKey,
        thumbnailLayers: materialThumbnailLayers(displayStateKey),
      };
      current.count += material.quantity;
      counts.set(material.id, current);
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function summarizeExtraMaterials(extraMaterials: SchematicModel['extraMaterials']): MaterialSummary[] {
  if (!extraMaterials?.length) return [];

  return extraMaterials
    .filter((material) => material.count > 0)
    .map((material) => {
      const stateKey = material.stateKey ?? recipeItemStateKey(material.id);
      const displayStateKey = materialDisplayStateKey(stateKey);
      const preview = createVoxelBlock(0, 0, 0, stateKey);

      return {
        id: material.id,
        label: formatBlockName(material.id),
        count: material.count,
        color: preview.color,
        stateKey,
        displayStateKey,
        thumbnailLayers: materialThumbnailLayers(displayStateKey),
      };
    });
}

function materialEntriesForBlock(block: VoxelBlock): Array<{ id: string; quantity: number; stateKey: string }> {
  const quantity = materialQuantityForBlock(block);
  if (quantity === 0) return [];

  // Only fluid source blocks cost a bucket; flowing fluid is generated by the
  // source and contributes nothing to the material list.
  if (isFlowingWaterStateKey(block.stateKey) || isFlowingLavaStateKey(block.stateKey)) return [];

  if (isWaterSourceStateKey(block.stateKey)) {
    return [{ id: 'water_bucket', quantity, stateKey: 'minecraft:water_bucket' }];
  }

  if (isLavaSourceStateKey(block.stateKey)) {
    return [{ id: 'lava_bucket', quantity, stateKey: 'minecraft:lava_bucket' }];
  }

  if (isWaterCauldronStateKey(block.stateKey)) {
    return [
      { id: 'cauldron', quantity, stateKey: 'minecraft:cauldron' },
      { id: 'water_bucket', quantity, stateKey: 'minecraft:water_bucket' },
    ];
  }

  const pottedPlantId = pottedPlantMaterialId(block.stateKey);
  if (pottedPlantId) {
    return [
      { id: 'flower_pot', quantity, stateKey: 'minecraft:flower_pot' },
      { id: pottedPlantId, quantity, stateKey: recipeItemStateKey(pottedPlantId) },
    ];
  }

  if (isWheatCropStateKey(block.stateKey)) {
    return [{ id: 'wheat_seeds', quantity, stateKey: 'minecraft:wheat_seeds' }];
  }

  if (isDirtCountStateKey(block.stateKey)) {
    return [{ id: 'dirt', quantity, stateKey: 'minecraft:dirt' }];
  }

  const id = materialIdForBlock(block);
  return [{ id, quantity: quantity * materialItemCountForBlock(block.stateKey), stateKey: materialStateKeyForBlock(block) }];
}

function materialItemCountForBlock(stateKey: string): number {
  if (isSeaPickleStateKey(stateKey)) return blockStateCountProperty(stateKey, 'pickles', 1);
  if (isCandleStateKey(stateKey)) return blockStateCountProperty(stateKey, 'candles', 1);
  return 1;
}

function blockStateCountProperty(stateKey: string, property: string, fallback: number): number {
  const value = parseStateKey(stateKey)?.properties[property];
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.max(1, Number(value));
}

function pottedPlantMaterialId(stateKey: string): string | null {
  const id = baseBlockId(stateKey);
  if (!id.startsWith('potted_')) return null;

  const plantId = id.slice('potted_'.length);
  if (plantId === 'azalea_bush') return 'azalea';
  if (plantId === 'flowering_azalea_bush') return 'flowering_azalea';
  return plantId;
}

function materialStateKeyForBlock(block: VoxelBlock): string {
  if (isFenceStateKey(block.stateKey)) return fenceMaterialStateKey(block.stateKey);
  if (isFenceGateStateKey(block.stateKey)) return fenceGateMaterialStateKey(block.stateKey);
  if (isStairsStateKey(block.stateKey)) return stairMaterialStateKey(block.stateKey);
  if (isTrapdoorStateKey(block.stateKey)) return trapdoorMaterialStateKey(block.stateKey);
  if (isPaneStateKey(block.stateKey)) return paneMaterialStateKey(block.stateKey);
  if (isWallStateKey(block.stateKey)) return wallMaterialStateKey(block.stateKey);
  if (isPistonBaseStateKey(block.stateKey)) return pistonMaterialStateKey(block.stateKey);
  if (isCampfireStateKey(block.stateKey)) return campfireMaterialStateKey(block.stateKey);
  if (isWallTorchStateKey(block.stateKey)) return wallTorchMaterialStateKey(block.stateKey);
  if (isDisplayHeadStateKey(block.stateKey)) return headMaterialStateKey(block);
  if (isBannerStateKey(block.stateKey)) return bannerMaterialStateKey(block.stateKey);
  if (isCoralFanStateKey(block.stateKey)) return coralFanMaterialStateKey(block.stateKey);
  return block.stateKey;
}

function fenceMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    east: 'true',
    north: 'false',
    south: 'false',
    west: 'true',
  }, parsed.order);
}

function fenceGateMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    facing: 'east',
    in_wall: 'false',
    open: 'false',
  }, parsed.order);
}

function stairMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    facing: 'west',
    half: 'bottom',
    shape: 'straight',
  }, parsed.order);
}

function trapdoorMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    open: 'false',
  }, parsed.order);
}

function paneMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    east: 'true',
    north: 'false',
    south: 'false',
    west: 'true',
  }, parsed.order);
}

function pistonMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    extended: 'false',
  }, parsed.order);
}

function campfireMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    lit: 'true',
  }, parsed.order);
}

function wallTorchMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  const id = materialIdForStateKey(stateKey);
  if (id === 'minecraft:redstone_torch') {
    return withBlockStateProperties(id, { lit: parsed?.properties.lit ?? 'true' });
  }
  return id;
}

function headMaterialStateKey(block: VoxelBlock): string {
  const parsed = parseStateKey(block.stateKey);
  if (!parsed) return block.stateKey;

  const id = materialIdForStateKey(block.stateKey);
  const properties: Record<string, string> = { rotation: '0' };
  const headTextureId = parsed.properties.SchematicEditor_head ?? block.playerHeadTexture?.id;
  if (id === 'minecraft:player_head' && headTextureId) {
    properties.SchematicEditor_head = headTextureId;
  }

  return formatStateKey(id, properties, ['rotation', 'SchematicEditor_head']);
}

function bannerMaterialStateKey(stateKey: string): string {
  // Collapse wall banners onto the standing banner so the combined entry previews
  // the upright item; rotation is fixed so all banners of a color share one preview.
  return withBlockStateProperties(materialIdForStateKey(stateKey), { rotation: '0' });
}

function coralFanMaterialStateKey(stateKey: string): string {
  // Collapse wall coral fans onto the floor fan (and drop waterlogged) for the preview.
  return materialIdForStateKey(stateKey);
}

function wallMaterialStateKey(stateKey: string): string {
  const parsed = parseStateKey(stateKey);
  if (!parsed) return stateKey;

  return formatStateKey(parsed.id, {
    ...parsed.properties,
    east: 'low',
    north: 'none',
    south: 'none',
    up: 'true',
    west: 'low',
  }, parsed.order);
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
  const displayStateKey = materialDisplayStateKey(stateKey);
  const preview = createVoxelBlock(0, 0, 0, stateKey);
  return {
    id,
    label: formatBlockName(id),
    count: material.count,
    color: preview.color,
    stateKey,
    displayStateKey,
    thumbnailLayers: materialThumbnailLayers(displayStateKey),
  };
}

function recipeItemStateKey(id: string): string {
  return id.startsWith('minecraft:') ? id : `minecraft:${id}`;
}

function shoppingItemKey(scopeKey: string, material: MaterialSummary): string {
  return `${scopeKey}:${material.id}:${material.count}`;
}

const resourceCalculatorBaseUrl = 'https://resourcecalculator.com/minecraft/#';
const resourceCalculatorNameOverrides: Record<string, string> = {
  bamboo_block: 'Block of Bamboo',
  stripped_bamboo_block: 'Block of Stripped Bamboo',
  coal_block: 'Block of Coal',
  iron_block: 'Block of Iron',
  gold_block: 'Block of Gold',
  redstone_block: 'Block of Redstone',
  emerald_block: 'Block of Emerald',
  lapis_block: 'Block of Lapis Lazuli',
  diamond_block: 'Block of Diamond',
  netherite_block: 'Block of Netherite',
  quartz_block: 'Block of Quartz',
  amethyst_block: 'Block of Amethyst',
  copper_block: 'Block of Copper',
  raw_iron_block: 'Block of Raw Iron',
  raw_copper_block: 'Block of Raw Copper',
  raw_gold_block: 'Block of Raw Gold',
  resin_block: 'Block of Resin',
};

function resourceCalculatorUrlForMaterials(materials: MaterialSummary[]): string {
  const counts = new Map<string, number>();
  const params = new URLSearchParams();

  for (const material of materials) {
    if (!Number.isFinite(material.count) || material.count <= 0) continue;

    const key = resourceCalculatorSimpleName(material.id);
    if (key) counts.set(key, (counts.get(key) ?? 0) + Math.ceil(material.count));
  }

  for (const [key, count] of counts) {
    params.set(key, count.toString());
  }

  return `${resourceCalculatorBaseUrl}${params.toString()}`;
}

function resourceCalculatorSimpleName(materialId: string): string {
  const id = normalizeRecipeItemId(materialId);
  const displayName = resourceCalculatorNameOverrides[id] ?? formatBlockName(id);

  return displayName.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
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

function shulkerStorageKey(
  model: SchematicModel,
  scopeKey: string,
  mode: string,
  materials: MaterialSummary[],
): string {
  const dimensions = `${model.dimensions.width}x${model.dimensions.height}x${model.dimensions.length}`;
  const materialHash = hashText(materials.map((material) => `${material.id}:${material.count}`).join('|'));
  const identity = hashText(`${model.name}|${model.source}|${dimensions}|${scopeKey}|${mode}|${materialHash}`);
  return `${shulkerViewStoragePrefix}:${identity}`;
}

function parseShoppingStorage(rawItems: string): string[] {
  try {
    const parsed = JSON.parse(rawItems);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function packMaterialsIntoShulkerBoxes(materials: MaterialSummary[], mode: ShulkerViewMode): ShulkerBoxPlan[] {
  const groups = shulkerMaterialGroups(materials, mode);
  const boxes: ShulkerBoxPlan[] = [];

  groups.forEach((group, groupIndex) => {
    let currentSlots: ShulkerBoxPlan['slots'] = [];
    let boxInGroup = 1;
    const groupBoxes: Array<Omit<ShulkerBoxPlan, 'label'>> = [];

    const flushBox = () => {
      if (currentSlots.length === 0) return;

      const slots = [...currentSlots];
      while (slots.length < shulkerInventorySlots) slots.push(null);

      const id = `${group.id}-${boxInGroup}`;
      const slotKeys = slots.map((slot, index) => (slot ? shulkerSlotKey(id, index, slot) : null));
      const filledSlotKeys = slotKeys.filter((slotKey): slotKey is string => slotKey !== null);
      const itemCount = slots.reduce((sum, slot) => sum + (slot?.count ?? 0), 0);
      groupBoxes.push({
        id,
        groupLabel: group.label,
        color: group.color ?? shulkerColorForIndex(groupIndex),
        slots,
        slotKeys,
        filledSlotKeys,
        itemCount,
        usedSlots: filledSlotKeys.length,
      });
      currentSlots = [];
      boxInGroup += 1;
    };

    for (const material of group.materials) {
      const stackSize = materialStackSize(material.id);
      let remaining = material.count;
      while (remaining > 0) {
        if (currentSlots.length === shulkerInventorySlots) flushBox();

        const count = Math.min(stackSize, remaining);
        currentSlots.push({ material, count });
        remaining -= count;
      }
    }

    flushBox();

    groupBoxes.forEach((box, index) => {
      const globalBoxNumber = boxes.length + 1;
      boxes.push({
        ...box,
        label: shulkerBoxLabel(mode, group.label, globalBoxNumber, index + 1, groupBoxes.length),
      });
    });
  });

  return boxes;
}

function consolidateLesserFilledShulkerBoxes(boxes: ShulkerBoxPlan[]): ShulkerBoxPlan[] {
  const candidates = boxes.filter(isLesserFilledShulkerBox);
  if (candidates.length < 2) return boxes;

  const candidateIds = new Set(candidates.map((box) => box.id));
  const sourceGroupLabels = uniqueLabels(candidates.map((box) => box.groupLabel));
  const consolidatedStacks = mergeShulkerStacks(candidates.flatMap((box) => box.slots.filter((slot): slot is ShulkerStack => Boolean(slot))));
  if (consolidatedStacks.length === 0) return boxes;

  const consolidatedBoxes: ShulkerBoxPlan[] = [];
  for (let index = 0; index < consolidatedStacks.length; index += shulkerInventorySlots) {
    const boxStacks = consolidatedStacks.slice(index, index + shulkerInventorySlots);
    const slots: ShulkerBoxPlan['slots'] = [...boxStacks];
    while (slots.length < shulkerInventorySlots) slots.push(null);

    const id = `consolidated-${consolidatedBoxes.length + 1}`;
    const slotKeys = slots.map((slot, slotIndex) => (slot ? shulkerSlotKey(id, slotIndex, slot) : null));
    const filledSlotKeys = slotKeys.filter((slotKey): slotKey is string => slotKey !== null);
    const materials = uniqueMaterials(boxStacks.map((stack) => stack.material));
    consolidatedBoxes.push({
      id,
      label: consolidatedShulkerBoxLabel(sourceGroupLabels, consolidatedBoxes.length + 1, Math.ceil(consolidatedStacks.length / shulkerInventorySlots)),
      groupLabel: 'Consolidated',
      color: shulkerColorForMaterials(materials, 'purple'),
      slots,
      slotKeys,
      filledSlotKeys,
      itemCount: slots.reduce((sum, slot) => sum + (slot?.count ?? 0), 0),
      usedSlots: filledSlotKeys.length,
    });
  }

  let insertedConsolidatedBoxes = false;
  return boxes.flatMap((box) => {
    if (!candidateIds.has(box.id)) return [box];
    if (insertedConsolidatedBoxes) return [];
    insertedConsolidatedBoxes = true;
    return consolidatedBoxes;
  });
}

function isLesserFilledShulkerBox(box: ShulkerBoxPlan): boolean {
  return box.usedSlots > 0 && box.usedSlots <= shulkerConsolidationSlotThreshold;
}

function mergeShulkerStacks(stacks: ShulkerStack[]): ShulkerStack[] {
  const materials = new Map<string, MaterialSummary>();
  const totals = new Map<string, number>();
  const orderedIds: string[] = [];

  for (const stack of stacks) {
    if (!materials.has(stack.material.id)) {
      materials.set(stack.material.id, stack.material);
      orderedIds.push(stack.material.id);
    }
    totals.set(stack.material.id, (totals.get(stack.material.id) ?? 0) + stack.count);
  }

  return orderedIds.flatMap((materialId) => {
    const material = materials.get(materialId);
    if (!material) return [];

    const stackSize = materialStackSize(materialId);
    let remaining = totals.get(materialId) ?? 0;
    const mergedStacks: ShulkerStack[] = [];
    while (remaining > 0) {
      const count = Math.min(stackSize, remaining);
      mergedStacks.push({ material, count });
      remaining -= count;
    }
    return mergedStacks;
  });
}

function consolidatedShulkerBoxLabel(sourceGroupLabels: string[], boxNumber: number, boxCount: number): string {
  const sourceLabel = consolidatedSourceLabel(sourceGroupLabels);
  return boxCount > 1 ? `${sourceLabel} ${boxNumber}` : sourceLabel;
}

function consolidatedSourceLabel(sourceGroupLabels: string[]): string {
  if (sourceGroupLabels.length === 0) return 'Mixed Items';
  if (sourceGroupLabels.length === 1) return sourceGroupLabels[0];
  if (sourceGroupLabels.length === 2) return `Mixed: ${sourceGroupLabels.join(' + ')}`;
  return `Mixed: ${sourceGroupLabels[0]} + ${sourceGroupLabels.length - 1} types`;
}

function uniqueLabels(labels: string[]): string[] {
  return Array.from(new Set(labels.filter(Boolean)));
}

function uniqueMaterials(materials: MaterialSummary[]): MaterialSummary[] {
  const seen = new Set<string>();
  return materials.filter((material) => {
    if (seen.has(material.id)) return false;
    seen.add(material.id);
    return true;
  });
}

function shulkerMaterialGroups(
  materials: MaterialSummary[],
  mode: ShulkerViewMode,
): Array<{ id: string; label: string; color?: string; materials: MaterialSummary[] }> {
  if (mode === 'box') {
    return [{ id: 'all', label: 'All Materials', color: 'theme', materials }];
  }

  const groups = new Map<string, { id: string; label: string; color?: string; materials: MaterialSummary[] }>();
  for (const material of materials) {
    const group = shulkerTypeGroupForMaterial(material);
    const current = groups.get(group.id) ?? { ...group, materials: [] };
    current.materials.push(material);
    groups.set(group.id, current);
  }

  const order = ['wood', 'stone', 'glass', 'redstone', 'nature', 'utility', 'decorative', 'other'];

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      color: group.id === 'redstone'
        ? 'red'
        : shulkerColorForMaterials(group.materials, group.color ?? shulkerColorForType(group.id)),
      materials: [...group.materials].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => {
      const orderDelta = order.indexOf(a.id) - order.indexOf(b.id);
      return orderDelta || a.label.localeCompare(b.label);
    });
}

function shulkerBoxLabel(
  mode: ShulkerViewMode,
  groupLabel: string,
  globalBoxNumber: number,
  boxInGroup: number,
  groupBoxCount: number,
): string {
  if (mode === 'box') {
    return groupBoxCount > 1 ? `Shulker Box ${globalBoxNumber}` : 'Shulker Box';
  }

  return groupBoxCount > 1 ? `${groupLabel} ${boxInGroup}` : groupLabel;
}

function shulkerTypeGroupForMaterial(material: MaterialSummary): { id: string; label: string; color: string } {
  const category = shoppingCategoryForMaterial(material.id);
  return { ...category, color: shulkerColorForType(category.id) };
}

function materialStackSize(materialId: string): number {
  const id = stripBlockStateProperties(materialId).replace(/^minecraft:/, '');
  if (/(_bucket|boat|chest_boat|raft|chest_raft|minecart)$/.test(id)) return 1;
  if (/(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots|elytra|shield|bow|crossbow|trident|saddle|horse_armor)$/.test(id)) return 1;
  if (/^(bed|banner|cake|suspicious_stew|mushroom_stew|rabbit_stew|honey_bottle|potion|splash_potion|lingering_potion)$/.test(id)) return 1;
  if (/(sign|hanging_sign|ender_pearl|snowball|egg)$/.test(id)) return 16;
  return maxStackSize;
}

function shulkerSlotKey(boxId: string, slotIndex: number, slot: ShulkerStack): string {
  return `${boxId}:${slotIndex}:${slot.material.id}:${slot.count}`;
}

function shulkerColorForType(typeId: string): string {
  switch (typeId) {
    case 'wood':
      return 'brown';
    case 'stone':
      return 'gray';
    case 'glass':
      return 'light_blue';
    case 'redstone':
      return 'red';
    case 'nature':
      return 'green';
    case 'utility':
      return 'orange';
    case 'decorative':
      return 'magenta';
    default:
      return 'purple';
  }
}

function shulkerColorForIndex(index: number): string {
  const colors = ['purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'magenta', 'light_gray', 'gray', 'brown'] as const;
  return colors[index % colors.length];
}

function shulkerColorForMaterials(materials: MaterialSummary[], fallback: string): string {
  const total = materials.reduce((sum, material) => sum + Math.max(material.count, 0), 0);
  if (total <= 0) return fallback;

  const weighted = materials.reduce((acc, material) => {
    const weight = Math.max(material.count, 0);
    acc.red += ((material.color >> 16) & 0xff) * weight;
    acc.green += ((material.color >> 8) & 0xff) * weight;
    acc.blue += (material.color & 0xff) * weight;
    return acc;
  }, { red: 0, green: 0, blue: 0 });

  const color = (
    (Math.round(weighted.red / total) << 16)
    | (Math.round(weighted.green / total) << 8)
    | Math.round(weighted.blue / total)
  );

  const { saturation, lightness } = rgbToHsl(color);
  if (saturation < 0.08 || lightness < 0.16 || lightness > 0.9) return fallback;
  return `#${color.toString(16).padStart(6, '0')}`;
}

function shulkerBoxStateKey(color: string): string {
  const boxColor = shulkerBoxThumbnailColor(color);
  return boxColor === 'natural' ? 'minecraft:shulker_box' : `minecraft:${boxColor}_shulker_box`;
}

function shulkerBoxPreviewColor(color: string): number {
  return shulkerColorHex(shulkerBoxThumbnailColor(color));
}

function shulkerBoxThumbnailColor(color: string): string {
  if (color === 'theme') return 'cyan';
  if (color === 'natural' || shulkerBoxThumbnailColors.some((candidate) => candidate === color)) return color;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return 'purple';

  const target = Number.parseInt(color.slice(1), 16);
  let closestColor = 'purple';
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of shulkerBoxThumbnailColors) {
    const candidateColor = shulkerColorHex(candidate);
    const redDelta = ((target >> 16) & 0xff) - ((candidateColor >> 16) & 0xff);
    const greenDelta = ((target >> 8) & 0xff) - ((candidateColor >> 8) & 0xff);
    const blueDelta = (target & 0xff) - (candidateColor & 0xff);
    const distance = redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
    if (distance < closestDistance) {
      closestColor = candidate;
      closestDistance = distance;
    }
  }

  return closestColor;
}

function shulkerColorHex(color: string): number {
  switch (color) {
    case 'white':
      return 0xf3f4f0;
    case 'light_gray':
      return 0x9d9d97;
    case 'gray':
      return 0x474f52;
    case 'black':
      return 0x1d1d21;
    case 'brown':
      return 0x835432;
    case 'red':
      return 0xb02e26;
    case 'orange':
      return 0xf9801d;
    case 'yellow':
      return 0xfed83d;
    case 'green':
      return 0x5e7c16;
    case 'lime':
      return 0x80c71f;
    case 'cyan':
      return 0x169c9c;
    case 'light_blue':
      return 0x3ab3da;
    case 'blue':
      return 0x3c44aa;
    case 'purple':
      return 0x8932b8;
    case 'magenta':
      return 0xc74ebd;
    case 'pink':
      return 0xf38baa;
    default:
      return 0x8e44ad;
  }
}

function shulkerColorCss(color: string): string {
  if (color === 'theme') return 'var(--brand-b)';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return `#${shulkerColorHex(color).toString(16).padStart(6, '0')}`;
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
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
  if (isUpperHalfTallPlantStateKey(block.stateKey)) return 0;
  if (isPitcherCropStateKey(block.stateKey) && parseStateKey(block.stateKey)?.properties.half === 'upper') return 0;
  if (isPistonHeadStateKey(block.stateKey)) return 0;
  return isDoubleSlabStateKey(block.stateKey) ? 2 : 1;
}

// Canonical, canvas-independent state key for rendering a material's thumbnail in
// the lists. We drop the placed block's instance properties (facing, axis, open,
// connection flags, ...) so every list shows the block in a deterministic default
// orientation regardless of how/where it appears in the build. The desired facing
// is layered back on by the per-block thumbnail display adjustment (and the
// temporary in-list rotate control), keyed by this same base id.
function materialDisplayStateKey(stateKey: string): string {
  return stripBlockStateProperties(stateKey);
}

function materialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] | undefined {
  if (isFenceStateKey(stateKey)) return fenceMaterialThumbnailLayers(stateKey);
  if (isStairsStateKey(stateKey)) return stairMaterialThumbnailLayers(stateKey);
  if (isWallStateKey(stateKey)) return wallMaterialThumbnailLayers(stateKey);
  if (isBedStateKey(stateKey)) return bedMaterialThumbnailLayers(stateKey);
  if (isDoorStateKey(stateKey)) return doorMaterialThumbnailLayers(stateKey);
  if (isTallPlantStateKey(stateKey)) return tallPlantMaterialThumbnailLayers(stateKey);
  if (isPitcherCropStateKey(stateKey)) return pitcherCropMaterialThumbnailLayers(stateKey);
  return undefined;
}

function fenceMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
  // Show the inventory model (two posts joined by rails) like the in-game item,
  // rather than a single placed post with stub connectors.
  const baseState = stripBlockStateProperties(stateKey);
  const id = baseState.replace(/^minecraft:/, '');
  return [{ stateKey: baseState, modelId: `block/${id}_inventory` }];
}

function stairMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
  return [{ stateKey: stairMaterialStateKey(stateKey) }];
}

function wallMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
  return [{ stateKey: wallMaterialStateKey(stateKey) }];
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

function tallPlantMaterialThumbnailLayers(stateKey: string): BlockThumbnailLayer[] {
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

function isPistonBaseStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id === 'piston' || id === 'sticky_piston';
}

function isFenceStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id.endsWith('_fence') && !id.endsWith('_fence_gate');
}

function isCandleStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id === 'candle' || (id.endsWith('_candle') && !id.endsWith('_candle_cake'));
}

function isSeaPickleStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey) === 'minecraft:sea_pickle';
}

function isStairsStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey).replace(/^minecraft:/, '').endsWith('_stairs');
}

function isTallGrassStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey);
  return id === 'minecraft:tall_grass' || id === 'minecraft:tall_dry_grass';
}

function isTallPlantStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey);
  return id === 'minecraft:large_fern'
    || id === 'minecraft:lilac'
    || id === 'minecraft:peony'
    || id === 'minecraft:rose_bush'
    || id === 'minecraft:sunflower'
    || id === 'minecraft:tall_grass'
    || id === 'minecraft:tall_dry_grass'
    || id === 'minecraft:tall_seagrass';
}

function isWaterCauldronStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey) === 'minecraft:water_cauldron';
}

function isFlowingWaterStateKey(stateKey: string): boolean {
  const parsed = parseStateKey(stateKey);
  return parsed?.id === 'minecraft:water' && parsed.properties.level !== undefined && parsed.properties.level !== '0';
}

function isWaterSourceStateKey(stateKey: string): boolean {
  const parsed = parseStateKey(stateKey);
  return parsed?.id === 'minecraft:water' && (parsed.properties.level === undefined || parsed.properties.level === '0');
}

function isFlowingLavaStateKey(stateKey: string): boolean {
  const parsed = parseStateKey(stateKey);
  return parsed?.id === 'minecraft:lava' && parsed.properties.level !== undefined && parsed.properties.level !== '0';
}

function isLavaSourceStateKey(stateKey: string): boolean {
  const parsed = parseStateKey(stateKey);
  return parsed?.id === 'minecraft:lava' && (parsed.properties.level === undefined || parsed.properties.level === '0');
}

function isWallStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey).replace(/^minecraft:/, '').endsWith('_wall');
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

function isFenceGateStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey).replace(/^minecraft:/, '').endsWith('_fence_gate');
}

function isDoorStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id.endsWith('_door') && !id.endsWith('_trapdoor');
}

function isTrapdoorStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey).replace(/^minecraft:/, '').endsWith('_trapdoor');
}

function isPaneStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id.endsWith('_pane') || id.endsWith('_bars');
}

function isCampfireStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id === 'campfire' || id === 'soul_campfire';
}

function isWallTorchStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id === 'wall_torch' || id === 'soul_wall_torch' || id === 'redstone_wall_torch' || id === 'copper_wall_torch';
}

function isBannerStateKey(stateKey: string): boolean {
  // Matches both standing (`*_banner`) and wall (`*_wall_banner`) banners.
  return stripBlockStateProperties(stateKey).replace(/^minecraft:/, '').endsWith('_banner');
}

function isCoralFanStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey).replace(/^minecraft:/, '');
  return id.endsWith('_coral_fan') || id.endsWith('_coral_wall_fan');
}

function isDisplayHeadStateKey(stateKey: string): boolean {
  // Match standing and wall variants alike; materialIdForStateKey collapses the
  // wall variants onto these floor ids, which we exclude piston_head from.
  const base = materialIdForStateKey(stateKey).replace(/^minecraft:/, '');
  return base === 'player_head'
    || base === 'piglin_head'
    || base === 'zombie_head'
    || base === 'creeper_head'
    || base === 'dragon_head'
    || base === 'skeleton_skull'
    || base === 'wither_skeleton_skull';
}

function isWheatCropStateKey(stateKey: string): boolean {
  return stripBlockStateProperties(stateKey) === 'minecraft:wheat';
}

function isDirtCountStateKey(stateKey: string): boolean {
  const id = stripBlockStateProperties(stateKey);
  return id === 'minecraft:farmland' || id === 'minecraft:dirt_path';
}

function isUpperHalfTallPlantStateKey(stateKey: string): boolean {
  return isTallPlantStateKey(stateKey) && parseStateKey(stateKey)?.properties.half === 'upper';
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

function cloneCuboidCorners(corners: CuboidCorners): CuboidCorners {
  return {
    a: corners.a ? { ...corners.a } : null,
    b: corners.b ? { ...corners.b } : null,
  };
}

function createSelectionArea(corners: CuboidCorners, index: number): SelectionArea {
  const now = Date.now();
  return {
    id: createStableId('selection'),
    name: `Area ${index}`,
    corners: cloneCuboidCorners(corners),
    updatedAt: now,
  };
}

function createStableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function schematicStorageIdentity(model: SchematicModel): string {
  const dimensions = `${model.dimensions.width}x${model.dimensions.height}x${model.dimensions.length}`;
  return hashText(`${model.name}|${model.source}|${dimensions}|${model.paletteSize}`);
}

function selectionStorageKey(identity: string): string {
  return `${selectionStoragePrefix}:${identity}`;
}

function cameraStorageKey(identity: string): string {
  return `${cameraStoragePrefix}:${identity}`;
}

function parseSelectionAreas(raw: string | null): SelectionArea[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index): SelectionArea[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<SelectionArea>;
      const corners = parseCuboidCorners(candidate.corners);
      if (!corners) return [];
      return [{
        id: typeof candidate.id === 'string' ? candidate.id : createStableId('selection'),
        name: typeof candidate.name === 'string' ? candidate.name : `Area ${index + 1}`,
        corners,
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

function parseCuboidCorners(value: unknown): CuboidCorners | null {
  if (!value || typeof value !== 'object') return null;
  const corners = value as { a?: unknown; b?: unknown };
  return {
    a: parseCuboidPoint(corners.a),
    b: parseCuboidPoint(corners.b),
  };
}

function parseCuboidPoint(value: unknown): CuboidPoint | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== 'number' || typeof point.y !== 'number' || typeof point.z !== 'number') return null;
  return { x: point.x, y: point.y, z: point.z };
}

function clampCuboidCornersToModel(corners: CuboidCorners, model: SchematicModel): CuboidCorners {
  return {
    a: corners.a ? clampPointToModel(corners.a, model) : null,
    b: corners.b ? clampPointToModel(corners.b, model) : null,
  };
}

function parseSavedCameraViews(raw: string | null): SavedCameraView[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index): SavedCameraView[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<SavedCameraView>;
      if (!isSavedCameraPosition(candidate.position)) return [];
      return [{
        id: typeof candidate.id === 'string' ? candidate.id : createStableId('camera'),
        name: typeof candidate.name === 'string' ? candidate.name : `Camera ${index + 1}`,
        position: candidate.position,
        isDefault: Boolean(candidate.isDefault),
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

function isSavedCameraPosition(value: unknown): value is SavedCameraPosition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedCameraPosition>;
  return isNumberTuple3(candidate.position) && isNumberTuple3(candidate.target);
}

function isNumberTuple3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
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

function translatePoint(point: CuboidPoint, offset: CuboidPoint): CuboidPoint {
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
    z: point.z + offset.z,
  };
}

function translateBounds(bounds: CuboidBounds, offset: CuboidPoint): CuboidBounds {
  return {
    minX: bounds.minX + offset.x,
    minY: bounds.minY + offset.y,
    minZ: bounds.minZ + offset.z,
    maxX: bounds.maxX + offset.x,
    maxY: bounds.maxY + offset.y,
    maxZ: bounds.maxZ + offset.z,
  };
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

function describeRecipeSource(recipe: Recipe): string {
  const inputs = Object.keys(recipe.inputs).map((id) => formatBlockName(id));
  const label = inputs.length > 0 ? inputs.join(' + ') : 'Raw materials';
  return `${recipeTypeLabel(recipe.type)} · ${label}`;
}

function MaterialBreakdown({ materialId, count }: { materialId: string; count: number; compact?: boolean }) {
  const breakdown = storageBreakdown(materialId, count);
  const showStackBreakdown = hasStackBreakdown(breakdown.stackSize, count);
  const showShulkerBreakdown = hasShulkerBreakdown(breakdown.stackSize, count);
  const labelParts = [];

  if (showStackBreakdown) {
    labelParts.push(`${breakdown.stacks.toLocaleString()} stacks and ${breakdown.remainder.toLocaleString()} remaining`);
  }
  if (showShulkerBreakdown) {
    labelParts.push(`${breakdown.shulkerBoxes} ${breakdown.shulkerBoxesLabel}`);
  }
  if (labelParts.length === 0) return null;

  const stackItemsLabel = `${breakdown.stacks.toLocaleString()} + ${breakdown.remainder.toLocaleString()}`;
  const shulkerLabel = breakdown.shulkerBoxes;
  const label = `${count.toLocaleString()} items: ${labelParts.join('; ')}`;

  return (
    <span className="material-breakdown-count" aria-label={label}>
      {showStackBreakdown && (
        <span className="material-breakdown-group">
          <Layers size={13} strokeWidth={2.2} aria-hidden="true" />
          <strong>{stackItemsLabel}</strong>
        </span>
      )}
      {showStackBreakdown && showShulkerBreakdown && <span className="material-breakdown-divider" aria-hidden="true" />}
      {showShulkerBreakdown && (
        <span className="material-breakdown-group">
          <Box size={13} strokeWidth={2.2} aria-hidden="true" />
          <small>{shulkerLabel}</small>
        </span>
      )}
    </span>
  );
}

function shouldShowCompactMaterialBreakdown(materialId: string, count: number): boolean {
  const stackSize = itemStackSize(materialId);
  return hasStackBreakdown(stackSize, count) || hasShulkerBreakdown(stackSize, count);
}

function hasStackBreakdown(stackSize: number, count: number): boolean {
  return count > stackSize;
}

function hasShulkerBreakdown(stackSize: number, count: number): boolean {
  return count > halfShulkerBoxItemCount(stackSize);
}

function halfShulkerBoxItemCount(stackSize: number): number {
  return (stackSize * shulkerInventorySlots) / 2;
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
  shulkerBoxesLabel: string;
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
    shulkerBoxesLabel: shulkerBoxes === 1 ? 'shulker box' : 'shulker boxes',
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
  if (id === 'water_bucket' || id === 'lava_bucket') return 1;
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
