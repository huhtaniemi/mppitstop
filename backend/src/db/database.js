import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../../data/database.sqlite');

export class Database {
  constructor() {
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database at:', dbPath);
        this.initializeTables();
      }
    });
  }

  initializeTables() {
    this.db.serialize(() => {
      // Motorcycles table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS motorcycles (
          id TEXT PRIMARY KEY,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          category TEXT NOT NULL,
          url TEXT NOT NULL,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Parts table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS parts (
          id TEXT PRIMARY KEY,
          motorcycle_id TEXT NOT NULL,
          name TEXT NOT NULL,
          part_number TEXT NOT NULL,
          description TEXT,
          price REAL,
          currency TEXT DEFAULT 'EUR',
          condition TEXT,
          image_url TEXT,
          image_path TEXT,
          url TEXT NOT NULL,
          scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen DATETIME,
          is_deleted INTEGER DEFAULT 0,
          deleted_at DATETIME,
          FOREIGN KEY (motorcycle_id) REFERENCES motorcycles(id)
        )
      `);

      // Parts history - stores previous versions of parts when updated
      this.db.run(`
        CREATE TABLE IF NOT EXISTS parts_history (
          id TEXT PRIMARY KEY,
          part_id TEXT NOT NULL,
          motorcycle_id TEXT NOT NULL,
          name TEXT NOT NULL,
          part_number TEXT NOT NULL,
          description TEXT,
          price REAL,
          currency TEXT DEFAULT 'EUR',
          image_url TEXT,
          image_path TEXT,
          url TEXT NOT NULL,
          history_event TEXT DEFAULT 'updated',
          is_deleted INTEGER DEFAULT 0,
          deleted_at DATETIME,
          recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (part_id) REFERENCES parts(id)
        )
      `);

      // Selections table - stores user selections
      this.db.run(`
        CREATE TABLE IF NOT EXISTS selections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          part_id TEXT NOT NULL,
          selected BOOLEAN DEFAULT 1,
          selected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (part_id) REFERENCES parts(id)
        )
      `);

      // Tags for collections
      this.db.run(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS part_tags (
          part_id TEXT NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (part_id, tag_id),
          FOREIGN KEY (part_id) REFERENCES parts(id),
          FOREIGN KEY (tag_id) REFERENCES tags(id)
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS part_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          part_id TEXT NOT NULL,
          image_url TEXT NOT NULL,
          image_path TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(part_id, image_url),
          FOREIGN KEY (part_id) REFERENCES parts(id)
        )
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_selections_part_id ON selections(part_id)
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_part_tags_part_id ON part_tags(part_id)
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_part_tags_tag_id ON part_tags(tag_id)
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_part_images_part_id ON part_images(part_id)
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_parts_motorcycle ON parts(motorcycle_id)
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_motorcycles_brand ON motorcycles(brand)
      `);

      // Migrations for older DBs
      this.db.run(`ALTER TABLE parts ADD COLUMN last_seen DATETIME`, () => {});
      this.db.run(`ALTER TABLE parts ADD COLUMN is_deleted INTEGER DEFAULT 0`, () => {});
      this.db.run(`ALTER TABLE parts ADD COLUMN deleted_at DATETIME`, () => {});
      this.db.run(`ALTER TABLE parts_history ADD COLUMN is_deleted INTEGER DEFAULT 0`, () => {});
      this.db.run(`ALTER TABLE parts_history ADD COLUMN deleted_at DATETIME`, () => {});
      this.db.run(`ALTER TABLE parts_history ADD COLUMN history_event TEXT DEFAULT 'updated'`, () => {});
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export const db = new Database();















































































































