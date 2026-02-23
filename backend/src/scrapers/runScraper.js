import { scrapeCategoryList } from './scraper.js';
import { ensureImagesDirectory } from './imageDownloader.js';

async function main() {
  console.log('Starting web scraper...');
  await ensureImagesDirectory();
  await scrapeCategoryList();
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
