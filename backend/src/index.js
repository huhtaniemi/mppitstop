import express from 'express';
import cors from 'cors';
import { db } from './db/database.js';
import motorcyclesRouter from './routes/motorcycles.js';
import tagsRouter from './routes/tags.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve images statically
app.use('/images', express.static(path.join(__dirname, '../data/images')));

// Routes
app.use('/api/motorcycles', motorcyclesRouter);
app.use('/api/tags', tagsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  GET  /api/motorcycles/parts-feed-all`);
  console.log(`  POST /api/motorcycles/scrape`);
  console.log(`  GET  /api/motorcycles/scrape-status`);
  console.log(`  POST /api/motorcycles/remove-model`);
  console.log(`  POST /api/motorcycles/clear`);
  console.log(`  GET  /api/tags`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await db.close();
  process.exit(0);
});

