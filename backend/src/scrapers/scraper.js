import axios from 'axios';
import * as cheerio from 'cheerio';
import { db } from '../db/database.js';
import { downloadImage } from './imageDownloader.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORIES = [
  { name: 'PURKUPYÖRÄT', url: 'https://www.purkuosat.net/lista.htm', category: 'motorcycles' },
];

function toDbLocalTimestamp(input) {
  const d = input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) return toDbLocalTimestamp(null);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function resolveScrapeTimestamp(options = {}) {
  return options.scrapeTimestamp || toDbLocalTimestamp(options.scrapeStartedAt);
}

function normalizeModelUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '').trim();
  }
}

function normalizeFilterList(allowedBrands) {
  if (!Array.isArray(allowedBrands)) return [];
  return allowedBrands
    .map(v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .map(v => v.split(/\s+/).filter(Boolean))
    .filter(tokens => tokens.length > 0);
}

function toBrandCase(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (token.length <= 3) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function toImagesShorthand(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('images/')) return raw;
  try {
    const u = new URL(raw);
    const p = decodeURIComponent(u.pathname).replace(/\\/g, '/');
    const idx = p.toLowerCase().indexOf('/images/');
    if (idx >= 0) return p.slice(idx + 1);
  } catch {
    // not an absolute URL, continue below
  }
  return raw;
}

function uniqueImageRefs(urls = []) {
  const refs = [];
  for (const u of urls) {
    const ref = toImagesShorthand(u);
    if (!ref) continue;
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

function formatImageStatus(status) {
  if (status === 'downloaded_new') return 'downloaded, new';
  if (status === 'downloaded_updated') return 'downloaded, updated';
  return 'skipped, unchanged';
}

function ensureNotAborted(signal) {
  if (signal?.aborted) {
    throw new Error('Scrape aborted');
  }
}

async function waitOrAbort(ms, signal) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      reject(new Error('Scrape aborted'));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error('Scrape aborted'));
      return;
    }
    signal?.addEventListener?.('abort', onAbort);
  });
}

function matchesAllowedFilter(filters, linkText, brand, model) {
  if (!filters.length) return true;
  const haystack = String(`${linkText || ''} ${brand || ''} ${model || ''}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  // OR between comma-separated filters, AND between words inside each filter.
  // Example: "aprilia 125, cagiva" -> (aprilia AND 125) OR (cagiva)
  return filters.some(tokens => tokens.every(token => haystack.includes(token)));
}

export async function scrapeCategoryList(allowedBrands = null, options = {}) {
  const maxLinksPerCategory = Number.isInteger(options.maxLinksPerCategory) && options.maxLinksPerCategory > 0
    ? options.maxLinksPerCategory
    : null;
  const downloadImages = options.downloadImages !== false;
  const filters = normalizeFilterList(allowedBrands);
  const signal = options.signal;
  const scrapeTimestamp = resolveScrapeTimestamp(options);

  try {
    for (const category of CATEGORIES) {
      ensureNotAborted(signal);
      console.log(`\nFetching category: ${category.name}`);
      const response = await axios.get(category.url, {
        timeout: 10000,
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const links = [];

      // Parse motorcycle/category links ONLY inside the main column (#column_l)
      $('#column_l a[href*=".htm"]').each((i, elem) => {
        const href = $(elem).attr('href');
        // Normalize whitespace in link text
        const text = ($(elem).text() || '').replace(/\s+/g, ' ').trim();

        // Filter for actual motorcycle model pages
        if (href && text.length > 2 && !text.match(/^(PURKUO|Home|TARVIKE|RENKAAT|ÖLJY|OSTAMME|MYYNTI|YHTEYSTIEDOT|FAQ|OHJEET|Pakoputki)/i)) {
          const fullUrl = href.startsWith('http') ? href : `https://www.purkuosat.net/${href}`;
          links.push({
            text,
            href: fullUrl,
            category: category.category
          });
        }
      });

      // Remove duplicates
      const uniqueLinks = Array.from(new Map(links.map(l => [l.href, l])).values());
      const linksToScrape = maxLinksPerCategory ? uniqueLinks.slice(0, maxLinksPerCategory) : uniqueLinks;
      console.log(`Found ${uniqueLinks.length} motorcycle model pages`);
      if (maxLinksPerCategory) {
        console.log(`Test mode limit: scraping first ${linksToScrape.length} model page(s)`);
      }

      // Scrape each motorcycle page
      for (let i = 0; i < linksToScrape.length; i++) {
        ensureNotAborted(signal);
        const link = linksToScrape[i];
        // Quick pre-filter using link text to avoid fetching pages for other brands
        const [linkBrand, linkModel] = extractBrandModel(link.text);
        if (!matchesAllowedFilter(filters, link.text, linkBrand, linkModel)) continue;
        console.log(`  [${i + 1}/${linksToScrape.length}] ${link.text}`);
        console.log(`      ${link.href}`);
        await scrapeMotorcyclePage(link, allowedBrands, { downloadImages, signal, scrapeTimestamp });
        // Add small delay to be respectful to server
        await waitOrAbort(500, signal);
      }
    }

    console.log('\nScraping complete.');
  } catch (error) {
    if (error.message === 'Scrape aborted') {
      console.log('\nScraping aborted.');
      return;
    }
    console.error('Error scraping categories:', error.message);
  }
}

