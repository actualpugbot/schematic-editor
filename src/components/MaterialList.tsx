import { ChevronDown, Eye, EyeOff, Search } from 'lucide-react';
import type { ReactNode } from 'react';

import type { BlockThumbnailLayer } from '../lib/blockThumbnails';

export interface MaterialListItem {
  id: string;
  label: string;
  count: number;
  color: number;
  stateKey: string;
  thumbnailLayers?: BlockThumbnailLayer[];
}

interface MaterialListProps {
  ariaLabel: string;
  materials: MaterialListItem[];
  selectedMaterialId?: string | null;
  expandedMaterialIds: Set<string>;
  hiddenMaterialIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  renderPreview: (material: MaterialListItem) => ReactNode;
  renderBreakdown: (material: MaterialListItem) => ReactNode;
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
  onToggleExpanded,
  onToggleVisibility,
  renderPreview,
  renderBreakdown,
  emptyText,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search materials',
  searchAriaLabel = 'Search materials',
  emptySearchText,
  onItemRef,
}: MaterialListProps) {
  const query = searchValue?.trim() ?? '';

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
          const isExpanded = expandedMaterialIds.has(material.id);
          const isSelected = material.id === selectedMaterialId;
          const isHidden = hiddenMaterialIds.has(material.id);
          const breakdownId = `material-breakdown-${material.id}`;

          return (
            <div
              className="material-item"
              key={material.id}
              ref={(node) => onItemRef?.(material.id, node)}
            >
              <div className={`material-row${isExpanded ? ' is-expanded' : ''}${isSelected ? ' is-selected' : ''}`}>
                <button
                  className="material-pick"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={breakdownId}
                  onClick={() => onToggleExpanded(material.id)}
                >
                  {renderPreview(material)}
                  <span className="material-name">{material.label}</span>
                  <span className="material-actions">
                    <strong className="material-count-badge">{material.count.toLocaleString()}</strong>
                    <ChevronDown className="material-disclosure" size={15} aria-hidden="true" />
                  </span>
                </button>
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
                  {renderBreakdown(material)}
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
