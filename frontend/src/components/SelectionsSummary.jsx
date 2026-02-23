import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { PartViewerModal } from './PartViewerModal';

export function SelectionsSummary() {
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [editingTag, setEditingTag] = useState('');
  const [editingValue, setEditingValue] = useState('');
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImages, setModalImages] = useState([]);
  const [modalIndex, setModalIndex] = useState(0);
  const [modalPart, setModalPart] = useState(null);

  useEffect(() => {
    fetchTags();
  }, []);

  const fetchTags = async (preferredTag = null) => {
    try {
      const response = await axios.get('/api/tags');
      const rows = response.data || [];
      setTags(rows);
      const available = new Set(rows.map((r) => r.name));
      let nextTag = '';
      if (preferredTag && available.has(preferredTag)) {
        nextTag = preferredTag;
      } else if (selectedTag && available.has(selectedTag)) {
        nextTag = selectedTag;
      } else if (rows.length > 0) {
        nextTag = rows[0].name;
      }

      setSelectedTag(nextTag);
      if (nextTag) {
        fetchParts(nextTag);
      } else {
        setParts([]);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching tags:', error);
      setLoading(false);
    }
  };

  const fetchParts = async (tag) => {
    try {
      const response = await axios.get(`/api/tags/${encodeURIComponent(tag)}`);
      setParts(response.data);
    } catch (error) {
      console.error('Error fetching tagged parts:', error);
    }
  };

  const openModal = async (part) => {
    try {
      const response = await axios.get(`/api/motorcycles/part/${part.id}/images`);
      const images = (response.data || [])
        .map((row) => {
          const src = row.image_path || row.image_url;
          if (!src) return null;
          if (String(src).startsWith('http://') || String(src).startsWith('https://')) return src;
          return String(src).startsWith('/') ? src : `/${src}`;
        })
        .filter(Boolean);
      const fallbackSource = part.image_path || part.image_url;
      const fallback = fallbackSource
        ? (String(fallbackSource).startsWith('http://') || String(fallbackSource).startsWith('https://')
          ? fallbackSource
          : (String(fallbackSource).startsWith('/') ? fallbackSource : `/${fallbackSource}`))
        : null;
      const sources = images.length > 0 ? images : (fallback ? [fallback] : []);
      if (sources.length === 0) return;
      setModalImages([...new Set(sources)]);
      setModalIndex(0);
      setModalPart(part);
      setModalOpen(true);
    } catch (error) {
      console.error('Error loading part images:', error);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalImages([]);
    setModalIndex(0);
    setModalPart(null);
  };

  const removeFromCollection = async (partId) => {
    if (!selectedTag) return;
    try {
      await axios.delete('/api/tags/assign', { data: { partId, tag: selectedTag } });
      setParts((prev) => prev.filter((p) => p.id !== partId));
      fetchTags();
    } catch (error) {
      console.error('Error removing part from collection:', error);
    }
  };

  const deleteTag = async () => {
    const tagToDelete = String(selectedTag || '').trim();
    if (!tagToDelete) return;
    if (!confirm(`Delete whole tag "${tagToDelete}" and remove it from all parts?`)) return;
    try {
      await axios.delete(`/api/tags/${encodeURIComponent(tagToDelete)}`);
      await fetchTags();
    } catch (error) {
      console.error('Error deleting tag:', error);
      const message = error?.response?.data?.error || 'Delete tag failed';
      alert(message);
    }
  };

  const buildCollectionCopyText = (rows) => {
    const sorted = [...(rows || [])].sort((a, b) => {
      const brandCmp = String(a.brand || '').localeCompare(String(b.brand || ''));
      if (brandCmp !== 0) return brandCmp;
      const modelCmp = String(a.model || '').localeCompare(String(b.model || ''));
      if (modelCmp !== 0) return modelCmp;
      return String(a.part_number || '').localeCompare(String(b.part_number || ''));
    });

    const groups = new Map();
    for (const part of sorted) {
      const key = `${part.brand || ''} ${part.model || ''}`.trim() || 'Unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(part);
    }

    const lines = [];
    for (const [, groupParts] of groups.entries()) {
      const link = groupParts.find((p) => p.url)?.url || '';
      lines.push(link);
      for (const p of groupParts) {
        const partNo = p.part_number || '';
        const name = p.name || '';
        const price = [p.price, p.currency].filter(Boolean).join(' ').trim();
        lines.push(`${partNo}, ${name}, ${price}`.trim());
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  };

  const copyCollectionList = async () => {
    try {
      if (!parts || parts.length === 0) return;
      const text = buildCollectionCopyText(parts);
      if (!text) return;
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Error copying collection list:', error);
    }
  };

  const startRenameTag = (name) => {
    setEditingTag(name);
    setEditingValue(name);
  };

  const cancelRenameTag = () => {
    setEditingTag('');
    setEditingValue('');
  };

  const commitRenameTag = async (oldName) => {
    const trimmed = String(editingValue || '').trim();
    if (!trimmed || trimmed === oldName) {
      cancelRenameTag();
      return;
    }
    try {
      const response = await axios.post('/api/tags/rename', {
        oldName,
        newName: trimmed
      });
      if (response.data?.success) {
        if (selectedTag === oldName) {
          setSelectedTag(trimmed);
          fetchParts(trimmed);
        }
        cancelRenameTag();
        fetchTags();
      }
    } catch (error) {
      console.error('Error renaming tag:', error);
      const message = error?.response?.data?.error || 'Rename failed';
      alert(message);
      cancelRenameTag();
    }
  };

  if (loading) return <div className="loading">Loading collections...</div>;

  return (
    <div className="selections-summary-container">
      <h2>Collections</h2>

      {tags.length === 0 ? (
        <div className="no-selections">
          <p>No tags yet. Add tags to parts to create collections.</p>
        </div>
      ) : (
        <div className="collections-layout">
          <div className="collections-sidebar">
            {tags.map((tag) => (
              <div key={tag.name} className="collection-tag-row">
                <button
                  className={`collection-tag ${selectedTag === tag.name ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedTag(tag.name);
                    fetchParts(tag.name);
                  }}
                >
                  <span>{tag.name}</span>
                  <span className="tag-count">{tag.count}</span>
                </button>
              </div>
            ))}
          </div>
          <div className="collections-content">
            <div className="collection-header">
              <div className="collection-title">
                {editingTag === selectedTag ? (
                  <input
                    type="text"
                    className="collection-tag-edit-input"
                    value={editingValue}
                    autoFocus
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => commitRenameTag(selectedTag)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRenameTag(selectedTag);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRenameTag();
                      }
                    }}
                  />
                ) : (
                  <>
                    {selectedTag} <span className="collection-count">({parts.length} parts)</span>
                  </>
                )}
              </div>
              <div className="collection-header-actions">
                <button
                  type="button"
                  className="collection-tag-rename"
                  title={`Rename "${selectedTag}"`}
                  aria-label={`Rename tag ${selectedTag}`}
                  onClick={() => startRenameTag(selectedTag)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="collection-delete-tag-button"
                  onClick={deleteTag}
                  title={`Delete tag "${selectedTag}"`}
                  aria-label={`Delete tag ${selectedTag}`}
                >
                  🗑
                </button>
                <button
                  type="button"
                  className="collection-copy-button"
                  onClick={copyCollectionList}
                  title="Copy list to clipboard"
                  aria-label="Copy list to clipboard"
                >
                  ⧉
                </button>
              </div>
            </div>
            {parts.length === 0 ? (
              <div className="no-selections">
                <p>No parts with this tag.</p>
              </div>
            ) : (
              <table className="parts-table">
                <thead>
                  <tr>
                    <th className="part-number-col">Part Number</th>
                    <th className="part-name-col">Part Name</th>
                    <th>Price</th>
                    <th></th>
                    <th>Motorcycle</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((part) => (
                    <tr
                      key={part.id}
                      className={`clickable-row ${part.is_deleted ? 'unavailable' : ''}`}
                      onClick={() => openModal(part)}
                    >
                      <td className="part-number-col">{part.part_number || ''}</td>
                      <td className="part-name-col">{part.name}</td>
                      <td>{part.price}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="collection-remove-icon"
                          onClick={() => removeFromCollection(part.id)}
                          title={`Remove from ${selectedTag}`}
                          aria-label={`Remove ${part.part_number || part.name} from ${selectedTag}`}
                        >
                          x
                        </button>
                      </td>
                      <td>{part.brand} {part.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <PartViewerModal
        open={modalOpen}
        images={modalImages}
        index={modalIndex}
        part={modalPart}
        onIndexChange={setModalIndex}
        onClose={closeModal}
      />
    </div>
  );
}
