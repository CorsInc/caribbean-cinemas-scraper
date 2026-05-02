const puppeteer = require('puppeteer');

const BASE_URL = 'https://caribbeancinemas.com';

async function scrapeCaribbeanCinemas(theater = null) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Intercept network requests to find API calls
  let apiData = null;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    // Look for API endpoints that return movie data
    if (url.includes('/api/') || url.includes('graphql') || url.includes('.json')) {
      console.log('[API]', url);
    }
    request.continue();
  });

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('json') || url.includes('/api/')) {
      try {
        const json = await response.json();
        console.log('[JSON from]', url);
        if (json && (json.movies || json.data || json.results)) {
          apiData = json;
        }
      } catch (e) {
        // not JSON
      }
    }
  });

  console.log(`Navegando a ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait a bit more for dynamic content
  await new Promise(r => setTimeout(r, 3000));

  // Try to find movie elements
  const pageContent = await page.content();

  // Try to extract movie cards
  const movies = await page.evaluate(() => {
    const results = [];

    // Method 1: Look for common movie card patterns
    const selectors = [
      '.movie-card', '.movie-item', '.film-card', '.movie',
      '[class*="movie"]', '[class*="film"]', '[class*="pelicula"]',
      '.card', '.item', 'article',
      // Look for links that might be movie pages
      'a[href*="/movie/"]', 'a[href*="/pelicula/"]', 'a[href*="/film/"]'
    ];

    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        elements.forEach(el => {
          const title = el.querySelector('h2, h3, h4, .title, [class*="title"], [class*="name"]')?.textContent?.trim()
            || el.getAttribute('title')
            || el.getAttribute('alt')
            || '';
          const img = el.querySelector('img')?.src || '';
          const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
          const time = el.querySelector('[class*="time"], [class*="hour"], [class*="schedule"]')?.textContent?.trim() || '';

          if (title) {
            results.push({ title, img, link, time, selector: sel });
          }
        });
        if (results.length > 0) break;
      }
    }

    // Method 2: Try to get all text content and find movie titles
    if (results.length === 0) {
      const text = document.body.innerText;
      const lines = text.split('\n').filter(l => l.trim());
      // Look for common movie patterns - capitalized titles
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.length > 5 && trimmed.length < 100 &&
            /^[A-Z][a-z]+/.test(trimmed) &&
            !trimmed.includes('http') &&
            !trimmed.includes('@') &&
            !trimmed.match(/^\d/)) {
          results.push({ title: trimmed, method: 'text-extract' });
        }
      });
    }

    return results;
  });

  // Also get all the raw text for analysis
  const rawText = await page.evaluate(() => document.body.innerText);

  await browser.close();

  return {
    movies,
    rawText: rawText.substring(0, 5000),
    apiData,
    url: BASE_URL
  };
}

// Run if called directly
if (require.main === module) {
  (async () => {
    try {
      const result = await scrapeCaribbeanCinemas();
      console.log('\n========== PELÍCULAS ENCONTRADAS ==========');
      if (result.movies && result.movies.length > 0) {
        result.movies.forEach((m, i) => {
          console.log(`${i + 1}. ${m.title}`);
          if (m.time) console.log(`   Horario: ${m.time}`);
          if (m.link) console.log(`   Link: ${m.link}`);
          if (m.img) console.log(`   Imagen: ${m.img}`);
          console.log('');
        });
      } else {
        console.log('No se encontraron películas con los selectores.');
        console.log('\n--- Texto extraído (primeros 3000 chars) ---');
        console.log(result.rawText);
      }

      if (result.apiData) {
        console.log('\n--- Datos de API encontrados ---');
        console.log(JSON.stringify(result.apiData, null, 2).substring(0, 2000));
      }
    } catch (err) {
      console.error('Error:', err.message);
    }
  })();
}

module.exports = { scrapeCaribbeanCinemas };