export async function scrapeMotorcyclePage(link, allowedBrands = null, options = {}) {
  try {
    const scrapeTimestamp = resolveScrapeTimestamp(options);
    ensureNotAborted(options.signal);
    const listingUrl = normalizeModelUrl(link.href);
    const response = await axios.get(listingUrl, {
      timeout: 10000,
      signal: options.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    
    // Extract brand and model from link text
    const [brand, model] = extractBrandModel(link.text);

    // If allowedBrands provided, skip if this brand is not in the list
    const filters = normalizeFilterList(allowedBrands);
    if (!matchesAllowedFilter(filters, link.text, brand, model)) return;

    let motorcycleId = generateId(`${brand}-${model}`);

    // Prefer matching by source URL to avoid duplicates when brand mapping improves later.
    const existingByUrl = await db.get('SELECT id, brand, model FROM motorcycles WHERE url = ?', [listingUrl]);
    if (existingByUrl) {
      motorcycleId = existingByUrl.id;
      if (existingByUrl.brand !== brand || existingByUrl.model !== model) {
        await db.run(
           `UPDATE motorcycles
           SET brand = ?, model = ?, category = ?, last_updated = ?
           WHERE id = ?`,
          [brand, model, link.category, scrapeTimestamp, motorcycleId]
        );
      }
    } else {
      // Fallback to generated id match for compatibility with existing DB records.
      const existingById = await db.get('SELECT id FROM motorcycles WHERE id = ?', [motorcycleId]);
      if (existingById) {
        await db.run(
          `UPDATE motorcycles
           SET brand = ?, model = ?, category = ?, url = ?, last_updated = ?
           WHERE id = ?`,
          [brand, model, link.category, listingUrl, scrapeTimestamp, motorcycleId]
        );
      } else {
      await db.run(
        `INSERT INTO motorcycles (id, brand, model, category, url) VALUES (?, ?, ?, ?, ?)`,
        [motorcycleId, brand, model, link.category, listingUrl]
      );
    }
    }

    // Scrape parts from this page
    const result = await scrapeParts($, motorcycleId, listingUrl, { ...options, scrapeTimestamp });
    await markDeletedParts(motorcycleId, result.seenPartIds, scrapeTimestamp);

  } catch (error) {
    console.error(`    Error scraping ${link.text}: ${error.message}`);
  }
}

export async function scrapeParts($, motorcycleId, pageUrl, options = {}) {
  const parts = [];
  const downloadImages = options.downloadImages !== false;
  const scrapeTimestamp = resolveScrapeTimestamp(options);
  const cleanText = (value) =>
    (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // The site uses blocks where a row contains 'OSA' with the part name,
  // followed by rows like OSANRO / LISÄTIEDOT / HINTA. We'll walk tables and
  // collect those blocks into part records.
  $('table').each((ti, table) => {
    const rows = $(table).find('tr').toArray();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = $(row).find('td');
      if (!cells || cells.length === 0) continue;

      const texts = cells.map((ci, c) => cleanText($(c).text())).get();

      // Detect header row with 'OSA' label
      const hasOsa = texts.some(t => /^OSA$/i.test(t) || t.toUpperCase().startsWith('OSA'));
      if (hasOsa) {
        // Part name is usually in the same row (last non-empty cell)
        const name = texts.reverse().find(t => t && !/^\-+$/.test(t)) || '';
        texts.reverse();

        let partNumber = '';
        let description = '';
        let price = 0;

        // Inspect following rows for OSANRO, LISÄTIEDOT, HINTA until next OSA or end
        let j = i + 1;
        for (; j < rows.length; j++) {
          const crow = rows[j];
          const ccells = $(crow).find('td');
          if (!ccells || ccells.length === 0) continue;
          const ctexts = ccells.map((ci, c) => cleanText($(c).text())).get();

          // stop if a new OSA block starts (do not match OSANRO)
          if (ctexts.some(t => /^OSA$/i.test(t))) break;

          const label = (ctexts[0] || '').toUpperCase();
          const rowText = ctexts.join(' ').trim();

          if (!partNumber && label.includes('OSANRO')) {
            const direct = cleanText($(ccells[1]).text());
            partNumber = direct || '';
            if (!partNumber) {
              const m = rowText.match(/OSANRO\s*[:\-]?\s*([A-Z0-9._-]+)/i);
              if (m && m[1] !== '0') partNumber = m[1];
            }
          }

          if (!description && (label.includes('LISÄTIEDOT') || label.includes('LISATIEDOT'))) {
            description = cleanText($(ccells[1]).text()) || cleanText(ctexts.slice(1).join(' '));
          }

          if (label.includes('HINTA') || rowText.toUpperCase().includes('EUR')) {
            const match = ctexts.join(' ').match(/(\d+(?:[,\.]\d{1,2})?)\s*EUR/);
            if (match) price = parseFloat(match[1].replace(',', '.'));
          } else {
            // fallback: price may be somewhere in the row
            const match = ctexts.join(' ').match(/(\d+(?:[,\.]\d{1,2})?)\s*EUR/);
            if (match) price = parseFloat(match[1].replace(',', '.'));
          }
        }

        if (name && price > 0) {
          // Prefer the first image in the whole table (rowspanned thumbnail)
          let imageUrl = '';
          let imageAlt = '';
          const imageCandidates = new Set();
          const tableImgs = $(table).find('img').toArray();
          if (tableImgs.length > 0) {
            for (const img of tableImgs) {
              const tiSrc = $(img).attr('src') || '';
              const tiParent = $(img).parent('a').attr('href') || '';
              if (tiParent && tiParent.length > 0) imageCandidates.add(resolveUrl(tiParent, pageUrl));
              if (tiSrc && tiSrc.length > 0) imageCandidates.add(resolveUrl(tiSrc, pageUrl));
            }
            imageAlt = $(tableImgs[0]).attr('alt') || '';
            if (imageCandidates.size > 0) {
              imageUrl = [...imageCandidates][0];
            }
          }

          // Fallback: check current row and following rows
          if (!imageUrl) {
            const imgs = $(row).find('img').toArray();
            if (imgs.length > 0) {
              const src = $(imgs[0]).attr('src') || '';
              const parentHref = $(imgs[0]).parent('a').attr('href') || '';
              imageUrl = (parentHref && parentHref.length > 0) ? parentHref : src;
              imageAlt = $(imgs[0]).attr('alt') || '';
              if (parentHref) imageCandidates.add(resolveUrl(parentHref, pageUrl));
              if (src) imageCandidates.add(resolveUrl(src, pageUrl));
            }
          }

          if (!imageUrl) {
            for (let k = i + 1; k < j; k++) {
              const r2 = rows[k];
              const imgs2 = $(r2).find('img').toArray();
              if (imgs2.length > 0) {
                const src2 = $(imgs2[0]).attr('src') || '';
                const parentHref2 = $(imgs2[0]).parent('a').attr('href') || '';
                imageUrl = (parentHref2 && parentHref2.length > 0) ? parentHref2 : src2;
                imageAlt = $(imgs2[0]).attr('alt') || '';
                if (parentHref2) imageCandidates.add(resolveUrl(parentHref2, pageUrl));
                if (src2) imageCandidates.add(resolveUrl(src2, pageUrl));
                break;
              }
            }
          }

          if (!imageUrl) {
            console.log(`      No image found for part '${name.trim()}' in detected block.`);
          }

          parts.push({
            name: name.trim(),
            partNumber: partNumber || (imageAlt && imageAlt.match(/RS\d+/) ? imageAlt.match(/RS\d+/)[0] : ''),
            description: description.trim(),
            price,
            currency: 'EUR',
            imageUrl: imageUrl ? resolveUrl(imageUrl, pageUrl) : null,
            imageUrls: [...imageCandidates]
          });
        }

        // advance outer loop to j-1
        i = j - 1;
      }
    }
  });

  // Remove duplicates by partNumber (preferred) or name; merge image lists for same part.
  const uniquePartsMap = new Map();
  for (const p of parts) {
    const key = p.partNumber || p.name;
    if (!uniquePartsMap.has(key)) {
      uniquePartsMap.set(key, { ...p, imageUrls: [...new Set(p.imageUrls || (p.imageUrl ? [p.imageUrl] : []))] });
      continue;
    }
    const current = uniquePartsMap.get(key);
    current.imageUrls = [...new Set([...(current.imageUrls || []), ...(p.imageUrls || []), ...(p.imageUrl ? [p.imageUrl] : [])])];
    if (!current.imageUrl && p.imageUrl) current.imageUrl = p.imageUrl;
  }
  const uniqueParts = Array.from(uniquePartsMap.values());
  console.log(`    Found ${uniqueParts.length} parts`);

  const seenPartIds = [];

  for (const part of uniqueParts) {
    const idSeed = part.partNumber || part.name;
    const partId = generateId(`${motorcycleId}-${idSeed}`);
    seenPartIds.push(partId);

    // Find existing part by motorcycle and part number
    const existing = part.partNumber
      ? await db.get('SELECT * FROM parts WHERE motorcycle_id = ? AND part_number = ?', [motorcycleId, part.partNumber])
      : await db.get('SELECT * FROM parts WHERE motorcycle_id = ? AND name = ?', [motorcycleId, part.name]);

        if (!existing) {
      // New part -> insert
      try {
        const image_path = null;
        const image_url = part.imageUrl || null;

        await db.run(
          `INSERT INTO parts (id, motorcycle_id, name, part_number, description, price, currency, image_url, image_path, url, scraped_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [partId, motorcycleId, part.name, part.partNumber || null, part.description, part.price, part.currency, image_url, image_path, pageUrl, scrapeTimestamp]
        );
        const imageResults = await syncPartImages(partId, part.imageUrls || (part.imageUrl ? [part.imageUrl] : []), downloadImages);
        console.log(`      - ${part.partNumber || 'NO_PART_NUMBER'} | ${part.name || ''}`);
        if ((imageResults || []).length > 0) {
          for (const img of imageResults) {
            const bytes = Number.isFinite(img.size) ? img.size : 0;
            console.log(`        - ${img.path} (${bytes} bytes)  - ${formatImageStatus(img.status)}`);
          }
        }
        await db.run(
          `UPDATE parts
           SET image_path = COALESCE(
                 (SELECT pi.image_path
                  FROM part_images pi
                  WHERE pi.part_id = parts.id
                    AND pi.image_url = parts.image_url
                    AND pi.image_path IS NOT NULL
                  ORDER BY pi.sort_order ASC, pi.id ASC
                  LIMIT 1),
                 image_path
               ),
               last_seen = ?,
               is_deleted = 0,
               deleted_at = NULL
           WHERE id = ?`,
          [scrapeTimestamp, partId]
        );
      } catch (err) {
        // ignore insert errors
      }
    } else {
      // Existing part -> compare values; if changed, record history and update
      try {
        const changes = {};
        if ((existing.price || 0) !== (part.price || 0)) changes.price = { old: existing.price, new: part.price };
        if ((existing.name || '') !== (part.name || '')) changes.name = { old: existing.name, new: part.name };
        if ((existing.description || '') !== (part.description || '')) changes.description = { old: existing.description, new: part.description };
        if ((existing.image_url || '') !== (part.imageUrl || '')) changes.image = { old: existing.image_url, new: part.imageUrl };
        const imageResults = await syncPartImages(existing.id, part.imageUrls || (part.imageUrl ? [part.imageUrl] : []), downloadImages);
        const imageContentChanged = (imageResults || []).some((img) => img.status === 'downloaded_updated');
        const statusChanged = Number(existing.is_deleted || 0) !== 0;
        if (Object.keys(changes).length > 0 || imageContentChanged || statusChanged) {
          const primaryImageBackup = (imageResults || []).find(
            (img) =>
              img.status === 'downloaded_updated' &&
              img.previousPath &&
              (
                (existing.image_url && img.url === existing.image_url) ||
                (existing.image_path && img.path === existing.image_path)
              )
          );
          const historyImagePath = primaryImageBackup?.previousPath || existing.image_path;

          // Insert old row into parts_history.
          const histId = generateId(`${existing.id}-${crypto.randomUUID()}`);
          await db.run(
            `INSERT INTO parts_history (id, part_id, motorcycle_id, name, part_number, description, price, currency, image_url, image_path, url, history_event, is_deleted, deleted_at, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              histId,
              existing.id,
              existing.motorcycle_id,
              existing.name,
              existing.part_number,
              existing.description,
              existing.price,
              existing.currency,
              existing.image_url,
              historyImagePath,
              existing.url,
              statusChanged ? 'restored' : 'updated',
              Number(existing.is_deleted || 0),
              existing.deleted_at || null,
              scrapeTimestamp
            ]
          );

          // Keep current image fields; syncPartImages updates local image rows.
          const image_path = existing.image_path;
          const image_url = part.imageUrl || existing.image_url;
          // Update existing row with new values.
          await db.run(
            `UPDATE parts SET name = ?, description = ?, price = ?, currency = ?, image_url = ?, image_path = ?, url = ?, scraped_at = ? WHERE id = ?`,
            [part.name, part.description, part.price, part.currency, image_url, image_path, pageUrl, scrapeTimestamp, existing.id]
          );
        }
        console.log(`      - ${part.partNumber || 'NO_PART_NUMBER'} | ${part.name || ''}`);
        if ((imageResults || []).length > 0) {
          for (const img of imageResults) {
            const bytes = Number.isFinite(img.size) ? img.size : 0;
            console.log(`        - ${img.path} (${bytes} bytes)  - ${formatImageStatus(img.status)}`);
          }
        }
        await db.run(
          `UPDATE parts
           SET image_path = COALESCE(
                 (SELECT pi.image_path
                  FROM part_images pi
                  WHERE pi.part_id = parts.id
                    AND pi.image_url = parts.image_url
                    AND pi.image_path IS NOT NULL
                  ORDER BY pi.sort_order ASC, pi.id ASC
                  LIMIT 1),
                 image_path
               ),
               last_seen = ?,
               is_deleted = 0,
               deleted_at = NULL
           WHERE id = ?`,
          [scrapeTimestamp, existing.id]
        );
      } catch (err) {
        console.error('Error updating existing part:', err.message);
      }
    }
  }

  return { count: uniqueParts.length, seenPartIds };
}

function extractBrandModel(title) {
  const cleaned = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return ['Unknown', 'Unknown'];

  const parts = cleaned.split(' ').filter(Boolean);
  const brand = toBrandCase(parts[0] || '');
  const model = parts.slice(1).join(' ').trim();

  return [brand || 'Unknown', model || 'Unknown'];
}

function resolveUrl(src, base) {
  if (!src) return null;
  try {
    if (src.startsWith('http')) return src;
    // handle protocol-relative
    if (src.startsWith('//')) return 'https:' + src;
    // relative to base
    const baseUrl = new URL(base);
    return new URL(src, baseUrl).toString();
  } catch (err) {
    // fallback: prefix with site
    return `https://www.purkuosat.net/${src.replace(/^\//, '')}`;
  }
}

function generateId(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

async function syncPartImages(partId, imageUrls, downloadImages) {
  const uniqueUrls = [...new Set((imageUrls || []).filter(Boolean))];
  const results = [];
  for (let i = 0; i < uniqueUrls.length; i++) {
    const imageUrl = uniqueUrls[i];
    let imagePath = null;
    let downloadStatus = null;
    let downloadSize = null;
    let dl = null;
    if (downloadImages) {
      dl = await downloadImage(imageUrl);
      if (dl && dl.filepath) {
        imagePath = dl.filepath;
        downloadStatus = dl.status || null;
        downloadSize = Number.isFinite(dl.size) ? dl.size : null;
      }
    }

    await db.run(
      `INSERT OR IGNORE INTO part_images (part_id, image_url, image_path, sort_order) VALUES (?, ?, ?, ?)`,
      [partId, imageUrl, imagePath, i]
    );

    if (imagePath) {
      await db.run(
        `UPDATE part_images SET image_path = ? WHERE part_id = ? AND image_url = ?`,
        [imagePath, partId, imageUrl]
      );
    }

    if (downloadStatus && imagePath) {
      results.push({
        url: imageUrl,
        path: imagePath,
        size: downloadSize,
        status: downloadStatus,
        previousPath: dl?.previous_filepath || null
      });
    }
  }
  return results;
}

async function markDeletedParts(motorcycleId, seenPartIds, scrapeTimestampInput = null) {
  const scrapeTimestamp = scrapeTimestampInput || toDbLocalTimestamp();
  const safeSeenPartIds = Array.isArray(seenPartIds) ? seenPartIds : [];
  const placeholders = safeSeenPartIds.map(() => '?').join(',');
  const params = [motorcycleId, ...safeSeenPartIds];

  const motorcycle = await db.get(
    'SELECT brand, model FROM motorcycles WHERE id = ?',
    [motorcycleId]
  );
  const deletedRows = safeSeenPartIds.length > 0
    ? await db.all(
      `
      SELECT id, name, part_number, description, price, currency, image_path, image_url, url, scraped_at, last_seen, is_deleted, deleted_at
      FROM parts
      WHERE motorcycle_id = ?
        AND id NOT IN (${placeholders})
        AND is_deleted = 0
      ORDER BY name ASC, id ASC
      `,
      params
    )
    : await db.all(
      `
      SELECT id, name, part_number, description, price, currency, image_path, image_url, url, scraped_at, last_seen, is_deleted, deleted_at
      FROM parts
      WHERE motorcycle_id = ?
        AND is_deleted = 0
      ORDER BY name ASC, id ASC
      `,
      [motorcycleId]
    );
  if (deletedRows.length === 0) return;

  const partIds = deletedRows.map((row) => row.id);
  const imgPlaceholders = partIds.map(() => '?').join(',');
  const imageRows = await db.all(
    `
    SELECT part_id, image_path, image_url
    FROM part_images
    WHERE part_id IN (${imgPlaceholders})
    ORDER BY part_id ASC, sort_order ASC, id ASC
    `,
    partIds
  );
  const imageRowsByPart = new Map();
  for (const row of imageRows) {
    if (!imageRowsByPart.has(row.part_id)) imageRowsByPart.set(row.part_id, []);
    imageRowsByPart.get(row.part_id).push(row);
  }

  const modelLabel = [motorcycle?.brand, motorcycle?.model].filter(Boolean).join(' ').trim() || motorcycleId;
  console.log(`    Marking ${deletedRows.length} unavailable part(s) for ${modelLabel}`);
  for (const row of deletedRows) {
    const histId = generateId(`${row.id}-deleted-${crypto.randomUUID()}`);
    await db.run(
      `INSERT INTO parts_history (id, part_id, motorcycle_id, name, part_number, description, price, currency, image_url, image_path, url, history_event, is_deleted, deleted_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        histId,
        row.id,
        motorcycleId,
        row.name,
        row.part_number,
        row.description || '',
        row.price,
        row.currency || 'EUR',
        row.image_url || null,
        row.image_path || null,
        row.url || null,
        'deleted',
        Number(row.is_deleted || 0),
        row.deleted_at || null,
        scrapeTimestamp
      ]
    );

    console.log(`      - ${row.part_number || row.id} | ${row.name || ''}`);
    if (row.image_path) console.log(`        - ${row.image_path}`);
    if (row.image_url) console.log(`        - ${toImagesShorthand(row.image_url)}`);
    const extraImages = imageRowsByPart.get(row.id) || [];
    for (const img of extraImages) {
      if (img?.image_path) console.log(`        - ${img.image_path}`);
      if (img?.image_url) console.log(`        - ${toImagesShorthand(img.image_url)}`);
    }
  }

  if (safeSeenPartIds.length > 0) {
    await db.run(
      `
      UPDATE parts
      SET is_deleted = 1,
          deleted_at = ?
      WHERE motorcycle_id = ?
        AND id NOT IN (${placeholders})
        AND is_deleted = 0
      `,
      [scrapeTimestamp, ...params]
    );
    return;
  }

  await db.run(
    `
    UPDATE parts
    SET is_deleted = 1,
        deleted_at = ?
    WHERE motorcycle_id = ?
      AND is_deleted = 0
    `,
    [scrapeTimestamp, motorcycleId]
  );
}
