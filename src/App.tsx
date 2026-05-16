import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cuboid,
  FileUp,
  Layers3,
  Rotate3D,
  ScanSearch,
} from 'lucide-react';
import { Viewer3D, type Viewer3DHandle } from './components/Viewer3D';
import { createSampleModel, parseSchematic, type SchematicModel, type VoxelBlock } from './lib/schematic';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function App() {
  const [model, setModel] = useState<SchematicModel | null>(() => createSampleModel());
  const [loadState, setLoadState] = useState<LoadState>('ready');
  const [error, setError] = useState('');
  const [visibleLayer, setVisibleLayer] = useState(model?.dimensions.height ? model.dimensions.height - 1 : 0);
  const [singleLayer, setSingleLayer] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<VoxelBlock | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<Viewer3DHandle | null>(null);
  const dragDepthRef = useRef(0);
  const visibleWorldY = model ? model.origin.y + visibleLayer : visibleLayer;
  const lowestWorldY = model ? model.origin.y : 0;
  const selectedBlockWorldX = selectedBlock && model ? model.origin.x + selectedBlock.x : null;
  const selectedBlockWorldY = selectedBlock && model ? model.origin.y + selectedBlock.y : null;
  const selectedBlockWorldZ = selectedBlock && model ? model.origin.z + selectedBlock.z : null;

  const visibleBlockCount = useMemo(() => {
    if (!model) return 0;
    if (singleLayer) {
      return model.layerCounts[visibleLayer] ?? 0;
    }
    return model.layerCounts.slice(0, visibleLayer + 1).reduce((sum, count) => sum + count, 0);
  }, [model, singleLayer, visibleLayer]);

  const topMaterials = useMemo(() => {
    if (!model) return [];

    const counts = new Map<string, { count: number; color: number }>();
    for (const block of model.blocks) {
      const current = counts.get(block.material) ?? { count: 0, color: block.color };
      current.count += 1;
      counts.set(block.material, current);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6);
  }, [model]);

  useEffect(() => {
    if (!model || !selectedBlock) {
      return;
    }

    const isFromCurrentModel = model.blocks.includes(selectedBlock);
    const isVisible = singleLayer ? selectedBlock.y === visibleLayer : selectedBlock.y <= visibleLayer;
    if (!isFromCurrentModel || !isVisible) {
      setSelectedBlock(null);
    }
  }, [model, selectedBlock, singleLayer, visibleLayer]);

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
          selectedBlock={selectedBlock}
          onBlockSelect={setSelectedBlock}
          viewerRef={viewerRef}
        />

        <div className="view-presets" aria-label="Camera presets">
          <button type="button" onClick={() => viewerRef.current?.setPreset('front')}>Front</button>
          <button type="button" onClick={() => viewerRef.current?.setPreset('right')}>Right</button>
          <button type="button" onClick={() => viewerRef.current?.setPreset('back')}>Back</button>
          <button type="button" onClick={() => viewerRef.current?.setPreset('left')}>Left</button>
          <button type="button" onClick={() => viewerRef.current?.setPreset('top')}>Top</button>
        </div>

        <div className="viewport-status" aria-live="polite">
          <span>{loadState === 'loading' ? 'Reading file...' : `${visibleBlockCount.toLocaleString()} visible blocks`}</span>
          <span>{singleLayer ? `Y ${visibleWorldY}` : `Y ${lowestWorldY}-${visibleWorldY}`}</span>
        </div>
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
            <section className="stats-grid" aria-label="Schematic summary">
              <Metric icon={<Box size={17} />} label="Blocks" value={model.blocks.length.toLocaleString()} />
              <Metric icon={<Layers3 size={17} />} label="Height" value={model.dimensions.height.toString()} />
            </section>

            <section className="selected-block" aria-live="polite">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Selection</p>
                  <h2>{selectedBlock ? selectedBlock.material : 'No block selected'}</h2>
                </div>
                <Box size={18} />
              </div>
              {selectedBlock ? (
                <div className="selected-block-details">
                  <p>{selectedBlock.name}</p>
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
                </div>
              ) : (
                <p className="selection-empty">Click a visible block in the viewport.</p>
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

              <div className="slider-wrap" style={{ '--layer-progress': `${layerPercent}%` } as React.CSSProperties}>
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
                <span>{(model.layerCounts[visibleLayer] ?? 0).toLocaleString()} blocks</span>
              </div>
            </section>

            <section className="material-list">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Materials</p>
                  <h2>Top blocks</h2>
                </div>
                <ChevronDown size={18} />
              </div>
              <div className="material-stack">
                {topMaterials.map(([name, item]) => (
                  <div className="material-row" key={name}>
                    <span className="swatch" style={{ backgroundColor: `#${item.color.toString(16).padStart(6, '0')}` }} />
                    <span>{name}</span>
                    <strong>{item.count.toLocaleString()}</strong>
                  </div>
                ))}
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

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function Metric({ icon, label, value }: MetricProps) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hasFiles(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export default App;
