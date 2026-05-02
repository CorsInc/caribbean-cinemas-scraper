const puppeteer = require('puppeteer');

const BASE_URL = 'https://caribbeancinemas.com';

// Known theater slugs for Plaza Guaynabo and others
const THEATER_SLUGS = {
  'plaza guaynabo': 'plaza-guaynabo',
  'plaza las americas': 'plaza-las-americas',
  'plaza del sol': 'plaza-del-sol',
  'plaza carolina': 'plaza-carolina',
  'plaza escorial': 'plaza-escorial',
  'montehiedra': 'montehiedra',
  'las catalinas': 'las-catalinas',
  'plaza del caribe': 'plaza-del-caribe',
  'fine arts miramar': 'fine-arts-miramar',
  'fine arts popular': 'fine-arts-popular',
};

async function scrapeCaribbeanCinemas(theater = null) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  // Collect API responses
  const apiResponses = [];
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    // Allow all requests but log API calls
    if (url.includes('/api/') || url.includes('graphql') || 
        url.includes('wp-json') || url.includes('rest') ||
        url.includes('.json')) {
      console.log('[API Request]', url);
    }
    request.continue();
  });

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('json') || url.includes('/api/') || url.includes('wp-json')) {
      try {
        const text = await response.text();
        // Try to parse as JSON
        try {
          const json = JSON.parse(text);
          apiResponses.push({ url, data: json });
          console.log('[API Response]', url, '- keys:', Object.keys(json));
        } catch {
          // Store raw text if it looks like structured data
          if (text.length < 100000) {
            apiResponses.push({ url, text: text.substring(0, 500) });
          }
        }
      } catch (e) {
        // ignore
      }
    }
  });

  // Build URL - try to find a theater-specific page
  let targetUrl = `${BASE_URL}/now-showing/`;
  if (theater) {
    const normalized = theater.toLowerCase().trim();
    // Try common URL patterns
    const slug = THEATER_SLUGS[normalized] || normalized.replace(/\s+/g, '-').toLowerCase();
    targetUrl = `${BASE_URL}/now-showing/?theater=${encodeURIComponent(slug)}`;
  }

  console.log(`[scraper] Navegando a: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for dynamic content to render
  await new Promise(r => setTimeout(r, 5000));

  // Try to find movie data in the page
  const movies = await page.evaluate((theaterFilter) => {
    const results = [];

    // Helper to clean text
    const clean = (t) => t?.replace(/\s+/g, ' ').trim() || '';

    // Method 1: Common movie card selectors
    const selectors = [
      '.movie-card', '.movie-item', '.film-card',
      '[class*="movie"]', '[class*="film"]', '[class*="pelicula"]',
      '.card', 'article',
      'a[href*="/movie/"]', 'a[href*="/pelicula/"]',
      '.showtime-card', '.movie-poster', '.poster',
      '.film-item', '.movie-grid > div', '.movies-grid > div',
      // Caribbean Cinemas specific
      '.movie-list-item', '.movie-tile', '.movie-entry',
      '.showing-item', '.film-entry', '.schedule-item'
    ];

    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        elements.forEach(el => {
          const title = clean(el.querySelector('h2, h3, h4, .title, [class*="title"], [class*="name"]')?.textContent)
            || el.getAttribute('title')
            || el.getAttribute('alt')
            || clean(el.querySelector('img')?.getAttribute('alt'))
            || '';

          if (!title || title.length < 2) return;

          const img = el.querySelector('img')?.src || '';
          const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
          
          // Get showtimes
          const timeEls = el.querySelectorAll('[class*="time"], [class*="hour"], [class*="schedule"], [class*="showtime"], [class*="hora"]');
          const times = Array.from(timeEls).map(t => clean(t.textContent)).filter(Boolean);

          // Get rating/format (2D, 3D, IMAX, etc)
          const format = clean(el.querySelector('[class*="format"], [class*="badge"], [class*="tag"]')?.textContent);

          results.push({
            title,
            img,
            link,
            times,
            format: format || '2D',
            selector: sel
          });
        });
        if (results.length > 0) break;
      }
    }

    // Method 2: If no cards found, try to extract from raw text
    if (results.length === 0) {
      const text = document.body.innerText;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      
      // Known movie titles to look for (common ones)
      const knownMovies = [
        'THUNDERBOLTS', 'HOW TO TRAIN YOUR DRAGON', 'MISSION IMPOSSIBLE',
        'AVENGERS', 'SUPERMAN', 'THE FANTASTIC FOUR', 'JURASSIC WORLD',
        'INSIDE OUT', 'MOANA', 'WICKED', 'DEADPOOL', 'CAPTAIN AMERICA',
        'SPIDER-MAN', 'DUNE', 'THE BATMAN', 'OPPENHEIMER', 'BARBIE',
        'THE SUPER MARIO BROS', 'KUNG FU PANDA', 'DESPICABLE ME',
        'MINIONS', 'TRANSFORMERS', 'FAST X', 'AQUAMAN', 'WONKA',
        'THE COLOR PURPLE', 'THE BOY AND THE HERON', 'GODZILLA',
        'KINGDOM OF THE PLANET OF THE APES', 'FURIOSA', 'TWISTERS',
        'ALIEN', 'BEETLEJUICE', 'GLADIATOR', 'SONIC', 'MUFASA',
        'LION KING', 'SNOW WHITE', 'ELIO', 'Zootopia', 'TOY STORY',
        'INCREDIBLES', 'COCO', 'ENCANTO', 'TROLLS', 'PAW PATROL',
        'BLUEY', 'GARFIELD', 'THE GARFIELD MOVIE'
      ];

      for (const line of lines) {
        // Skip navigation
        if (['NOW SHOWING', 'NEW THIS WEEK', 'COMING SOON', 'THEATERS',
             'Puerto Rico', 'Español', 'English', 'VIP', 'FINE ARTS',
             'GROUPS/EVENTS', 'CINEMA EVENTS', 'CINEMASCLUB',
             'MORE LOCATIONS IN THE CARIBBEAN'].includes(line)) continue;
        
        // Check if line looks like a movie title
        const upper = line.toUpperCase();
        const match = knownMovies.find(m => upper.includes(m));
        if (match && !results.find(r => r.title.toUpperCase().includes(match))) {
          results.push({ title: line, method: 'text-match', match });
        }
      }
    }

    return results;
  }, theater);

  // Get all raw text
  const rawText = await page.evaluate(() => document.body.innerText);

  await browser.close();

  return {
    movies,
    rawText: rawText.substring(0, 8000),
    apiResponses,
    url: targetUrl,
    theater
  };
}

// Run if called directly
if (require.main === module) {
  (async () => {
    try {
      const theater = process.argv[2] || null;
      console.log(`[scraper] Iniciando scrape${theater ? ` para: ${theater}` : ' (todos los cines)'}`);
      
      const result = await scrapeCaribbeanCinemas(theater);
      
      console.log('\n========== PELÍCULAS ENCONTRADAS ==========');
      if (result.movies && result.movies.length > 0) {
        result.movies.forEach((m, i) => {
          console.log(`${i + 1}. ${m.title}`);
          if (m.times && m.times.length > 0) console.log(`   Horarios: ${m.times.join(', ')}`);
          if (m.format) console.log(`   Formato: ${m.format}`);
          if (m.link) console.log(`   Link: ${m.link}`);
          console.log('');
        });
      } else {
        console.log('No se encontraron películas.');
        console.log('\n--- Texto extraído ---');
        console.log(result.rawText?.substring(0, 3000));
      }

      if (result.apiResponses && result.apiResponses.length > 0) {
        console.log('\n--- APIs detectadas ---');
        result.apiResponses.forEach(r => {
          console.log(`URL: ${r.url}`);
          if (r.data) console.log(`Data keys: ${Object.keys(r.data).join(', ')}`);
          console.log('');
        });
      }
    } catch (err) {
      console.error('Error:', err.message);
      console.error(err.stack);
      process.exit(1);
    }
  })();
}

module.exports = { scrapeCaribbeanCinemas };
