import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { PartViewerModal } from './PartViewerModal';
import { formatInfoDate, parseAppDate } from '../utils/datetime';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function matchesQuery(part, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const haystack = [
    part.brand,
    part.model,
    part.category,
    part.name,
    part.part_number,
    part.description,
    part.image_path,
    part.image_url
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

export function PartsFeed({ query, onStatsChange }) {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshingGroup, setRefreshingGroup] = useState('');
  const [tags, setTags] = useState([]);
  const [tagInputs, setTagInputs] = useState({});
  const [changeData, setChangeData] = useState({});
  const [changesPopup, setChangesPopup] = useState({ partId: null, x: 0, y: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImages, setModalImages] = useState([]);
  const [modalIndex, setModalIndex] = useState(0);
  const [modalPart, setModalPart] = useState(null);
  const [modalComparePart, setModalComparePart] = useState(null);
  const groupRefs = useRef({});

  useEffect(() => {
    fetchInitial();
    fetchTags();
  }, []);

  const fetchTags = async () => {
    try {
      const response = await axios.get('/api/tags');
      setTags(response.data || []);
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  };

  const normalizeRows = (rows) =>
    (rows || []).map((p) => ({
      ...p,
      tags: p.tags ? p.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
    }));

  const fetchInitial = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/motorcycles/parts-feed-all');
      setParts(normalizeRows(response.data || []));
    } catch (error) {
      console.error('Error loading parts feed:', error);
      setParts([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => parts.filter((p) => matchesQuery(p, query)), [parts, query]);
  const filteredStats = useMemo(() => {
    const brandSet = new Set();
    const motorcycleSet = new Set();
    for (const p of filtered) {
      const brand = String(p.brand || '').trim();
      const model = String(p.model || '').trim();
      if (brand) brandSet.add(brand);
      if (brand || model) motorcycleSet.add(`${brand}::${model}`);
    }
    return {
      filtered: filtered.length,
      loaded: parts.length,
      total: filtered.length,
      brands: brandSet.size,
      motorcycles: motorcycleSet.size,
      parts: filtered.length
    };
  }, [filtered, parts.length]);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const p of filtered) {
      const key = `${p.brand} ${p.model}`.trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  const partById = useMemo(() => {
    const map = new Map();
    for (const p of parts) map.set(p.id, p);
    return map;
  }, [parts]);

  useEffect(() => {
    if (typeof onStatsChange !== 'function') return;
    onStatsChange(filteredStats);
  }, [filteredStats, onStatsChange]);

  const jumpToGroup = (group) => {
    const target = groupRefs.current[group];
    if (!target) return;
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
  };

  const waitForScrapeToFinish = async (maxChecks = 90) => {
    for (let i = 0; i < maxChecks; i++) {
      try {
        const response = await axios.get('/api/motorcycles/scrape-status');
        if (!response?.data?.running) return true;
      } catch {
        // ignore temporary errors while polling
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  };

  const refreshSingleModel = async (group, modelUrl) => {
    if (!modelUrl || refreshingGroup) return;
    setRefreshingGroup(group);
    try {
      await axios.post('/api/motorcycles/scrape', {
        modelUrl,
        modelText: group,
        downloadImages: true
      });
      await waitForScrapeToFinish();
      await fetchInitial();
    } catch (error) {
      console.error('Error refreshing model:', error);
    } finally {
      setRefreshingGroup('');
    }
  };

  useEffect(() => {
    if (!changesPopup.partId) return;
    const onDocMouseDown = (event) => {
      const target = event.target;
      if (target?.closest?.('.changes-popover')) return;
      if (target?.closest?.('.changes-trigger')) return;
      setChangesPopup({ partId: null, x: 0, y: 0 });
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') setChangesPopup({ partId: null, x: 0, y: 0 });
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [changesPopup.partId]);

  const getInfoDate = (entry) => {
    if (!entry) return null;
    return (
      entry.recorded_at ||
      entry.scraped_at ||
      entry.last_seen ||
      entry.deleted_at ||
      null
    );
  };

  const toImageSrc = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return raw.startsWith('/') ? raw : `/${raw}`;
  };

  const updateTagInput = (partId, value) => {
    setTagInputs((prev) => ({ ...prev, [partId]: value }));
  };

  const addTag = async (partId) => {
    const value = (tagInputs[partId] || '').trim();
    if (!value) return;
    try {
      await axios.post('/api/tags/assign', { partId, tag: value });
      setParts((prev) =>
        prev.map((p) =>
          p.id === partId ? { ...p, tags: p.tags.includes(value) ? p.tags : [...p.tags, value] } : p
        )
      );
      updateTagInput(partId, '');
      fetchTags();
    } catch (error) {
      console.error('Error adding tag:', error);
    }
  };

  const removeTag = async (partId, tag) => {
    try {
      await axios.delete('/api/tags/assign', { data: { partId, tag } });
      setParts((prev) =>
        prev.map((p) =>
          p.id === partId ? { ...p, tags: p.tags.filter((t) => t !== tag) } : p
        )
      );
      fetchTags();
    } catch (error) {
      console.error('Error removing tag:', error);
    }
  };

  const openModal = async (part) => {
    try {
      const response = await axios.get(`/api/motorcycles/part/${part.id}/images`);
      const images = (response.data || [])
        .map((row) => toImageSrc(row.image_path || row.image_url))
        .filter(Boolean);
      const fallback = toImageSrc(part.image_path || part.image_url);
      const sources = images.length > 0 ? images : (fallback ? [fallback] : []);
      if (sources.length === 0) return;
      setModalImages([...new Set(sources)]);
      setModalIndex(0);
      setModalPart(part);
      setModalComparePart(null);
      setModalOpen(true);
    } catch (error) {
      console.error('Error loading part images:', error);
    }
  };

  const toggleChangesPopup = async (part, anchorEl) => {
    const changeCount = Number(part.historyCount) || 0;
    if (changeCount <= 0) return;

    if (changesPopup.partId === part.id) {
      setChangesPopup({ partId: null, x: 0, y: 0 });
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const popupWidth = 240;
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8));
    const y = rect.bottom + 6;
    setChangesPopup({ partId: part.id, x, y });

    if (changeData[part.id]) return;
    try {
      const response = await axios.get('/api/motorcycles/changes-history', {
        params: {
          partId: part.id,
          limit: 500
        }
      });
      const rows = (response.data || [])
        .slice()
        .sort((a, b) => {
          const ta = parseAppDate(a.recorded_at)?.getTime() || 0;
          const tb = parseAppDate(b.recorded_at)?.getTime() || 0;
          return tb - ta;
        })
        .slice(1);
      setChangeData((prev) => ({ ...prev, [part.id]: rows }));
    } catch (error) {
      console.error('Error fetching changes:', error);
    }
  };

  const getVisibleChangeCount = (part) => {
    const loaded = changeData[part.id];
    if (Array.isArray(loaded)) return loaded.length;
    return Math.max((Number(part.historyCount) || 0) - 1, 0);
  };

  const openSnapshotFromPopover = (partId, row) => {
    const basePart = partById.get(partId) || null;
    const eventType = String(row?.history_event || '').toLowerCase();
    const eventIsDeleted =
      eventType === 'deleted' ? 1 :
      eventType === 'restored' ? 0 :
      (row?.old_is_deleted ?? basePart?.is_deleted ?? 0);
    const eventDeletedAt =
      eventType === 'deleted' ? (row?.recorded_at || row?.old_deleted_at || null) :
      eventType === 'restored' ? null :
      (row?.old_deleted_at ?? basePart?.deleted_at ?? null);

    const snapshotPart = {
      ...(basePart || {}),
      id: partId,
      name: row?.old_name ?? basePart?.name ?? '',
      part_number: row?.old_part_number ?? basePart?.part_number ?? '',
      description: row?.old_description ?? basePart?.description ?? '',
      price: row?.old_price ?? basePart?.price ?? '',
      currency: row?.old_currency ?? basePart?.currency ?? '',
      image_url: row?.old_image_url ?? basePart?.image_url ?? null,
      image_path: row?.old_image_path ?? basePart?.image_path ?? null,
      is_deleted: eventIsDeleted,
      deleted_at: eventDeletedAt,
      recorded_at: row?.recorded_at ?? null,
      url: basePart?.url || null
    };
    const image = toImageSrc(snapshotPart.image_path || snapshotPart.image_url || basePart?.image_path || basePart?.image_url);
    setModalImages(image ? [image] : []);
    setModalIndex(0);
    setModalPart(snapshotPart);
    setModalComparePart(basePart);
    setModalOpen(true);
    setChangesPopup({ partId: null, x: 0, y: 0 });
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalImages([]);
    setModalIndex(0);
    setModalPart(null);
    setModalComparePart(null);
  };

  if (loading) return <div className="loading">Loading parts...</div>;

  return (
    <div className="parts-feed">
      <datalist id="tag-suggestions-global">
        {tags.map((t) => (
          <option key={t.name} value={t.name} />
        ))}
      </datalist>

      {grouped.length === 0 ? (
        <div className="no-selections">
          <p>No parts matched your filter.</p>
        </div>
      ) : (
        <div className="parts-feed-layout">
          <aside className="parts-shortcuts" aria-label="Parts shortcuts">
            <div className="parts-shortcuts-list">
              {grouped.map(([group, groupParts]) => (
                <button
                  key={`jump-${group}`}
                  className="parts-shortcut-item"
                  onClick={() => jumpToGroup(group)}
                  title={group}
                >
                  <span>{group}</span>
                  <span className="parts-shortcut-count">{groupParts.length}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="parts-feed-groups">
            {grouped.map(([group, groupParts]) => (
              <section
                key={group}
                className="feed-group"
                ref={(el) => {
                  if (el) groupRefs.current[group] = el;
                }}
              >
                <div className="feed-group-title">
                  <span>{group}</span>
                  <button
                    type="button"
                    className="group-refresh-button"
                    title={`Refresh ${group}`}
                    aria-label={`Refresh ${group}`}
                    disabled={Boolean(refreshingGroup)}
                    onClick={(e) => {
                      e.stopPropagation();
                      const modelUrl = groupParts.find((p) => p?.url)?.url || '';
                      refreshSingleModel(group, modelUrl);
                    }}
                  >
                    {refreshingGroup === group ? '...' : '↻'}
                  </button>
                </div>
                <div className="parts-grid">
                  {groupParts.map((part) => (
                    <div
                      key={part.id}
                      className={`part-card ${part.is_deleted ? 'deleted' : ''}`}
                      onClick={() => openModal(part)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openModal(part);
                        }
                      }}
                    >
                      {part.image_path ? (
                        <div className="image-wrapper">
                          <img
                            src={`/${part.image_path}`}
                            alt={part.name}
                            className="part-image"
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      ) : (
                        <div className="no-image">{part.part_number || ''}</div>
                      )}
                      <div className="part-info">
                        <h4 className="part-title">{part.name}</h4>
                        <div className="part-status">
                          {part.is_deleted ? (
                            <span className="status deleted">
                              Deleted {formatInfoDate(part.deleted_at)}
                            </span>
                          ) : part.lastChangeAt ? (
                            <span className="status updated">Updated {formatInfoDate(part.scraped_at || part.last_seen || part.lastChangeAt)}</span>
                          ) : null}
                        </div>
                        {part.description && <p className="description">{part.description}</p>}
                        <div className="part-meta">
                          <span className="part-number">{part.part_number || ''}</span>
                          <span className="price">{part.price}</span>
                        </div>
                        <div className="tag-row" onClick={(e) => e.stopPropagation()}>
                          <div className="tag-list">
                            {part.tags.map((tag) => (
                              <button
                                key={tag}
                                className="tag-chip"
                                onClick={(e) => { e.stopPropagation(); removeTag(part.id, tag); }}
                                title="Remove tag"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                          <div className="tag-add">
                            <input
                              className="tag-input"
                              list="tag-suggestions-global"
                              value={tagInputs[part.id] || ''}
                              onChange={(e) => updateTagInput(part.id, e.target.value)}
                              placeholder="Add tag"
                            />
                            <button
                              className="tag-add-button"
                              onClick={(e) => { e.stopPropagation(); addTag(part.id); }}
                            >
                              Add
                            </button>
                            <button
                              className="tag-add-button subtle changes-trigger"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleChangesPopup(part, e.currentTarget);
                              }}
                              disabled={getVisibleChangeCount(part) <= 0}
                              aria-disabled={getVisibleChangeCount(part) <= 0}
                            >
                              {(() => {
                                const changeCount = getVisibleChangeCount(part);
                                return changeCount > 0 ? `Changes (${changeCount})` : 'Changes';
                              })()}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      <div className="feed-sentinel">All parts loaded</div>

      {changesPopup.partId && (
        <div
          className="changes-popover"
          style={{ left: `${changesPopup.x}px`, top: `${changesPopup.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="changes-popover-title">Older snapshots</div>
          {(() => {
            const rows = changeData[changesPopup.partId] || [];
            if (rows.length === 0) {
              return <div className="change-empty">No changes recorded.</div>;
            }
            return rows.map((row) => (
              <div
                key={row.id}
                className="change-item change-item-clickable"
                role="button"
                tabIndex={0}
                onClick={() => openSnapshotFromPopover(changesPopup.partId, row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openSnapshotFromPopover(changesPopup.partId, row);
                  }
                }}
              >
                <div className="change-time">{formatInfoDate(row.recorded_at)}</div>
              </div>
            ));
          })()}
        </div>
      )}

      <PartViewerModal
        open={modalOpen}
        images={modalImages}
        index={modalIndex}
        part={modalPart}
        comparePart={modalComparePart}
        onIndexChange={setModalIndex}
        onClose={closeModal}
      />
    </div>
  );
}

