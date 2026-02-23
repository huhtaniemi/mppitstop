import express from 'express';
import { db } from '../db/database.js';
import { scrapeCategoryList, scrapeMotorcyclePage } from '../scrapers/scraper.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let scrapeJob = { running: false, controller: null, startedAt: null };

function normalizeLoose(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toSafeImageAbs(imagePath) {
  const rel = String(imagePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel.startsWith('images/')) return null;
  const abs = path.join(__dirname, '../../data', rel);
  const root = path.join(__dirname, '../../data/images');
  if (!abs.startsWith(root)) return null;
  return abs;
}

// Global parts feed for main page
router.get('/parts-feed-all', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        p.*,
        m.brand,
        m.model,
        m.category,
        GROUP_CONCAT(t.name, ',') as tags,
        (SELECT COUNT(*) FROM parts_history ph WHERE ph.part_id = p.id) as historyCount,
        (SELECT MAX(recorded_at) FROM parts_history ph WHERE ph.part_id = p.id) as lastChangeAt
      FROM parts p
      JOIN motorcycles m ON p.motorcycle_id = m.id
      LEFT JOIN part_tags pt ON p.id = pt.part_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      GROUP BY p.id
      ORDER BY m.brand ASC, m.model ASC, p.name ASC, p.id ASC
    `);
    const timestampOf = (row) => {
      const raw = row?.scraped_at || row?.last_seen || row?.lastChangeAt || row?.deleted_at || '';
      const ms = Date.parse(raw);
      return Number.isFinite(ms) ? ms : 0;
    };
    const keyOf = (row) => [
      String(row?.brand || '').trim().toLowerCase(),
      String(row?.model || '').trim().toLowerCase(),
      String(row?.part_number || '').trim().toLowerCase(),
      String(row?.name || '').trim().toLowerCase()
    ].join('||');

    const deduped = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      const prev = deduped.get(key);
      if (!prev || timestampOf(row) >= timestampOf(prev)) {
        deduped.set(key, row);
      }
    }

    res.json(Array.from(deduped.values()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all images for a part (current + additional)
router.get('/part/:partId/images', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT image_url, image_path, sort_order
       FROM part_images
       WHERE part_id = ?
       ORDER BY (image_path IS NULL) ASC, sort_order ASC, id ASC`,
      [req.params.partId]
    );

    const localRows = rows.filter((r) => r.image_path && String(r.image_path).trim() !== '');
    if (localRows.length > 0) {
      return res.json(localRows);
    }

    // Backward-compatible fallback for parts scraped before part_images existed.
    const part = await db.get('SELECT image_path FROM parts WHERE id = ?', [req.params.partId]);
    if (!part) return res.status(404).json({ error: 'Part not found' });
    return res.json(part.image_path ? [{ image_path: part.image_path, sort_order: 0 }] : []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger web scraper to update data
router.post('/scrape', async (req, res) => {
  try {
    if (scrapeJob.running) {
      scrapeJob.controller?.abort();
      scrapeJob = { running: false, controller: null, startedAt: null };
      return res.json({ status: 'aborted', running: false });
    }

    // Accept optional brand filter in body { brands: ['Aprilia','Cagiva'] }
    const allowedBrands = Array.isArray(req.body?.brands) ? req.body.brands : null;
    const requestedMaxLinks = Number.parseInt(req.body?.maxLinks, 10);
    const hasMaxLinks = Number.isInteger(requestedMaxLinks) && requestedMaxLinks > 0;
    const testMode = req.body?.testMode === true;
    const maxLinksPerCategory = hasMaxLinks ? requestedMaxLinks : (testMode ? 1 : null);
    const downloadImages = req.body?.downloadImages === false ? false : !testMode;
    const modelUrl = typeof req.body?.modelUrl === 'string' ? req.body.modelUrl.trim() : '';
    const modelText = typeof req.body?.modelText === 'string' ? req.body.modelText.trim() : '';
    const controller = new AbortController();
    scrapeJob = { running: true, controller, startedAt: new Date().toISOString() };

    res.json({
      status: 'scraping',
      running: true
    });

    // Run scraper in background without blocking response
    if (modelUrl) {
      const link = {
        text: modelText || modelUrl,
        href: modelUrl,
        category: 'motorcycles'
      };
      scrapeMotorcyclePage(link, allowedBrands, {
        downloadImages,
        signal: controller.signal,
        scrapeStartedAt: scrapeJob.startedAt
      }).catch(err => {
        console.error('Background single-model scraper error:', err);
      }).finally(() => {
        scrapeJob = { running: false, controller: null, startedAt: null };
      });
    } else {
      scrapeCategoryList(allowedBrands, {
        maxLinksPerCategory,
        downloadImages,
        signal: controller.signal,
        scrapeStartedAt: scrapeJob.startedAt
      }).catch(err => {
        console.error('Background scraper error:', err);
      }).finally(() => {
        scrapeJob = { running: false, controller: null, startedAt: null };
      });
    }
  } catch (error) {
    scrapeJob = { running: false, controller: null, startedAt: null };
    res.status(500).json({ error: error.message });
  }
});

router.get('/scrape-status', (req, res) => {
  res.json({
    running: scrapeJob.running,
    startedAt: scrapeJob.startedAt
  });
});

// Global history of scraper-detected updates, grouped client-side by recorded_at
router.get('/changes-history', async (req, res) => {
  try {
    const requested = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 5000) : 1000;
    const partId = typeof req.query?.partId === 'string' ? req.query.partId.trim() : '';
    const whereSql = partId ? 'WHERE ph.part_id = ?' : '';
    const params = partId ? [partId, limit] : [limit];
    const rows = await db.all(
      `
      SELECT
        ph.id AS history_id,
        ph.part_id,
        ph.recorded_at,
        ph.history_event,
        ph.motorcycle_id,
        m.brand,
        m.model,
        ph.part_number AS old_part_number,
        ph.name AS old_name,
        ph.description AS old_description,
        ph.price AS old_price,
        ph.currency AS old_currency,
        ph.image_url AS old_image_url,
        ph.image_path AS old_image_path,
        ph.is_deleted AS old_is_deleted,
        ph.deleted_at AS old_deleted_at,
        p.part_number AS current_part_number,
        p.name AS current_name,
        p.description AS current_description,
        p.price AS current_price,
        p.currency AS current_currency,
        p.image_url AS current_image_url,
        p.image_path AS current_image_path,
        p.is_deleted AS current_is_deleted,
        p.deleted_at AS current_deleted_at,
        p.scraped_at AS current_scraped_at
      FROM parts_history ph
      JOIN motorcycles m ON m.id = ph.motorcycle_id
      LEFT JOIN parts p ON p.id = ph.part_id
      ${whereSql}
      ORDER BY ph.recorded_at DESC, ph.id DESC
      LIMIT ?
      `,
      params
    );

    const stateAfterByPart = new Map();
    const out = rows.map((row) => {
      const changedFields = [];
      const str = (v) => String(v ?? '');
      const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
      const partKey = row.part_id;
      const stateAfter = stateAfterByPart.get(partKey) || {
        part_number: row.current_part_number,
        name: row.current_name,
        description: row.current_description,
        price: row.current_price,
        currency: row.current_currency,
        image_url: row.current_image_url,
        image_path: row.current_image_path,
        is_deleted: row.current_is_deleted
      };

      if (row.history_event === 'deleted' || row.history_event === 'restored') {
        changedFields.push('availability');
      } else if (stateAfter?.name == null) {
        changedFields.push('part_removed');
      } else {
        if (str(row.old_part_number) !== str(stateAfter.part_number)) changedFields.push('part_number');
        if (str(row.old_name) !== str(stateAfter.name)) changedFields.push('name');
        if (str(row.old_description) !== str(stateAfter.description)) changedFields.push('description');
        if (num(row.old_price) !== num(stateAfter.price) || str(row.old_currency) !== str(stateAfter.currency)) {
          changedFields.push('price');
        }
        if (str(row.old_image_url) !== str(stateAfter.image_url) || str(row.old_image_path) !== str(stateAfter.image_path)) {
          changedFields.push('image');
        }
      }

      stateAfterByPart.set(partKey, {
        part_number: row.old_part_number,
        name: row.old_name,
        description: row.old_description,
        price: row.old_price,
        currency: row.old_currency,
        image_url: row.old_image_url,
        image_path: row.old_image_path,
        is_deleted: row.old_is_deleted
      });

      return {
        history_id: row.history_id,
        part_id: row.part_id,
        recorded_at: row.recorded_at,
        history_event: row.history_event,
        brand: row.brand,
        model: row.model,
        old_part_number: row.old_part_number,
        old_name: row.old_name,
        old_description: row.old_description,
        old_price: row.old_price,
        old_currency: row.old_currency,
        old_image_url: row.old_image_url,
        old_image_path: row.old_image_path,
        old_is_deleted: row.old_is_deleted,
        old_deleted_at: row.old_deleted_at,
        current_part_number: row.current_part_number,
        current_name: row.current_name,
        current_description: row.current_description,
        current_price: row.current_price,
        current_currency: row.current_currency,
        current_image_url: row.current_image_url,
        current_image_path: row.current_image_path,
        current_is_deleted: row.current_is_deleted,
        current_deleted_at: row.current_deleted_at,
        current_scraped_at: row.current_scraped_at,
        changed_fields: changedFields
      };
    });

    res.json(out.filter((r) => (r.changed_fields || []).length > 0));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get scrape stats
router.get('/stats', async (req, res) => {
  try {
    const motorcycleCount = await db.get('SELECT COUNT(*) as count FROM motorcycles');
    const partCount = await db.get('SELECT COUNT(*) as count FROM parts');
    const brandCount = await db.get('SELECT COUNT(DISTINCT brand) as count FROM motorcycles');
    const selectionCount = await db.get('SELECT COUNT(*) as count FROM selections');

    res.json({
      motorcycles: motorcycleCount.count || 0,
      parts: partCount.count || 0,
      brands: brandCount.count || 0,
      selectedParts: selectionCount.count || 0,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear stored motorcycles, parts, selections, history and images
router.post('/clear', async (req, res) => {
  try {
    // Optional body { keepImages: true }
    const keepImages = req.body?.keepImages === true;

    await db.run('DELETE FROM selections');
    await db.run('DELETE FROM part_tags');
    await db.run('DELETE FROM tags');
    await db.run('DELETE FROM part_images');
    await db.run('DELETE FROM parts_history');
    await db.run('DELETE FROM parts');
    await db.run('DELETE FROM motorcycles');

    if (!keepImages) {
      // remove all local image copies (including nested source-style folders)
      const imagesDir = path.join(__dirname, '../../data/images');
      try {
        await fs.rm(imagesDir, { recursive: true, force: true });
        await fs.mkdir(imagesDir, { recursive: true });
      } catch (err) {
        // ignore if dir missing
      }
    }

    res.json({ status: 'cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove one targeted model and related data
router.post('/remove-model', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ error: 'query is required' });

    const queryNorm = normalizeLoose(query);
    if (!queryNorm) return res.status(400).json({ error: 'query must contain letters/numbers' });

    const allModels = await db.all(
      'SELECT id, brand, model FROM motorcycles ORDER BY brand ASC, model ASC'
    );

    const matched = allModels.filter((m) => {
      const combined = normalizeLoose(`${m.brand} ${m.model}`);
      return combined.includes(queryNorm) || queryNorm.includes(combined);
    });

    if (matched.length === 0) {
      return res.status(404).json({ error: 'No model matched query', query });
    }

    const matchedLabels = matched.map((m) => `${m.brand} ${m.model}`.trim());
    const uniqueLabels = [...new Set(matchedLabels)];
    console.log('\nRemove-model request:');
    uniqueLabels.forEach((label) => {
      console.log(`  - ${label}`);
    });

    const motorcycleIds = matched.map((m) => m.id);
    const modelLabelById = new Map(matched.map((m) => [m.id, `${m.brand} ${m.model}`.trim()]));
    const placeholders = motorcycleIds.map(() => '?').join(',');

    const partRows = await db.all(
      `SELECT id, motorcycle_id, name, part_number, image_path
       FROM parts
       WHERE motorcycle_id IN (${placeholders})`,
      motorcycleIds
    );
    const partIds = partRows.map((p) => p.id);
    const imagePaths = new Set();
    for (const p of partRows) {
      if (p?.image_path) imagePaths.add(p.image_path);
    }

    if (partIds.length > 0) {
      const partPlaceholders = partIds.map(() => '?').join(',');
      const extraImageRows = await db.all(
        `SELECT part_id, image_path
         FROM part_images
         WHERE part_id IN (${partPlaceholders})`,
        partIds
      );
      const imageRowsByPart = new Map();
      for (const row of extraImageRows) {
        if (!imageRowsByPart.has(row.part_id)) imageRowsByPart.set(row.part_id, []);
        imageRowsByPart.get(row.part_id).push(row);
        if (row?.image_path) imagePaths.add(row.image_path);
      }

      console.log(`  Removing ${partRows.length} part(s) across ${motorcycleIds.length} model(s):`);
      const partsByModel = new Map();
      for (const p of partRows) {
        const key = p.motorcycle_id;
        if (!partsByModel.has(key)) partsByModel.set(key, []);
        partsByModel.get(key).push(p);
      }
      for (const modelId of motorcycleIds) {
        const rows = partsByModel.get(modelId) || [];
        if (rows.length === 0) continue;
        const label = modelLabelById.get(modelId) || modelId;
        console.log(`  ${label}: ${rows.length} part(s)`);
        for (const p of rows) {
          console.log(`    - ${p.part_number || p.id} | ${p.name || ''}`);
          const perPartImages = new Set();
          if (p.image_path) perPartImages.add(p.image_path);
          const extraRows = imageRowsByPart.get(p.id) || [];
          for (const img of extraRows) {
            if (img?.image_path) perPartImages.add(img.image_path);
          }
          Array.from(perPartImages).forEach((imgPath) => {
            console.log(`      - ${imgPath}`);
          });
        }
      }

      await db.run(`DELETE FROM selections WHERE part_id IN (${partPlaceholders})`, partIds);
      await db.run(`DELETE FROM part_tags WHERE part_id IN (${partPlaceholders})`, partIds);
      await db.run(`DELETE FROM part_images WHERE part_id IN (${partPlaceholders})`, partIds);
      await db.run(`DELETE FROM parts_history WHERE part_id IN (${partPlaceholders})`, partIds);
      await db.run(`DELETE FROM parts WHERE id IN (${partPlaceholders})`, partIds);
    }

    await db.run(`DELETE FROM motorcycles WHERE id IN (${placeholders})`, motorcycleIds);
    for (const imagePath of imagePaths) {
      const abs = toSafeImageAbs(imagePath);
      if (!abs) continue;
      try {
        await fs.rm(abs, { force: true });
      } catch (err) {
        // ignore missing files
      }
    }

    console.log(`Remove-model done: ${matched.length} model(s), ${partIds.length} part(s)\n`);

    return res.json({
      removed: {
        motorcycles: matched.length,
        parts: partIds.length
      },
      matches: matched.map((m) => ({ brand: m.brand, model: m.model }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get part history
router.get('/part/:partId/history', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM parts_history WHERE part_id = ? ORDER BY recorded_at DESC`, [req.params.partId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
