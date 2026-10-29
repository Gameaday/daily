#!/usr/bin/env node
// local-test.mjs - Local development server for server-first games
// Server runs on http://localhost:3000
// 
// Client code connects to this server for puzzle generation,
// answer checking, and result storage.
//
// Usage: node local-test.mjs
// 
// In game scripts, set baseUrl to: http://localhost:3000/api
// Then call: SHELL.fetchPuzzle(game, day, baseUrl)

// Server configuration
const PORT = 3000;

// Available games and their boot configuration
const GAMES = {
  trace: { fetch: 'SHELL.fetchPuzzle("trace", dayIndex)' },
  recycleGrid: { fetch: 'SHELL.fetchPuzzle("recycle-grid", dayIndex)' },
  recycleRings: { fetch: 'SHELL.fetchPuzzle("recycle-rings", dayIndex)' },
  sift: { fetch: 'SHELL.fetchPuzzle("sift", dayIndex)' },
  sprint: { fetch: 'SHELL.fetchPuzzle("sprint", dayIndex)' },
  museum: { fetch: 'SHELL.fetchPuzzle("museum", dayIndex)' }
};

// Server configuration
console.log(`Server will run on http://localhost:${PORT}`);
console.log('Available games:', Object.keys(GAMES).join(', '));

// Load puzzle data from puzzles.json if available
let puzzlesData = null;
try {
  const data = fs.readFileSync(path.join(__dirname, 'puzzles.json'), 'utf8');
  puzzlesData = JSON.parse(data);
  console.log('Loaded puzzle data from puzzles.json');
} catch (e) {
  console.log('No puzzles.json found - will generate puzzles on demand');
}

// HTTP server setup
const http = require('http');

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

function handleApiRoute(res, pathname, query) {
  if (pathname === '/api/puzzle') {
    const day = query.day || '1';
    const game = query.game || 'trace';

    if (puzzlesData && puzzlesData[game] && puzzlesData[game][day]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.json(puzzlesData[game][day]);
    } else {
      const dayNum = parseInt(day);
      const puzzle = {
        game,
        day: dayNum,
        puzzleNo: dayNum,
        board: Array(5).fill().map((_, i) => ({
          count: (dayNum * 7 + i * 3) % 10,
          you: i === 0
        })),
        bins: []
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.json(puzzle);
    }
  } else if (pathname === '/submit') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Submission received for game', data.game, 'day', data.day);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.json({ success: true, message: `Result recorded for ${data.game} day ${data.day}` });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.json({ success: false, error: 'Invalid JSON payload' });
      }
    });
  } else if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.json({ status: 'ok', server: 'local-test.mjs' });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, 'http://localhost' + req.url);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.searchParams;

  if (pathname === '/' || pathname === '/trace') {
    serveStatic(res, 'C:\\Project\\daily\\trace\\index.html', 'text/html');
  } else if (pathname === '/recycle-grid') {
    serveStatic(res, 'C:\\Project\\daily\\recycle-grid\\index.html', 'text/html');
  } else if (pathname === '/recycle-rings') {
    serveStatic(res, 'C:\\Project\\daily\\recycle-rings\\index.html', 'text/html');
  } else if (pathname === '/sift') {
    serveStatic(res, 'C:\\Project\\daily\\sift\\index.html', 'text/html');
  } else if (pathname === '/sprint') {
    serveStatic(res, 'C:\\Project\\daily\\sprint\\index.html', 'text/html');
  } else if (pathname === '/museum') {
    serveStatic(res, 'C:\\Project\\daily\\museum\\index.html', 'text/html');
  } else if (pathname.startsWith('/api/')) {
    handleApiRoute(res, pathname, query);
  } else {
    let filePath = path.join('C:\\Project\\daily', pathname);
    let ext = path.extname(filePath).toLowerCase();
    if (!ext) filePath += '.html';
    let contentType = 'text/html';
    switch (ext) {
      case '.html': contentType = 'text/html'; break;
      case '.js': contentType = 'text/javascript'; break;
      case '.css': contentType = 'text/css'; break;
      case '.json': contentType = 'application/json'; break;
    }
    if (filePath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }
    serveStatic(res, filePath, contentType);
  }
});

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('Server-First Local Development Server');
  console.log('='.repeat(50));
  console.log();
  console.log('==================================================');
console.log(`Server running at http://localhost:${PORT}/`);
  console.log();
  console.log('Available endpoints:');
  console.log('  GET  /                          - Load trace game');
  console.log('  GET  /api/puzzle?game=x&day=y   - Fetch puzzle from server');
  console.log('  POST /submit                    - Submit result to curve');
  console.log('  GET  /health                    - Health check');
  console.log();
  console.log('Client configuration:');
  console.log('  SHELL.fetchPuzzle(game, dayIndex, "http://localhost:3000/api")');
  console.log();
  console.log('Press Ctrl+C to stop the server');
});

console.log('Server startup complete - listening on port', PORT);