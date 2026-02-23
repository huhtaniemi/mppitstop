import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../../data/database.sqlite');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.all('SELECT id, name, part_number, image_url, image_path, url FROM parts LIMIT 20', (err, rows) => {
    if (err) {
      console.error('Query error:', err.message);
      process.exit(1);
    }
    console.log('Sample parts:');
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }
    db.close();
  });
});
