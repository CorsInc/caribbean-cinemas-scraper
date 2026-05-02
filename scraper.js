const puppeteer = require('puppeteer');

const BASE_URL = 'https://caribbeancinemas.com';

async function scrapeCaribbeanCinemas(theater = null) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  // Intercept network requests to find API calls
  let apiData = null;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
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
        if (json && (json.movies || json.data || json.results)) {
          apiData = json;
        }
      } catch (e) {
        // not JSON
      }
    }
  });

  // Navigate to the now-showing page
  const targetUrl = theater
    ? `${BASE_URL}/now-showing/?theater=${encodeURIComponent(theater)}`
    : `${BASE_URL}/now-showing/`;

  console.log(`Navegando a ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

  // Wait a bit more for dynamic content
  await new Promise(r => setTimeout(r, 5000));

  // Try to extract movie data
  const movies = await page.evaluate(() => {
    const results = [];

    // Method 1: Look for movie cards with common selectors
    const selectors = [
      '.movie-card', '.movie-item', '.film-card', '.movie',
      '[class*="movie"]', '[class*="film"]', '[class*="pelicula"]',
      '.card', '.item', 'article',
      'a[href*="/movie/"]', 'a[href*="/pelicula/"]', 'a[href*="/film/"]',
      // Specific to Caribbean Cinemas
      '.showtime-card', '.movie-poster', '.poster',
      '.film-item', '.movie-grid > div', '.movies-grid > div'
    ];

    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        elements.forEach(el => {
          const title = el.querySelector('h2, h3, h4, .title, [class*="title"], [class*="name"]')?.textContent?.trim()
            || el.getAttribute('title')
            || el.getAttribute('alt')
            || el.querySelector('img')?.getAttribute('alt')
            || '';
          const img = el.querySelector('img')?.src || '';
          const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
          const timeElements = el.querySelectorAll('[class*="time"], [class*="hour"], [class*="schedule"], [class*="showtime"]');
          const times = Array.from(timeElements).map(t => t.textContent.trim()).filter(Boolean);

          if (title) {
            results.push({ title, img, link, times, selector: sel });
          }
        });
        if (results.length > 0) break;
      }
    }

    // Method 2: Try to get all text and find structured data
    if (results.length === 0) {
      const text = document.body.innerText;
      const lines = text.split('\n').filter(l => l.trim());
      let currentMovie = null;
      
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip navigation/UI text
        if (['NOW SHOWING', 'NEW THIS WEEK', 'COMING SOON', 'THEATERS', 'Puerto Rico', 'Español',
             'English', 'VIP', 'FINE ARTS', 'GROUPS/EVENTS', 'CINEMA EVENTS', 'CINEMASCLUB',
             'Birthdays', 'Camps', 'Corporate', 'Opera', 'Ballet', 'National Theatre London',
             'MORE LOCATIONS IN THE CARIBBEAN'].includes(trimmed)) {
          continue;
        }
        // Detect movie title (all caps or title case, not a URL, not a time)
        if (trimmed.length > 3 && trimmed.length < 80 &&
            !trimmed.includes('http') && !trimmed.includes('@') &&
            !trimmed.match(/^\d/) && !trimmed.match(/^\d+:\d+/) &&
            /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/.test(trimmed)) {
          currentMovie = { title: trimmed, method: 'text-extract' };
          results.push(currentMovie);
        }
      }
    }

    return results;
  });

  // Get all raw text for analysis
  const rawText = await page.evaluate(() => document.body.innerText);

  await browser.close();

  return {
    movies,
    rawText: rawText.substring(0, 5000),
    apiData,
    url: targetUrl
  };
}

// Run if called directly
if (require.main === module) {
  (async () => {
    try {
      const theater = process.argv[2] || null;
      const result = await scrapeCaribbeanCinemas(theater);
      
      console.log('\n========== PELÍCULAS ENCONTRADAS ==========');
      if (result.movies && result.movies.length > 0) {
        result.movies.forEach((m, i) => {
          console.log(`${i + 1}. ${m.title}`);
          if (m.times && m.times.length > 0) console.log(`   Horarios: ${m.times.join(', ')}`);
          if (m.link) console.log(`   Link: ${m.link}`);
          if (m.img) console.log(`   Imagen: ${m.img}`);
          console.log('');
        });
      } else {
        console.log('No se encontraron películas con los selectores.');
        console.log('\n--- Texto extraído (primeros 3000 chars) ---');
        console.log(result.rawText?.substring(0, 3000));
      }

      if (result.apiData) {
        console.log('\n--- Datos de API encontrados ---');
        console.log(JSON.stringify(result.apiData, null, 2).substring(0, 2000));
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { scrapeCaribbeanCinemas };
