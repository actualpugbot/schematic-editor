import { useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cuboid,
  Eye,
  FileUp,
  Grid3X3,
  Layers3,
  Rotate3D,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { Viewer3D, type Viewer3DHandle } from './components/Viewer3D';
import { createSampleModel, parseSchematic, type SchematicModel } from './lib/schematic';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function App() {
  const [model, setModel] = useState<SchematicModel | null>(() => createSampleModel());
  const [loadState, setLoadState] = useState<LoadState>('ready');
  const [error, setError] = useState('');
  const [visibleLayer, setVisibleLayer] = useState(model?.dimensions.height ? model.dimensions.height - 1 : 0);
  const [singleLayer, setSingleLayer] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<Viewer3DHandle | null>(null);
  const dragDepthRef = useRef(0);

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

  const handleFile = async (file: File) => {
    setLoadState('loading');
    setError('');

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSchematic(buffer, { fileName: file.name });
      setModel(parsed);
      setVisibleLayer(parsed.dimensions.height - 1);
      setSingleLayer(false);
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

  const useSample = () => {
    const sample = createSampleModel();
    setModel(sample);
    setVisibleLayer(sample.dimensions.height - 1);
    setSingleLayer(false);
    setError('');
    setLoadState('ready');
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
          autoRotate={autoRotate}
          showGrid={showGrid}
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
          <span>{singleLayer ? `Layer ${visibleLayer + 1}` : `Layers 1-${visibleLayer + 1}`}</span>
        </div>
      </section>

      <aside className="control-rail" aria-label="Schematic controls">
        <section className="drop-zone">
          <div className="drop-icon" aria-hidden="true">
            <FileUp size={22} />
          </div>
          <div>
            <h2>Open a schematic</h2>
            <p>.litematic, .schem, .schematic, or NBT files stay in this browser.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>
            Choose file
          </button>
          <button className="text-button" type="button" onClick={useSample}>
            Load sample
          </button>
        </section>

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
              <Metric
                icon={<Grid3X3 size={17} />}
                label="Footprint"
                value={`${model.dimensions.width} x ${model.dimensions.length}`}
              />
              <Metric icon={<Sparkles size={17} />} label="Palette" value={model.paletteSize.toString()} />
            </section>

            <section className="layer-control">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Layer view</p>
                  <h2>Y {visibleLayer}</h2>
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

            <section className="view-control">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">360 view</p>
                  <h2>Orbit</h2>
                </div>
                <Eye size={18} />
              </div>
              <label className="switch-row">
                <span>Auto rotate</span>
                <input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} />
              </label>
              <label className="switch-row">
                <span>Footprint grid</span>
                <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
              </label>
              <button className="wide-button" type="button" onClick={() => viewerRef.current?.spinOnce()}>
                <Rotate3D size={18} />
                One full turn
              </button>
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
