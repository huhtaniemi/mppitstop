import axios from 'axios';
import * as cheerio from 'cheerio';

async function main() {
  const url = 'https://www.purkuosat.net/apriliamx12505.htm';
  console.log('Fetching', url);
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $ = cheerio.load(res.data);

  $('table').slice(0,3).each((ti, table) => {
    console.log('--- Table', ti, '---');
    const rows = $(table).find('tr').toArray();
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const row = rows[i];
      console.log('Row', i, $(row).html().slice(0,200).replace(/\n/g,' '));
      const imgs = $(row).find('img').toArray();
      console.log(' imgs count', imgs.length);
      if (imgs.length>0) console.log(' img src', $(imgs[0]).attr('src'), 'parent href', $(row).find('a').attr('href'));
    }
  });
}

main().catch(e=>{console.error(e); process.exit(1)});
