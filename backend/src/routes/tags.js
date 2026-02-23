import express from 'express';
import { db } from '../db/database.js';

const router = express.Router();

// List all tags with counts
router.get('/', async (req, res) => {
  try {
    const tags = await db.all(`
      SELECT t.name, COUNT(pt.part_id) as count
      FROM tags t
      LEFT JOIN part_tags pt ON pt.tag_id = t.id
      GROUP BY t.id
      ORDER BY t.id ASC
    `);
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List parts by tag
router.get('/:tag', async (req, res) => {
  try {
    const tag = (req.params.tag || '').trim();
    const parts = await db.all(`
      SELECT p.*, m.brand, m.model,
             (SELECT COUNT(*) FROM parts_history ph WHERE ph.part_id = p.id) as historyCount,
             (SELECT MAX(recorded_at) FROM parts_history ph WHERE ph.part_id = p.id) as lastChangeAt
      FROM parts p
      JOIN part_tags pt ON p.id = pt.part_id
      JOIN tags t ON pt.tag_id = t.id
      JOIN motorcycles m ON p.motorcycle_id = m.id
      WHERE t.name = ?
      ORDER BY m.brand, m.model, p.name
    `, [tag]);
    res.json(parts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename a tag
router.post('/rename', async (req, res) => {
  try {
    const oldName = String(req.body?.oldName || '').trim();
    const newName = String(req.body?.newName || '').trim();
    if (!oldName || !newName) {
      return res.status(400).json({ error: 'oldName and newName required' });
    }
    if (oldName === newName) {
      return res.json({ success: true, oldName, newName });
    }

    const oldTag = await db.get('SELECT id FROM tags WHERE name = ?', [oldName]);
    if (!oldTag) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    const existingNew = await db.get('SELECT id FROM tags WHERE name = ?', [newName]);
    if (existingNew) {
      return res.status(409).json({ error: 'Tag with this name already exists' });
    }

    await db.run('UPDATE tags SET name = ? WHERE id = ?', [newName, oldTag.id]);
    return res.json({ success: true, oldName, newName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Assign a tag to a part
router.post('/assign', async (req, res) => {
  try {
    const { partId, tag } = req.body || {};
    const name = (tag || '').trim();
    if (!partId || !name) {
      return res.status(400).json({ error: 'partId and tag required' });
    }

    let tagRow = await db.get('SELECT id FROM tags WHERE name = ?', [name]);
    if (!tagRow) {
      await db.run('INSERT INTO tags (name) VALUES (?)', [name]);
      tagRow = await db.get('SELECT id FROM tags WHERE name = ?', [name]);
    }

    await db.run(
      'INSERT OR IGNORE INTO part_tags (part_id, tag_id) VALUES (?, ?)',
      [partId, tagRow.id]
    );

    res.json({ success: true, partId, tag: name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove a tag from a part
router.delete('/assign', async (req, res) => {
  try {
    const { partId, tag } = req.body || {};
    const name = (tag || '').trim();
    if (!partId || !name) {
      return res.status(400).json({ error: 'partId and tag required' });
    }

    const tagRow = await db.get('SELECT id FROM tags WHERE name = ?', [name]);
    if (tagRow) {
      await db.run('DELETE FROM part_tags WHERE part_id = ? AND tag_id = ?', [partId, tagRow.id]);
    }

    res.json({ success: true, partId, tag: name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a whole tag and all its assignments
router.delete('/:tag', async (req, res) => {
  try {
    const name = String(req.params?.tag || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'tag is required' });
    }

    const tagRow = await db.get('SELECT id FROM tags WHERE name = ?', [name]);
    if (!tagRow) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    await db.run('DELETE FROM part_tags WHERE tag_id = ?', [tagRow.id]);
    await db.run('DELETE FROM tags WHERE id = ?', [tagRow.id]);

    return res.json({ success: true, deletedTag: name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
