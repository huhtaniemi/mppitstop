import { scrapeMotorcyclePage } from './scraper.js';
import { ensureImagesDirectory } from './imageDownloader.js';

async function main(){
  await ensureImagesDirectory();
  const url = process.argv[2] || 'https://www.purkuosat.net/apriliamx12505.htm';
  const label = process.argv[3] || 'Aprilia 125';
  console.log('Scraping single model page', url);
  const link = { text: label, href: url, category: 'motorcycles' };
  await scrapeMotorcyclePage(link, null, { downloadImages: true });
  console.log('Single-page scrape completed');
}

main().catch(e=>{console.error(e); process.exit(1)});
