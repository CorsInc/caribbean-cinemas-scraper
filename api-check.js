// Lightweight script to probe Caribbean Cinemas API endpoints
// Uses native https module - no Puppeteer needed
const https = require('https');
const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        resolve({
          status: res.statusCode,
          contentType: ct,
          data: ct.includes('json') ? tryParse(data) : data.substring(0, 2000),
          headers: res.headers
        });
      });
    }).on('error', reject);
  });
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return str.substring(0, 2000); }
}

const ENDPOINTS = [
  // WordPress REST API
  'https://caribbeancinemas.com/wp-json/wp/v2/posts?per_page=5',
  'https://caribbeancinemas.com/wp-json/wp/v2/pages?per_page=5',
  'https://caribbeancinemas.com/wp-json/wp/v2/movie?per_page=20',
  'https://caribbeancinemas.com/wp-json/',
  // Common API patterns
  'https://caribbeancinemas.com/api/movies',
  'https://caribbeancinemas.com/api/showtimes',
  'https://caribbeancinemas.com/api/showtimes?theater=plaza-guaynabo',
  // Custom post types
  'https://caribbeancinemas.com/wp-json/custom/v1/showings',
  'https://caribbeancinemas.com/wp-json/cinema/v1/showtimes',
  // Try the movie post type
  'https://caribbeancinemas.com/wp-json/wp/v2/movies',
  'https://caribbeancinemas.com/wp-json/wp/v2/showtime',
  'https://caribbeancinemas.com/wp-json/wp/v2/showtimes',
];

(async () => {
  console.log('=== Probando endpoints API de Caribbean Cinemas ===\n');
  
  for (const url of ENDPOINTS) {
    try {
      const result = await fetch(url);
      const statusIcon = result.status === 200 ? '✅' : result.status === 404 ? '❌' : '⚠️';
      console.log(`${statusIcon} [${result.status}] ${url}`);
      if (result.status === 200 && typeof result.data === 'object') {
        const data = result.data;
        if (Array.isArray(data)) {
          console.log(`   → Array con ${data.length} items`);
          if (data.length > 0) console.log(`   → Primer item keys: ${Object.keys(data[0]).join(', ')}`);
        } else {
          console.log(`   → Object keys: ${Object.keys(data).join(', ')}`);
        }
        console.log('');
      } else if (result.status === 200) {
        console.log(`   → ${String(result.data).substring(0, 300)}`);
        console.log('');
      }
    } catch (err) {
      console.log(`💥 Error: ${url} - ${err.message}`);
    }
  }

  // Also try the main page to see what JS files are loaded
  console.log('\n=== Analizando página principal ===');
  try {
    const main = await fetch('https://caribbeancinemas.com/now-showing/');
    if (main.status === 200) {
      const html = typeof main.data === 'string' ? main.data : JSON.stringify(main.data);
      // Find script tags with src
      const scripts = html.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/g) || [];
      console.log(`Scripts encontrados: ${scripts.length}`);
      scripts.slice(0, 20).forEach(s => {
        const src = s.match(/src=["']([^"']+)["']/);
        if (src) console.log(`  - ${src[1]}`);
      });
      
      // Find API endpoints in the HTML
      const apiUrls = html.match(/https?:\/\/[^"'\s]*\/api\/[^"'\s]*/g) || [];
      const wpUrls = html.match(/https?:\/\/[^"'\s]*\/wp-json\/[^"'\s]*/g) || [];
      console.log(`\nAPIs encontradas en HTML:`);
      [...new Set([...apiUrls, ...wpUrls])].forEach(u => console.log(`  - ${u}`));
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
})();
