import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BoxSelect,
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
  Info,
  Layers,
  Moon,
  Pencil,
  Plus,
  Rotate3D,
  ScanSearch,
  Search,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import {
  Viewer3D,
  type AxisGizmoOrientation,
  type CameraMode,
  type SelectionButton,
  type Viewer3DHandle,
} from './components/Viewer3D';
import { createBlockThumbnail } from './lib/blockThumbnails';
import { writeNbt, type NbtDocument } from './lib/nbt';
import {
  createSampleModel,
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
type Theme = 'light' | 'dark';
type MaterialsScope = 'build' | 'cuboid';
type CuboidCornerId = 'a' | 'b';

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

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const savedTheme = window.localStorage.getItem(themeStorageKey);
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [model, setModel] = useState<SchematicModel | null>(null);
  const [schematicName, setSchematicName] = useState('');
  const [isEditingSchematicName, setIsEditingSchematicName] = useState(false);
  const [schematicDocument, setSchematicDocument] = useState<NbtDocument | null>(null);
  const [schematicExtension, setSchematicExtension] = useState('.schem');
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
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [cuboidSelectionMode, setCuboidSelectionMode] = useState(false);
  const [cuboidCorners, setCuboidCorners] = useState<CuboidCorners>(() => emptyCuboidCorners());
  const [materialsScope, setMaterialsScope] = useState<MaterialsScope>('build');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
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
  const totalBlocks = model?.blocks.length ?? 0;
  const isDarkTheme = theme === 'dark';
  const canSaveSchematic = Boolean(model && schematicDocument && schematicName.trim());

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
    setVisibleLayer(nextModel.dimensions.height - 1);
    setSingleLayer(false);
    setSelectedBlock(null);
    setExpandedMaterialIds(new Set());
    setMaterialSearch('');
    setPlayerHeadSelections({});
    setHiddenMaterialIds(new Set());
    setCuboidCorners(emptyCuboidCorners());
    setMaterialsScope('build');
    setSummaryCollapsed(false);
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
    if (!model || !schematicDocument) return;

    const nextName = schematicName.trim();
    try {
      renameSchematicDocument(schematicDocument, model.source, nextName);
      const bytes = writeNbt(schematicDocument);
      const arrayBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(arrayBuffer).set(bytes);
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFileBaseName(nextName)}${schematicExtension}`;
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

  const beginCuboidSelection = (resetSelection = false) => {
    if (resetSelection) {
      setCuboidCorners(emptyCuboidCorners());
      setMaterialsScope('build');
    }
    setCuboidSelectionMode(true);
    showPanel('selection');
  };

  const handleBlockSelect = (block: VoxelBlock | null, button: SelectionButton) => {
    if (!cuboidSelectionMode || inspectorTab !== 'selection') {
      if (button !== 'primary') return;
      setSelectedBlock(block);
      return;
    }

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
    setInspectorTab('selection');
  };

  const clearCuboidSelection = () => {
    setCuboidCorners(emptyCuboidCorners());
    setMaterialsScope('build');
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

        <div className="topbar-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={exportRenamedSchematic}
            disabled={!canSaveSchematic}
            title={schematicDocument ? 'Export schematic with current name' : 'Upload a schematic before exporting'}
          >
            <Download size={16} />
            Export
          </button>
          <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>
            <Upload size={17} />
            Upload
          </button>
          <button
            className="ghost-icon"
            type="button"
            onClick={toggleTheme}
            title={isDarkTheme ? 'Use light theme' : 'Use dark theme'}
            aria-label={isDarkTheme ? 'Use light theme' : 'Use dark theme'}
            aria-pressed={isDarkTheme}
          >
            {isDarkTheme ? <Sun size={18} /> : <Moon size={18} />}
          </button>
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
        </div>
      </header>

      <div className="workspace">
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

          {model && summaryCollapsed && (
            <button
              type="button"
              className="build-summary-toggle"
              onClick={() => setSummaryCollapsed(false)}
              title="Show build summary"
              aria-label="Show build summary"
              aria-expanded="false"
            >
              <Info size={17} />
            </button>
          )}

          {model && !summaryCollapsed && (
            <section className="build-summary-card" aria-label="Build summary">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Build Summary</p>
                </div>
                <button
                  type="button"
                  className="summary-dismiss"
                  onClick={() => setSummaryCollapsed(true)}
                  title="Collapse build summary"
                  aria-label="Collapse build summary"
                  aria-expanded="true"
                >
                  <Info size={15} />
                </button>
              </div>
              <dl className="summary-metrics">
                <div>
                  <dt>Dimensions</dt>
                  <dd>{model.dimensions.width} x {model.dimensions.height} x {model.dimensions.length}</dd>
                </div>
                <div>
                  <dt>Total Blocks</dt>
                  <dd>{totalBlocks.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Unique Materials</dt>
                  <dd>{materials.length.toLocaleString()}</dd>
                </div>
              </dl>
            </section>
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
                  showPanel('selection');
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
