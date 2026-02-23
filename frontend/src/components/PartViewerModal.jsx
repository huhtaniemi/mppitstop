import React, { useEffect, useState } from 'react';
import { formatInfoDate } from '../utils/datetime';

function getInfoDate(entry) {
  if (!entry) return null;
  return (
    entry.recorded_at ||
    entry.scraped_at ||
    entry.last_seen ||
    entry.deleted_at ||
    null
  );
}

function buildTextFragmentLink(baseUrl, textToHighlight) {
  if (!baseUrl) return '';
  try {
    const cleanBase = String(baseUrl).split('#')[0];
    if (!textToHighlight) return cleanBase;
    return `${cleanBase}#:~:text=${encodeURIComponent(textToHighlight)}`;
  } catch (error) {
    return baseUrl;
  }
}

export function PartViewerModal({ open, images, index, part, comparePart = null, onIndexChange, onClose }) {
  const [modalImageSize, setModalImageSize] = useState({ width: null, height: null });
  const safeImages = Array.isArray(images) ? images.filter(Boolean) : [];
  const safeIndex = Math.max(0, Math.min(index || 0, Math.max(safeImages.length - 1, 0)));
  const activeSrc = safeImages[safeIndex] || null;

  useEffect(() => {
    if (!open) return;
    setModalImageSize({ width: null, height: null });
  }, [open, index, images]);

  useEffect(() => {
    if (!open || !activeSrc) {
      setModalImageSize({ width: null, height: null });
      return;
    }

    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      const naturalW = probe.naturalWidth || 0;
      const naturalH = probe.naturalHeight || 0;
      if (!naturalW || !naturalH) return;
      const maxW = Math.floor(window.innerWidth * 0.9);
      const maxH = Math.floor(window.innerHeight * 0.8);
      const fitScale = Math.min(maxW / naturalW, maxH / naturalH);
      const finalScale = Math.max(Math.min(2, fitScale), 0.05);
      setModalImageSize({
        width: Math.max(Math.round(naturalW * finalScale), 1),
        height: Math.max(Math.round(naturalH * finalScale), 1)
      });
    };
    probe.src = activeSrc;

    return () => {
      cancelled = true;
    };
  }, [open, activeSrc]);
  const textChanged = (a, b) => String(a || '') !== String(b || '');
  const numberChanged = (a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isNaN(na) && Number.isNaN(nb)) return false;
    return na !== nb;
  };
  const priceChanged = comparePart ? (
    numberChanged(part?.price, comparePart?.price) ||
    textChanged(part?.currency, comparePart?.currency)
  ) : false;
  const partNumberChanged = comparePart ? textChanged(part?.part_number, comparePart?.part_number) : false;
  const nameChanged = comparePart ? textChanged(part?.name, comparePart?.name) : false;
  const descriptionChanged = comparePart ? textChanged(part?.description, comparePart?.description) : false;
  const imageChanged = comparePart
    ? (
      textChanged(part?.image_url, comparePart?.image_url) ||
      textChanged(part?.image_path, comparePart?.image_path)
    )
    : false;
  const isDeleted = Number(part?.is_deleted || 0) === 1;

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className={`modal-image-viewport ${imageChanged ? 'modal-image-changed' : ''}`}>
          <div className="modal-image-controls">
            <button className="modal-image-control close" onClick={onClose} aria-label="Close image viewer">x</button>
            {safeImages.length > 1 && (
              <>
                <button
                  className="modal-image-control prev"
                  onClick={() => onIndexChange((prev) => (prev === 0 ? safeImages.length - 1 : prev - 1))}
                  aria-label="Previous image"
                >
                  {'<'}
                </button>
                <button
                  className="modal-image-control next"
                  onClick={() => onIndexChange((prev) => (prev + 1) % safeImages.length)}
                  aria-label="Next image"
                >
                  {'>'}
                </button>
              </>
            )}
          </div>
          {safeImages[safeIndex] ? (
            <img
              src={safeImages[safeIndex]}
              alt="High-res"
              className="modal-image"
              style={{
                width: modalImageSize.width ? `${modalImageSize.width}px` : 'auto',
                height: modalImageSize.height ? `${modalImageSize.height}px` : 'auto'
              }}
            />
          ) : null}
        </div>
        {part && (
          <div className="modal-part-details">
            <div className="modal-part-text">{[part.brand, part.model].filter(Boolean).join(' ')}</div>
            <div className="modal-part-text modal-part-text-spacer" />
            <div className={`modal-part-text ${isDeleted ? 'modal-deleted-text' : ''}`}>
              <span className={partNumberChanged ? 'modal-diff-highlight' : ''}>
                {part.part_number ? `#${part.part_number}` : '#'}
              </span>
              {part.url && part.part_number && (
                <>
                  {' '}
                  <a
                    href={buildTextFragmentLink(part.url, part.part_number)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="modal-part-link-inline"
                  >
                    ref
                  </a>
                </>
              )}{' '}
              <span className={nameChanged ? 'modal-diff-highlight' : ''}>{part.name || ''}</span>{' '}
              {(() => {
                const priceText = [part.price, part.currency].filter(Boolean).join(' ').trim();
                const dateText = formatInfoDate(getInfoDate(part));
                if (!priceText && !dateText) return '';
                if (!priceText) return dateText;
                if (!dateText || dateText === 'Unknown') {
                  return <span className={priceChanged ? 'modal-diff-highlight' : ''}>[{priceText}]</span>;
                }
                return (
                  <>
                    <span className={priceChanged ? 'modal-diff-highlight' : ''}>[{priceText}]</span>
                    {'    '}
                    {dateText}
                  </>
                );
              })()}
            </div>
            {part.description && (
              <div className={`modal-part-text ${descriptionChanged ? 'modal-diff-highlight' : ''} ${isDeleted ? 'modal-deleted-text' : ''}`}>{part.description}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

