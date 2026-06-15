import { ChevronDown, Eye, EyeOff, RotateCw, Search } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

import type { BlockThumbnailLayer } from '../lib/blockThumbnails';

export interface MaterialListItem {
  id: string;
  label: string;
  count: number;
  color: number;
  stateKey: string;
  // Canonical state key used to render the thumbnail in the list, decoupled from
  // the placed block's facing/order in the canvas. Falls back to stateKey.
  displayStateKey?: string;
  thumbnailLayers?: BlockThumbnailLayer[];
}

interface MaterialListProps {
  ariaLabel: string;
  materials: MaterialListItem[];
  selectedMaterialId?: string | null;
  expandedMaterialIds: Set<string>;
  hiddenMaterialIds: Set<string>;
  hasBreakdown: (material: MaterialListItem) => boolean;
  onToggleExpanded: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  renderPreview: (material: MaterialListItem) => ReactNode;
  renderBreakdown: (material: MaterialListItem) => ReactNode;
  // TEMPORARY: when provided, renders a per-row rotate button that cycles how the
  // material's thumbnail faces in the list. Used for tuning thumbnail defaults.
  onRotateMaterial?: (material: MaterialListItem) => void;
  emptyText: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  emptySearchText?: (query: string) => string;
  onItemRef?: (id: string, node: HTMLDivElement | null) => void;
}

export function MaterialList({
  ariaLabel,
  materials,
  selectedMaterialId,
  expandedMaterialIds,
  hiddenMaterialIds,
  hasBreakdown,
  onToggleExpanded,
  onToggleVisibility,
  renderPreview,
  renderBreakdown,
  onRotateMaterial,
  emptyText,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search materials',
  searchAriaLabel = 'Search materials',
  emptySearchText,
  onItemRef,
}: MaterialListProps) {
  const query = searchValue?.trim() ?? '';
  const handleExpandableKeyDown = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggleExpanded(id);
  };

  return (
    <>
      {onSearchChange && (
        <label className="material-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={searchValue ?? ''}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchAriaLabel}
          />
        </label>
      )}
      <div className="material-stack" aria-label={ariaLabel}>
        {materials.map((material) => {
          const breakdownContent = renderBreakdown(material);
          const canExpand = hasBreakdown(material);
          const isExpanded = canExpand && expandedMaterialIds.has(material.id);
          const isSelected = material.id === selectedMaterialId;
          const isHidden = hiddenMaterialIds.has(material.id);
          const breakdownId = `material-breakdown-${material.id}`;

          return (
            <div
              className="material-item"
              key={material.id}
              ref={(node) => onItemRef?.(material.id, node)}
            >
              <div className={`material-row${isExpanded ? ' is-expanded' : ''}${isSelected ? ' is-selected' : ''}${onRotateMaterial ? ' has-rotate' : ''}`}>
                <div
                  className={`material-pick${canExpand ? '' : ' is-static'}`}
                  role={canExpand ? 'button' : undefined}
                  tabIndex={canExpand ? 0 : undefined}
                  aria-expanded={canExpand ? isExpanded : undefined}
                  aria-controls={canExpand ? breakdownId : undefined}
                  onClick={canExpand ? () => onToggleExpanded(material.id) : undefined}
                  onKeyDown={canExpand ? (event) => handleExpandableKeyDown(event, material.id) : undefined}
                >
                  {renderPreview(material)}
                  <span className="material-name">{material.label}</span>
                  <span className="material-actions">
                    {canExpand && <ChevronDown className="material-disclosure" size={15} aria-hidden="true" />}
                    <strong className="material-count-badge">{material.count.toLocaleString()}</strong>
                  </span>
                </div>
                {onRotateMaterial && (
                  <button
                    type="button"
                    className="material-rotate"
                    aria-label={`Rotate ${material.label} thumbnail facing`}
                    title="Rotate thumbnail facing (temporary)"
                    onClick={() => onRotateMaterial(material)}
                  >
                    <RotateCw size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="material-visibility"
                  aria-label={isHidden ? `Show ${material.label}` : `Hide ${material.label}`}
                  title={isHidden ? 'Show block' : 'Hide block'}
                  onClick={() => onToggleVisibility(material.id)}
                >
                  {isHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {isExpanded && (
                <div id={breakdownId} className="material-breakdown">
                  {breakdownContent}
                </div>
              )}
            </div>
          );
        })}
        {materials.length === 0 && (
          <p className="material-empty">
            {query && emptySearchText ? emptySearchText(query) : emptyText}
          </p>
        )}
      </div>
    </>
  );
}
