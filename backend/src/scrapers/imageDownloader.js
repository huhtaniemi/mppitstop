import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_DIR = path.join(__dirname, '../../data/images');

function parseContentLength(headers) {
  const raw = headers?.['content-length'];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function getRemoteImageSize(imageUrl) {
  try {
    const response = await axios.head(imageUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxRedirects: 5
    });
    return parseContentLength(response.headers);
  } catch (error) {
    return null;
  }
}

async function getLocalFileSize(filepath) {
  try {
    const stat = await fs.stat(filepath);
    return stat.isFile() ? stat.size : null;
  } catch (error) {
    return null;
  }
}

function getLocalImagePathFromUrl(imageUrl) {
  try {
    const u = new URL(imageUrl);
    const normalized = decodeURIComponent(u.pathname).replace(/\\/g, '/');
    const marker = '/images/';
    const idx = normalized.toLowerCase().indexOf(marker);
    const relative = idx >= 0 ? normalized.slice(idx + marker.length) : normalized.replace(/^\/+/, '');
    const safeRelative = relative
      .split('/')
      .filter(Boolean)
      .filter((seg) => seg !== '.' && seg !== '..')
      .join('/');

    if (!safeRelative) return null;
    return safeRelative;
  } catch (error) {
    return null;
  }
}

export async function downloadImage(imageUrl) {
  try {
    const relative = getLocalImagePathFromUrl(imageUrl);
    if (!relative) {
      throw new Error(`Unable to derive local path from URL: ${imageUrl}`);
    }

    // Ensure images directory exists
    try {
      await fs.mkdir(IMAGES_DIR, { recursive: true });
    } catch (err) {
      // Directory might already exist
    }

    const filepath = path.join(IMAGES_DIR, relative);
    const dir = path.dirname(filepath);
    await fs.mkdir(dir, { recursive: true });

    const [localSize, remoteSize] = await Promise.all([
      getLocalFileSize(filepath),
      getRemoteImageSize(imageUrl)
    ]);

    if (localSize !== null && remoteSize !== null && localSize === remoteSize) {
      const displayPath = `images/${relative.replace(/\\/g, '/')}`;
      return {
        filename: path.basename(relative),
        filepath: displayPath,
        size: localSize,
        status: 'skipped_unchanged'
      };
    }

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (localSize !== null && localSize === response.data.length) {
      const displayPath = `images/${relative.replace(/\\/g, '/')}`;
      return {
        filename: path.basename(relative),
        filepath: displayPath,
        size: localSize,
        status: 'skipped_unchanged'
      };
    }

    let previousFilepath = null;
    if (localSize !== null) {
      const parsed = path.parse(relative);
      const historyRelative = path.join(
        '_history',
        parsed.dir,
        `${parsed.name}__${Date.now()}${parsed.ext}`
      );
      const historyAbs = path.join(IMAGES_DIR, historyRelative);
      await fs.mkdir(path.dirname(historyAbs), { recursive: true });
      await fs.copyFile(filepath, historyAbs);
      previousFilepath = `images/${historyRelative.replace(/\\/g, '/')}`;
    }

    await fs.writeFile(filepath, response.data);
    const displayPath = `images/${relative.replace(/\\/g, '/')}`;

    return {
      filename: path.basename(relative),
      filepath: displayPath,
      size: response.data.length,
      status: localSize === null ? 'downloaded_new' : 'downloaded_updated',
      previous_filepath: previousFilepath
    };

  } catch (error) {
    console.error(`Failed to download image from ${imageUrl}:`, error.message);
    return null;
  }
}

export async function ensureImagesDirectory() {
  try {
    await fs.mkdir(IMAGES_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating images directory:', error);
  }
}
