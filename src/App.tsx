import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cuboid,
  Eye,
  EyeOff,
  FileUp,
  Rotate3D,
  ScanSearch,
  Search,
} from 'lucide-react';
import { Viewer3D, type Viewer3DHandle } from './components/Viewer3D';
import { resolveBlockParts, textureUrl, type ModelFaceName } from './lib/minecraftModels';
import { createSampleModel, parseSchematic, type PlayerHeadTexture, type SchematicModel, type VoxelBlock } from './lib/schematic';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface MaterialSummary {
  id: string;
  label: string;
  count: number;
  color: number;
  stateKey: string;
}

interface BlockPreviewTextures {
  shape: 'cube' | 'sprite';
  top?: string;
  left?: string;
  right?: string;
  sprite?: string;
}

function App() {
  const [model, setModel] = useState<SchematicModel | null>(() => createSampleModel());
  const [loadState, setLoadState] = useState<LoadState>('ready');
  const [error, setError] = useState('');
  const [visibleLayer, setVisibleLayer] = useState(model?.dimensions.height ? model.dimensions.height - 1 : 0);
  const [singleLayer, setSingleLayer] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<VoxelBlock | null>(null);
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(() => new Set());
  const [materialSearch, setMaterialSearch] = useState('');
  const [hiddenMaterialIds, setHiddenMaterialIds] = useState<Set<string>>(() => new Set());
  const [playerHeadSelections, setPlayerHeadSelections] = useState<Record<string, string>>({});
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<Viewer3DHandle | null>(null);
  const materialItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragDepthRef = useRef(0);
  const visibleWorldY = model ? model.origin.y + visibleLayer : visibleLayer;
  const selectedBlockWorldX = selectedBlock && model ? model.origin.x + selectedBlock.x : null;
  const selectedBlockWorldY = selectedBlock && model ? model.origin.y + selectedBlock.y : null;
  const selectedBlockWorldZ = selectedBlock && model ? model.origin.z + selectedBlock.z : null;

  const currentLayerBlockCount = useMemo(() => {
    if (!model) return 0;
    return model.blocks.filter((block) => block.y === visibleLayer && !hiddenMaterialIds.has(materialIdForBlock(block))).length;
  }, [hiddenMaterialIds, model, visibleLayer]);

  const materials = useMemo<MaterialSummary[]>(() => {
    if (!model) return [];

    const counts = new Map<string, MaterialSummary>();
    for (const block of model.blocks) {
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

    return Array.from(counts.entries())
      .map(([, item]) => item)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [model]);

  const filteredMaterials = useMemo(() => {
    const query = materialSearch.trim().toLocaleLowerCase();
    if (!query) return materials;

    return materials.filter((material) => {
      const label = material.label.toLocaleLowerCase();
      const id = material.id.toLocaleLowerCase();
      return label.includes(query) || id.includes(query);
    });
  }, [materialSearch, materials]);

  const playerHeadOptions = useMemo(() => uniquePlayerHeadTextures(model), [model]);
  const selectedBlockKey = selectedBlock ? blockPositionKey(selectedBlock) : null;
  const selectedMaterialId = selectedBlock ? materialIdForBlock(selectedBlock) : null;
  const selectedPlayerHeadTextureId = selectedBlock
    ? playerHeadSelections[blockPositionKey(selectedBlock)] ?? selectedBlock.playerHeadTexture?.id ?? playerHeadOptions[0]?.id ?? ''
    : '';

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

  const handleFile = async (file: File) => {
    setLoadState('loading');
    setError('');

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSchematic(buffer, { fileName: file.name });
      setModel(parsed);
      setVisibleLayer(parsed.dimensions.height - 1);
      setSingleLayer(false);
      setSelectedBlock(null);
      setExpandedMaterialIds(new Set());
      setMaterialSearch('');
      setPlayerHeadSelections({});
      setHiddenMaterialIds(new Set());
      setLoadState('ready');
    } catch (caught) {
      setLoadState('error');
      setError(caught instanceof Error ? caught.message : 'Could not read this schematic file.');
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);

    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
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

  return (
    <main
      className={`app-shell${isDraggingFile ? ' is-dragging-file' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="drop-overlay" aria-hidden={!isDraggingFile}>
        <div>
          <FileUp size={28} />
          <strong>Drop schematic file</strong>
          <span>.litematic, .schem, .schematic, or NBT</span>
        </div>
      </div>
      <section className="viewport-panel" aria-label="Schematic 3D viewport">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <Cuboid size={22} />
            </div>
            <div>
              <p className="eyebrow">Schemview</p>
              <h1>{model ? model.name : 'Minecraft schematic viewer'}</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => viewerRef.current?.spinOnce()} title="Spin 360 degrees">
              <Rotate3D size={19} />
            </button>
            <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>
              <FileUp size={18} />
              Upload
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

        <Viewer3D
          model={model}
          visibleLayer={visibleLayer}
          singleLayer={singleLayer}
          autoRotate={false}
          showGrid
          hiddenMaterialIds={hiddenMaterialIds}
          playerHeadSelections={playerHeadSelections}
          selectedBlock={selectedBlock}
          onBlockSelect={setSelectedBlock}
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
            <section className="summary-card" aria-label="Schematic summary">
              <div className="summary-selection" role="status" aria-live="polite">
                <p className="eyebrow">Selection</p>
                {selectedBlock ? (
                  <>
                    <strong>{selectedBlock.name}</strong>
                    <dl>
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
                  </>
                ) : (
                  <span>No block selected</span>
                )}
              </div>

              {selectedBlock && isPlayerHeadBlock(selectedBlock) && playerHeadOptions.length > 0 && (
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

            <section className="layer-control">
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

            <section className="material-list">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Materials</p>
                  <h2>
                    {materialSearch.trim()
                      ? `${filteredMaterials.length.toLocaleString()} of ${materials.length.toLocaleString()} materials`
                      : `${materials.length.toLocaleString()} materials`}
                  </h2>
                </div>
                <ChevronDown size={18} />
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
                          <strong>{storageBreakdown(material.id, material.count)}</strong>
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredMaterials.length === 0 && (
                  <p className="material-empty">No materials match "{materialSearch.trim()}".</p>
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
    </main>
  );
}

function BlockPreview({ stateKey, color }: { stateKey: string; color: number }) {
  const [textures, setTextures] = useState<BlockPreviewTextures | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveBlockParts(stateKey).then((parts) => {
      if (cancelled) return;
      setTextures(previewTextures(parts));
    });

    return () => {
      cancelled = true;
    };
  }, [stateKey]);

  const fallbackColor = `#${color.toString(16).padStart(6, '0')}`;

  return (
    <span
      className="block-preview"
      data-shape={textures?.shape ?? 'cube'}
      aria-hidden="true"
      style={{
        '--block-fallback': fallbackColor,
        '--block-top': textures?.top ? `url("${textures.top}")` : 'none',
        '--block-left': textures?.left ? `url("${textures.left}")` : 'none',
        '--block-right': textures?.right ? `url("${textures.right}")` : 'none',
        '--block-sprite': textures?.sprite ? `url("${textures.sprite}")` : 'none',
      } as CSSProperties}
    >
      <span className="block-preview-face block-preview-top" />
      <span className="block-preview-face block-preview-left" />
      <span className="block-preview-face block-preview-right" />
    </span>
  );
}

function previewTextures(parts: Awaited<ReturnType<typeof resolveBlockParts>>): BlockPreviewTextures {
  const part = parts.find((item) => item.faceTextures.up || item.faceTextures.north || item.faceTextures.east) ?? parts[0];
  if (!part) return { shape: 'sprite' };

  const faceTextures = part.faceTextures;
  const fallbackTexture = part.isFallback ? part.blockId : null;
  const top = faceTextures.up ?? faceTextures.north ?? faceTextures.east ?? faceTextures.south ?? faceTextures.west ?? faceTextures.down ?? fallbackTexture;
  const left = faceTextures.west ?? faceTextures.north ?? faceTextures.east ?? top;
  const right = faceTextures.east ?? faceTextures.south ?? faceTextures.north ?? top;
  const sprite = faceTextures.north ?? faceTextures.south ?? faceTextures.east ?? faceTextures.west ?? faceTextures.up ?? faceTextures.down;

  if (!isFullCubePreview(parts)) {
    return {
      shape: 'sprite',
      sprite: sprite ? textureUrl(sprite) : undefined,
    };
  }

  return {
    shape: 'cube',
    top: top ? textureUrl(top) : undefined,
    left: left ? textureUrl(left) : undefined,
    right: right ? textureUrl(right) : undefined,
  };
}

function isFullCubePreview(parts: Awaited<ReturnType<typeof resolveBlockParts>>): boolean {
  return parts.length === 1
    && parts[0].from.every((value) => value === 0)
    && parts[0].to.every((value) => value === 16)
    && (parts[0].isFallback || (['down', 'up', 'north', 'south', 'west', 'east'] satisfies ModelFaceName[]).every((face) => parts[0].faceTextures[face]));
}

function materialIdForBlock(block: VoxelBlock): string {
  return block.stateKey.split('[', 1)[0];
}

function blockPositionKey(block: VoxelBlock): string {
  return `${block.x},${block.y},${block.z}`;
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

function storageBreakdown(materialId: string, count: number): string {
  const stackSize = itemStackSize(materialId);
  const stacks = Math.floor(count / stackSize);
  const remainder = count % stackSize;
  const stackMath = remainder === 0
    ? `${stacks.toLocaleString()} x ${stackSize}`
    : `${stacks.toLocaleString()} x ${stackSize} + ${remainder.toLocaleString()}`;
  const shulkerBoxes = count / (stackSize * 27);

  return `${count.toLocaleString()} = ${stackMath} = ${formatShulkerBoxes(shulkerBoxes)} SB`;
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

function hasFiles(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export default App;
