import { ensureImagesDirectory, downloadImage } from './imageDownloader.js';

async function main(){
  await ensureImagesDirectory();
  const url = 'https://www.purkuosat.net/images/MX12505/pikkukuvat/DSCN3304_small.JPG';
  console.log('Downloading test image', url);
  const dl = await downloadImage(url, 'test-part');
  console.log('Result:', dl);
}

main().catch(e=>{console.error(e); process.exit(1)});
