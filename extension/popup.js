async function fetchAndRenderGames() {
  const username = document.getElementById("username").value.trim();
  const platformEl = document.getElementById("platform");
  const platform = (platformEl && platformEl.value) ? platformEl.value : 'chesscom';
  if (!username) return;
  if (window._analysisBusy) return; // prevent multiple fetches

  let games = [];
  if (platform === "chesscom") {
    games = await fetchChesscomGames(username);
  } else {
    games = await fetchLichessGames(username);
  }

  const list = document.getElementById("gamesList");
  list.innerHTML = "";

  games.forEach(g => {
    // Extract result from PGN
    let winnerText = "";
    const resultMatch = g.pgn.match(/\[Result\s+"([^"]+)"\]/);
    if (resultMatch) {
      const result = resultMatch[1];
      if (result === "1-0") {
        winnerText = `Winner: ${g.white}`;
      } else if (result === "0-1") {
        winnerText = `Winner: ${g.black}`;
      } else {
        winnerText = "Draw";
      }
    }

    const li = document.createElement("li");
    li.className = 'game-item';
    li.innerHTML = `
      <div class="game-row">
        <div class="players"><strong>${escapeHtml(g.white)}</strong> <span class="vs">vs</span> <strong>${escapeHtml(g.black)}</strong></div>
        <div class="meta">${escapeHtml(g.type)} • ${g.time.toLocaleString()}</div>
        <div class="winner">${escapeHtml(winnerText)}</div>
      </div>
    `;
    li.addEventListener("click", () => {
      // Select this game (highlight) and show the Analyze button
      const prev = document.querySelector('#gamesList li.selected');
      if (prev) prev.classList.remove('selected');
      li.classList.add('selected');
      const analyzeAction = document.getElementById('analyzeAction');
      if (analyzeAction) { analyzeAction.classList.remove('hidden'); }
      // store selected PGN on analyze button
      const btn = document.getElementById('analyzeSelected');
      if (btn) {
        btn.dataset.pgn = g.pgn || '';
        btn.dataset.url = g.url || '';
        btn.dataset.white = g.white || '';
        btn.dataset.black = g.black || '';
        btn.dataset.white_rating = g.white_rating || '';
        btn.dataset.black_rating = g.black_rating || '';
        // enable button now that a selection exists
        btn.disabled = false;
      }
      li.dataset.pgn = g.pgn || '';
    });
    list.appendChild(li);
  });
}

// small arrow next to platform select triggers the fetch action
const platformArrow = document.getElementById('platformArrow');
if (platformArrow) {
  platformArrow.addEventListener('click', fetchAndRenderGames);
}

// Note: the clear button is created dynamically inside the results header.
// If an existing static clear button is present (old layout), wire it up.
const clearBtnStatic = document.getElementById('clearAnalysis');
if (clearBtnStatic) {
  clearBtnStatic.addEventListener('click', async () => {
    await clearAnalysis();
  });
}

// Analyse Current Game feature removed per request.

async function startAnalysis(pgn, gameUrl = '', meta = {}) {
  // No progress bar; overlay loader will be shown
  const results = document.getElementById("results");
  const platformEl = document.getElementById('platform');
  const depthEl = document.getElementById('depth');
  const depth = depthEl ? parseInt(depthEl.value, 10) : 15;

  // mark as busy and disable controls
  window._analysisBusy = true;
  document.getElementById('username').disabled = true;
  if (platformEl) platformEl.disabled = true;
  const platformArrowBtn = document.getElementById('platformArrow');
  if (platformArrowBtn) platformArrowBtn.disabled = true;
  // show overlay to block clicks
  const overlay = document.getElementById('analysisOverlay');
  if (overlay) { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }
  try { document.body.classList.add('overlay-active'); } catch (e) {}

  // ensure overlay is on top and browser has a moment to render it before heavy work
  if (overlay) {
    overlay.style.zIndex = '99999';
    overlay.style.pointerEvents = 'auto';
  }
  // yield to browser so overlay becomes visible before analysis starts
  await new Promise(res => setTimeout(res, 40));

  results.classList.add("hidden");

  try {
    // Simulate progress while waiting for the backend (up to 85%)
    const progressFill = document.getElementById('analysisProgressFill');
    const progressLabel = document.getElementById('analysisProgressLabel');
    let progress = 5;
    if (progressFill) progressFill.style.width = progress + '%';
    const progressInterval = setInterval(() => {
      if (progress < 85) {
        progress += Math.random() * 3; // random bump
        if (progress > 85) progress = 85;
        if (progressFill) progressFill.style.width = Math.round(progress) + '%';
        if (progressLabel) progressLabel.textContent = `Analyzing...`;
      }
    }, 350);

    const data = await analyzeGame(pgn, gameUrl, depth);
    clearInterval(progressInterval);
    if (progressFill) progressFill.style.width = '100%';
    if (progressLabel) progressLabel.textContent = 'Finalizing...';

    // Merge client metadata
    if (meta) {
      data.white_name = data.white_name || meta.white_name || data.white_name;
      data.black_name = data.black_name || meta.black_name || data.black_name;
      data.white_rating = data.white_rating || meta.white_rating || (data.white && data.white.rating) || null;
      data.black_rating = data.black_rating || meta.black_rating || (data.black && data.black.rating) || null;
    }

    // Hide the list and analyze action now that analysis is done
    const gl = document.getElementById('gamesList'); if (gl) gl.innerHTML = '';
    const aa = document.getElementById('analyzeAction'); if (aa) aa.classList.add('hidden');

    // Initialize board preview from returned fen history and moves meta
    try {
      // persist the original PGN so the board can reference moves if needed
      window._currentPGN = pgn || data.pgn || '';
      initBoardFromAnalysis(data);
    } catch (e) { console.warn('Failed to init board', e); }

    // Render and persist results
    results.classList.remove("hidden");
    renderResults(data);
    try { await saveAnalysis(data); } catch (e) { console.warn('Failed to save analysis to storage', e); }
  } catch (err) {
    alert("Analysis failed: " + err.message);
  } finally {
    // release busy flag and re-enable controls
    window._analysisBusy = false;
    document.getElementById('username').disabled = false;
  if (platformEl) platformEl.disabled = false;
  const platformArrowBtn = document.getElementById('platformArrow');
  if (platformArrowBtn) platformArrowBtn.disabled = false;
    const overlay = document.getElementById('analysisOverlay');
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = 'none'; }
    try { document.body.classList.remove('overlay-active'); } catch (e) {}
  }
}

function attachMoveListeners() {
  const table = document.getElementById('resultsTable');
  if (!table) return;
  const gameUrl = table.dataset.gameUrl || '';
  const links = table.querySelectorAll('.move-link');
  links.forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const move = a.dataset.move;
      if (!gameUrl) {
        // fallback: open href
        window.open(a.href, '_blank');
        return;
      }
      openGameAtMove(gameUrl, Number(move));
    });
  });
}

// Persist last analysis so popup can restore state when reopened
function saveAnalysis(data) {
  return new Promise((resolve, reject) => {
    try {
      // Include current board state (if present) so popup can restore board on reopen
      const toSave = Object.assign({}, data || {});
      try {
        toSave.board_state = {
          fen_history: window._fenHistory || [],
          fen_index: window._fenIndex || 0,
          pgn: window._currentPGN || ''
        };
      } catch (e) {}
      chrome.storage.local.set({ lastAnalysis: toSave }, () => {
        const err = chrome.runtime.lastError;
        if (err) return reject(err);
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Remove saved analysis and clear UI
function clearAnalysis() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove(['lastAnalysis'], () => {
        // clear UI
        const results = document.getElementById('results');
        if (results) results.innerHTML = '';
        const gamesList = document.getElementById('gamesList');
        if (gamesList) gamesList.innerHTML = '';
    // progress UI removed
    // hide overlay as well
    const overlay = document.getElementById('analysisOverlay');
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = 'none'; }
        // disable clear button
        const cb = document.getElementById('clearAnalysis');
        if (cb) cb.disabled = true;
        try { document.body.classList.remove('has-analysis'); document.body.classList.add('no-analysis'); } catch (e) {}
        resolve();
      });
    } catch (e) {
      try { document.body.classList.remove('has-analysis'); document.body.classList.add('no-analysis'); } catch (err) {}
      resolve();
    }
  });
}

function loadSavedAnalysis() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['lastAnalysis'], result => {
        const found = result.lastAnalysis || null;
        // enable clear button if analysis exists
        const cb = document.getElementById('clearAnalysis');
        if (cb) cb.disabled = !found;
        resolve(found);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function renderResults(data) {
  const results = document.getElementById('results');
  if (!results) return;
  // Populate the small summary table and show results header
  // Clear previous results content but keep the results header area for the clear button
  results.innerHTML = `<div class="results-header"><h3>Results</h3><button id="clearAnalysis" class="clear-dustbin" title="Clear analysis" aria-label="Clear analysis"></button></div>`;
  // Fill the summary table with counts
  const cats = ['brilliant','great','best','excellent','good','inaccuracy','mistake','blunder'];
  const whiteCounts = (data.white && data.white.counts) || {};
  const blackCounts = (data.black && data.black.counts) || {};
  let whiteTotal = 0, blackTotal = 0;
  cats.forEach(cat => {
    const w = whiteCounts[cat] || 0;
    const b = blackCounts[cat] || 0;
    const wEl = document.getElementById(`white-${cat}`);
    const bEl = document.getElementById(`black-${cat}`);
    if (wEl) wEl.textContent = String(w);
    if (bEl) bEl.textContent = String(b);
    whiteTotal += w;
    blackTotal += b;
  });
  const wTotEl = document.getElementById('white-total');
  const bTotEl = document.getElementById('black-total');
  if (wTotEl) wTotEl.textContent = String(whiteTotal);
  if (bTotEl) bTotEl.textContent = String(blackTotal);

  // enable clear button
  const cb = document.getElementById('clearAnalysis');
  if (cb) {
    cb.disabled = false;
    cb.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7z" opacity="0.9"></path><path d="M9 4h6v2H9z" opacity="0.9"></path></svg>`;
    cb.onclick = async () => { await clearAnalysis(); };
  }

  // Show the summary area and results
  const summaryWrap = document.getElementById('summaryWrapper');
  if (summaryWrap) summaryWrap.classList.remove('hidden');
  results.classList.remove('hidden');
  try { document.body.classList.remove('no-analysis'); document.body.classList.add('has-analysis'); } catch (e) {}
}

// On popup load, always run the intro loader then the splash sequence
document.addEventListener('DOMContentLoaded', async () => {
  // Let the splash sequence fully control logo fade/move to avoid duplicate fades
  try { document.body.classList.add('splash-active'); } catch (e) {}

  // start and await the full splash sequence (continues the choreography)
  try {
    await runSplashSequence();
  } catch (e) {
    // fallback: ensure title visible and button shown
    document.getElementById('splash')?.classList.add('logo-faded-in');
    revealTitleInstant();
    document.getElementById('splashNext')?.classList.add('visible');
  }

  const saved = await loadSavedAnalysis();
  if (saved) {
    const results = document.getElementById('results');
    if (results) results.classList.remove('hidden');
    renderResults(saved);
    // restore board state if available
    try {
      if (saved.board_state && Array.isArray(saved.board_state.fen_history) && saved.board_state.fen_history.length) {
        window._fenHistory = saved.board_state.fen_history || [];
        window._movesMeta = saved.moves_meta || [];
        window._fenIndex = saved.board_state.fen_index || 0;
        window._currentPGN = saved.board_state.pgn || '';
  // show board preview (pass full saved object so labels/game-type populate)
  initBoardFromAnalysis(saved);
        // step to saved index
        try { if (window._updateBoardUI) window._updateBoardUI(); } catch (e) {}
      }
    } catch (e) { /* ignore */ }
    // update sizing classes
    try { document.body.classList.remove('no-analysis'); document.body.classList.add('has-analysis'); } catch (e) {}
  } else {
    try { document.body.classList.add('no-analysis'); document.body.classList.remove('has-analysis'); } catch (e) {}
  }

  // Attempt to auto-fill username from the active chess site tab (best-effort)
  try {
    await autoFillUsernameFromActiveTab();
  } catch (e) { /* ignore */ }
});

// ---- Splash sequencing logic ----
async function runSplashSequence() {
  const splash = document.getElementById('splash');
  const loader = document.getElementById('loaderContainer');
  // mark splash active so CSS can disable scrolling
  try { document.body.classList.add('splash-active'); } catch (e) {}
  if (!splash) return;

  const logo = document.getElementById('splashLogo');
  const titleText = document.getElementById('splashTitleText');
  const welcome = document.getElementById('splashWelcome');
  const tagline = document.getElementById('splashTagline');
  const btn = document.getElementById('splashNext');

  // 1) fade-in logo slowly
  splash.classList.remove('logo-faded-in','logo-moved','title-typing','title-typed','welcome-visible','tagline-visible','continue-visible');
  await delay(80);
  logo.style.transition = 'opacity 900ms ease, transform 900ms ease';
  logo.style.opacity = '1';
  splash.classList.add('logo-faded-in');
  // wait for logo to settle
  await delay(1100);

  // 2) shrink and glide upward (move to top center)
  // Force reflow so the animation will trigger reliably, then add the move class
  // (reading offsetHeight forces layout)
  void logo.offsetHeight;
  splash.classList.add('logo-moved');
  // fallback: set inline transform so even if CSS keyframes don't run the logo will animate
  try {
    // set a transition if not present
    if (!logo.style.transition) logo.style.transition = 'transform 900ms ease, opacity 900ms ease';
    // target transform matches the keyframe end-state (translate up and shrink)
    logo.style.transform = 'translateY(-140px) scale(0.7)';
  } catch (e) {}
  // wait for the logo animation to complete
  await delay(950);

  // compute stacked offsets so the typed title + welcome + tagline will sit with 40px gaps beneath the logo
  try {
    // get logo final rect (after animation)
    const logoRect = logo.getBoundingClientRect();
    const splashInner = document.getElementById('splashInner');
    const titleEl = document.getElementById('splashTitle');
    const welcomeEl = document.getElementById('splashWelcome');
    const taglineEl = document.getElementById('splashTagline');
    // fallback gap
    const gap = 40;
    // compute where to place the title: place it so there's `gap` px between bottom of logo and top of title
    const logoBottom = logoRect.top + logoRect.height;
    // measure heights (will be small/zero before typing; we'll approximate using computed font-size)
    const titleHeight = titleEl ? titleEl.getBoundingClientRect().height || 36 : 36;
    // compute stacked offset relative to CSS fallback -140px used in CSS
    // we want title's final top to be logoBottom + gap (in viewport coords). Convert to a translateY relative value by measuring the current title position.
    if (titleEl && splashInner) {
      const splashRect = splashInner.getBoundingClientRect();
      const desiredTitleTop = logoBottom + gap;
      const currentTitleTop = titleEl.getBoundingClientRect().top;
      const offset = desiredTitleTop - currentTitleTop;
      // set CSS variable to shift all stacked elements by this offset (px)
      splashInner.style.setProperty('--stacked-offset', `${offset}px`);
    }
  } catch (e) {
    // if measurement fails, fall back to CSS-only transforms
  }

  // 3) Type 'ChessGod' with typewriter effect in the center, then move it up under the logo
  const name = 'ChessGod';
  titleText.textContent = '';
  titleText.style.width = '0ch';
  titleText.classList.add('typewriter-anim');
  splash.classList.add('title-typing');
  for (let i = 0; i < name.length; i++) {
    titleText.textContent += name[i];
    // progressively increase width to reveal letters (helps with caret feel)
    titleText.style.width = `${i + 1}ch`;
    await delay(120 + (i * 6));
  }
  // finish typing
  splash.classList.add('title-typed');
  await delay(350);

  // 4) move title upward to sit neatly under the logo: we'll add a helper class that the CSS respects
  // The logo has moved upward already, so this simply fades and repositions the title
  titleText.parentElement.style.transition = 'transform 450ms ease, opacity 350ms ease';
  titleText.parentElement.style.opacity = '1';
  // now reveal Welcome word in center with same style
  welcome.textContent = '';
  welcome.textContent = 'Welcome';
  splash.classList.add('welcome-visible');
  await delay(650);

  // 5) show tagline with punch
  splash.classList.add('tagline-visible');
  await delay(420);

  // 6) reveal NEXT button with animated visuals
  if (btn) {
    btn.style.opacity = '0';
    splash.classList.add('continue-visible');
    // make button visible for accessibility/fallback
    btn.classList.add('visible');
    btn.style.opacity = '1';
    btn.onclick = async () => { await revealMainUIFromSplash(); };
  }
}

function revealTitleInstant() {
  const titleText = document.getElementById('splashTitleText');
  if (!titleText) return;
  titleText.textContent = 'ChessGod';
}

async function revealMainUIFromSplash() {
  const splash = document.getElementById('splash');
  const mainUI = document.getElementById('mainUI');
  if (!splash || !mainUI) return;
  // animate splash out: fade then hide
  splash.style.transition = 'opacity 320ms ease, transform 420ms ease';
  splash.style.opacity = '0';
  splash.style.transform = 'translateY(-8px) scale(.998)';
  await delay(360);
  splash.style.display = 'none';
  try { document.body.classList.remove('splash-active'); } catch (e) {}

  mainUI.classList.remove('hidden');
  mainUI.classList.add('visible');
  mainUI.setAttribute('aria-hidden','false');
  // Restore saved analysis UI (if present)
  const saved = await loadSavedAnalysis();
  if (saved) {
    const results = document.getElementById('results');
    if (results) results.classList.remove('hidden');
    renderResults(saved);
    try {
      if (saved.board_state && Array.isArray(saved.board_state.fen_history) && saved.board_state.fen_history.length) {
        window._fenHistory = saved.board_state.fen_history || [];
        window._movesMeta = saved.moves_meta || [];
        window._fenIndex = saved.board_state.fen_index || 0;
        window._currentPGN = saved.board_state.pgn || '';
        initBoardFromAnalysis(saved);
        try { if (window._updateBoardUI) window._updateBoardUI(); } catch (e) {}
      }
    } catch (e) { /* ignore */ }
  }
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }




// Helper: determine whether to show loader (only once per Chrome session)
// shouldShowLoader removed: pixel loader no longer used.

// Simple pixel-by-pixel intro animation. This is an approximation of the requested effect.
// runIntroLoader removed: pixel loader no longer used.

// Prevent images from being dragged or showing context menu to save
// Setup depth slider value display
function setupDepthSlider() {
  const slider = document.getElementById('depth');
  const value = document.getElementById('depthValue');
  if (!slider || !value) return;

  function updateValue() {
    value.textContent = slider.value;
  }

  slider.addEventListener('input', updateValue);
  // Set initial value
  updateValue();
}

document.addEventListener('DOMContentLoaded', () => {
  setupDepthSlider();
  
  document.addEventListener('dragstart', e => {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });
  document.addEventListener('contextmenu', e => {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });
  // Input filled state: keep label up when input has text
  const username = document.getElementById('username');
  const formControl = username && username.closest('.form-control');
  function updateFilled() {
    if (!formControl || !username) return;
    if (username.value && username.value.trim().length > 0) formControl.classList.add('filled');
    else formControl.classList.remove('filled');
  }
  if (username) {
    username.addEventListener('input', updateFilled);
    username.addEventListener('blur', updateFilled);
    // initial state
    setTimeout(updateFilled, 10);
  }
});

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Open the game URL in a new tab and attempt to jump to the requested move by
// injecting a small script into the game page. This is best-effort and uses
// heuristics to find clickable move elements.
function openGameAtMove(gameUrl, moveNumber) {
  // Build deterministic deep-links for known sites
  try {
    const u = new URL(gameUrl);
    const host = u.hostname.toLowerCase();
    let target = gameUrl;

    if (host.includes('chess.com')) {
      // chess.com expects ?move=N (or &move= if query exists)
      const sep = u.search ? '&' : '?';
      target = `${gameUrl}${sep}move=${moveNumber}`;
    } else if (host.includes('lichess.org')) {
      // lichess uses fragment '#N'
      // If there's already a fragment, replace it
      target = gameUrl.split('#')[0] + `#${moveNumber}`;
    } else {
      // fallback: use fragment with move label
      target = gameUrl.split('#')[0] + `#move-${moveNumber}`;
    }

    window.open(target, '_blank');
  } catch (e) {
    // If URL parsing failed, just open fallback
    window.open(gameUrl + `#move-${moveNumber}`, '_blank');
  }
}

// Small inline SVG placeholders for icons. Replace these with chess.com icons if provided.


function moveTypeSvg(type) {
  const t = (type || '').toLowerCase();
  const map = {
    'brilliant': 'icons/brilliant.png',
    'great': 'icons/great.png',
    'best': 'icons/best.png',
    'excellent': 'icons/excellent.png',
    'good': 'icons/good.png',
    'inaccuracy': 'icons/inaccuracy.png',
    'mistake': 'icons/mistake.png',
    'blunder': 'icons/blunder.png',
    
  };
  const path = map[t];
  if (path) return `<img src="${path}" class="move-icon"/>`;
  // fallback inline small circle
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="#cfd8dc"><circle cx="12" cy="12" r="6"/></svg>`;
}

// ------------ New UI integration: Analyze Selected + board controls ------------
// Analyze button wiring
const analyzeSelectedBtn = document.getElementById('analyzeSelected');
if (analyzeSelectedBtn) {
  // start disabled until a selection occurs
  analyzeSelectedBtn.disabled = true;
  analyzeSelectedBtn.addEventListener('click', async () => {
    const pgn = analyzeSelectedBtn.dataset.pgn;
    const url = analyzeSelectedBtn.dataset.url || '';
    if (!pgn) return;
    // hide games list and analyze action while running
    const gamesList = document.getElementById('gamesList');
    if (gamesList) gamesList.innerHTML = '';
    const aa = document.getElementById('analyzeAction'); if (aa) aa.classList.add('hidden');
    // ensure button is disabled during analysis
    analyzeSelectedBtn.disabled = true;
    await startAnalysis(pgn, url, { white_name: analyzeSelectedBtn.dataset.white, black_name: analyzeSelectedBtn.dataset.black, white_rating: analyzeSelectedBtn.dataset.white_rating, black_rating: analyzeSelectedBtn.dataset.black_rating });
  });
}

// Minimal board renderer (no external libs) - uses FEN to draw pieces in a simple grid
function renderBoardFromFEN(fen) {
  const container = document.getElementById('chessboard');
  if (!container) return;
  // preserve existing overlay SVG (if present) and replace only the mini-board
  const existingOverlay = document.getElementById('boardOverlay');
  // remove previous mini-board(s) but keep overlay/defs
  Array.from(container.querySelectorAll('.mini-board')).forEach(n => n.remove());
  const boardEl = document.createElement('div');
  boardEl.className = 'mini-board';
  boardEl.style.display = 'grid';
  boardEl.style.gridTemplateColumns = 'repeat(8, 1fr)';
  boardEl.style.gridTemplateRows = 'repeat(8, 1fr)';
  boardEl.style.width = '420px';
  boardEl.style.height = '420px';
  boardEl.style.borderRadius = '6px';
  boardEl.style.overflow = 'hidden';

  // parse fen
  const parts = fen.split(' ');
  const rows = parts[0].split('/');
  // Lichess-style: rows are from rank 8 (top) to rank 1 (bottom) in FEN
  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    let file = 0;
    for (let ch of row) {
      if (/[1-8]/.test(ch)) {
        const n = parseInt(ch, 10);
        for (let k = 0; k < n; k++) {
          const sq = document.createElement('div');
          sq.className = 'sq ' + ((((r + file) % 2) === 0) ? 'light' : 'dark');
          // Provide coordinate data attribute (a8..h1) for future features
          const coordFile = String.fromCharCode('a'.charCodeAt(0) + file);
          const coordRank = 8 - r;
          sq.dataset.coord = coordFile + String(coordRank);
          boardEl.appendChild(sq);
          file++;
        }
      } else {
        const sq = document.createElement('div');
        sq.className = 'sq ' + ((((r + file) % 2) === 0) ? 'light' : 'dark');
        // use background-image on the square to avoid intrinsic SVG viewBox offsets
        const map = {
          'K': 'wK','Q':'wQ','R':'wR','B':'wB','N':'wN','P':'wP',
          'k': 'bK','q':'bQ','r':'bR','b':'bB','n':'bN','p':'bP'
        };
        const fname = map[ch] || null;
        if (fname) {
          const svgUrl = `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/${fname}.svg`;
          sq.style.backgroundImage = `url('${svgUrl}')`;
          sq.classList.add('has-piece');
          sq.dataset.piece = fname;
        }
        boardEl.appendChild(sq);
        // set coordinate data attribute
        const coordFile = String.fromCharCode('a'.charCodeAt(0) + file);
        const coordRank = 8 - r;
        sq.dataset.coord = coordFile + String(coordRank);
        boardEl.appendChild(sq);
        file++;
      }
    }
  }
  // ensure overlay stays on top: insert board before overlay if overlay exists
  if (existingOverlay) container.insertBefore(boardEl, existingOverlay);
  else container.appendChild(boardEl);
}

// piece images are used instead of Unicode glyphs

// state for board stepping
window._fenHistory = [];
window._movesMeta = [];
window._fenIndex = 0;

function setupBoardControls() {
  const prev = document.getElementById('prevMove');
  const next = document.getElementById('nextMove');
  const moveType = document.getElementById('moveType');

  function updateUI() {
    const idx = window._fenIndex;
    const fen = window._fenHistory[idx];
    renderBoardFromFEN(fen);
    const meta = window._movesMeta.find(m => m.ply_index === idx) || null;
    if (meta) {
      if (moveType) moveType.innerHTML = `${moveTypeSvg(meta.category)} <span style="margin-left:8px; vertical-align:middle;">${(meta.category || '').toUpperCase()}</span>`;
    } else {
      if (moveType) moveType.textContent = '';
    }
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= (window._fenHistory.length - 1);
    // draw best-move arrow for this ply (if available)
    try { drawBestMoveArrowForIndex(idx); } catch (e) { /* non-fatal */ }
    // Clear previous highlights and apply new highlights for the last-played move (the move that led to the displayed FEN)
    try {
      // Remove any existing highlight classes
      document.querySelectorAll('.mini-board .sq.highlight-from, .mini-board .sq.highlight-to').forEach(el => {
        el.classList.remove('highlight-from');
        el.classList.remove('highlight-to');
      });
      // Determine the move that produced the current FEN: moves_meta.ply_index records the
      // position BEFORE the move, so the move that produced fen_history[idx] has ply_index === idx - 1.
      let playedUci = null;
      if (idx > 0) {
        const playedMeta = (window._movesMeta || []).find(m => m.ply_index === (idx - 1)) || null;
        if (playedMeta && playedMeta.played_uci) playedUci = playedMeta.played_uci;
      }
      // Fallback: if we couldn't find the played move, fall back to meta.played_uci (move to play from this position)
      if (!playedUci && meta) playedUci = meta.played_uci || meta.best_uci || null;
      if (playedUci && playedUci.length >= 4) {
        const from = playedUci.slice(0,2);
        const to = playedUci.slice(2,4);
        const fromEl = document.querySelector(`.mini-board .sq[data-coord="${from}"]`);
        const toEl = document.querySelector(`.mini-board .sq[data-coord="${to}"]`);
        if (fromEl) fromEl.classList.add('highlight-from');
        if (toEl) toEl.classList.add('highlight-to');
      }
    } catch (e) {
      // non-fatal if DOM queries fail
    }
  }

  // expose for external calls
  window._updateBoardUI = updateUI;

  // Use onclick with a small guard to prevent double-processing (some environments fire multiple handlers)
  let navLock = false;
  if (prev) prev.onclick = () => {
    if (navLock) return;
    navLock = true;
    try { if (window._fenIndex > 0) { window._fenIndex = window._fenIndex - 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
  };
  if (next) next.onclick = () => {
    if (navLock) return;
    navLock = true;
    try { if (window._fenIndex < window._fenHistory.length - 1) { window._fenIndex = window._fenIndex + 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
  };
  // Keyboard navigation: left/right arrow keys control prev/next
  document.removeEventListener('keydown', window._boardKeyHandler || (()=>{}));
  window._boardKeyHandler = (e) => {
    if (!document.getElementById('boardContainer') || document.getElementById('boardContainer').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') {
      // emulate prev click
      if (navLock) return;
      navLock = true;
      try { if (window._fenIndex > 0) { window._fenIndex = window._fenIndex - 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      if (navLock) return;
      navLock = true;
      try { if (window._fenIndex < window._fenHistory.length - 1) { window._fenIndex = window._fenIndex + 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', window._boardKeyHandler);
}

// expose update function so init can call it and tests can trigger UI refresh
window._updateBoardUI = null;

// ---------------- Arrow rendering utilities ----------------
function ensureOverlayDefs() {
  const svg = document.getElementById('boardOverlay');
  if (!svg) return null;
  if (!svg.querySelector('defs')) {
    const svgns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(svgns, 'defs');
    const marker = document.createElementNS(svgns, 'marker');
    marker.setAttribute('id', 'arrowhead');
    // use userSpaceOnUse so marker coordinates are in SVG user units (same as line coords)
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
  // marker viewBox dimensions; make the marker wider/taller for a bigger arrow head
  // we'll use a wider triangle (width=18, height=10) and place refX at the tip
  marker.setAttribute('viewBox', '0 0 18 10');
  marker.setAttribute('markerWidth', '18');
  marker.setAttribute('markerHeight', '10');
  // place the reference at the tip of the arrow path (x=18, y=5)
  marker.setAttribute('refX', '18');
  marker.setAttribute('refY', '5');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS(svgns, 'path');
  // Wider triangular arrow head
  path.setAttribute('d', 'M0,0 L0,10 L18,5 z');
    path.setAttribute('class', 'arrow-head');
    marker.appendChild(path);
    defs.appendChild(marker);
    svg.appendChild(defs);
  }
  return svg;
}

function clearOverlayArrows() {
  const svg = document.getElementById('boardOverlay');
  if (!svg) return;
  // Remove all overlay children except the <defs> block to ensure no stray dots remain
  Array.from(svg.children).forEach(child => {
    if (child.tagName && child.tagName.toLowerCase() === 'defs') return;
    child.remove();
  });
}

function uciSquareToCenter(square) {
  // Use rendered mini-board dimensions to compute accurate centers
  if (!square || square.length < 2) return null;
  const boardEl = document.querySelector('.mini-board');
  if (!boardEl) return null;
  const rect = boardEl.getBoundingClientRect();
  const file = square[0];
  const rank = parseInt(square[1], 10);
  const fileIndex = file.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
  const rankIndex = 8 - rank; // 0 at top (rank 8) to 7 at bottom (rank 1)
  const Sx = rect.width / 8;
  const Sy = rect.height / 8;
  // compute center in viewport (client) coordinates
  const clientX = rect.left + (fileIndex * Sx) + (Sx / 2);
  const clientY = rect.top + (rankIndex * Sy) + (Sy / 2);
  // convert client coords to SVG user space (handles viewBox / preserveAspectRatio correctly)
  const svg = document.getElementById('boardOverlay');
  if (!svg || !svg.createSVGPoint) return { x: clientX, y: clientY };
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  // Inverse of screen CTM maps screen (client) to SVG user coordinates
  const inverse = svg.getScreenCTM() ? svg.getScreenCTM().inverse() : null;
  if (!inverse) return { x: clientX, y: clientY };
  const svgP = pt.matrixTransform(inverse);
  return { x: svgP.x, y: svgP.y };
}

function drawBestMoveArrowForIndex(idx) {
  const svg = ensureOverlayDefs();
  if (!svg) return;
  clearOverlayArrows();
  const meta = (window._movesMeta || []).find(m => m.ply_index === idx) || null;
  if (!meta) return;
  const svgns = 'http://www.w3.org/2000/svg';
  // Use only the single best move (first entry). Prefer explicit best_uci if present.
  const best = (meta.best_uci) ? meta.best_uci : (Array.isArray(meta.best_uci_list) && meta.best_uci_list.length ? meta.best_uci_list[0] : null);
  if (!best || best.length < 4) return;
  const from = best.slice(0,2);
  const to = best.slice(2,4);
  const a = uciSquareToCenter(from);
  const b = uciSquareToCenter(to);
  if (!a || !b) return;
  // Draw a straight arrow line from center-to-center
  const line = document.createElementNS(svgns, 'line');
  line.setAttribute('x1', String(a.x));
  line.setAttribute('y1', String(a.y));
  line.setAttribute('x2', String(b.x));
  line.setAttribute('y2', String(b.y));
  line.setAttribute('class', 'arrow-path');
  line.setAttribute('marker-end', 'url(#arrowhead)');
  // Ensure line doesn't extend beyond midpoints; the arrowhead marker will be placed at the end
  svg.appendChild(line);
  // No destination highlight circle (removing dots per UX request)
}

// Call this after analysis completes to initialize board and controls
function initBoardFromAnalysis(result) {
  window._fenHistory = (result.fen_history || []);
  window._movesMeta = (result.moves_meta || []);
  window._fenIndex = 0;
  if ((window._fenHistory || []).length) {
    const bc = document.getElementById('boardContainer');
    if (bc) bc.classList.remove('hidden');
    setupBoardControls();
    // render initial position
    const firstFen = window._fenHistory[0];
    renderBoardFromFEN(firstFen);
    // draw arrow for initial index if available
    try { drawBestMoveArrowForIndex(window._fenIndex); } catch (e) { /* ignore */ }
  // update move info too
  const moveType = document.getElementById('moveType');
  if (moveType) moveType.textContent = '';
    // populate player labels if available
    try {
      const blackLabel = document.getElementById('boardBlackPlayer');
      const whiteLabel = document.getElementById('boardWhitePlayer');
      const gameTypeEl = document.getElementById('boardGameType');
      if (blackLabel) blackLabel.textContent = `${result.black_name || result.black || ''}${result.black_rating ? ' ('+result.black_rating+')' : ''}`;
      if (whiteLabel) whiteLabel.textContent = `${result.white_name || result.white || ''}${result.white_rating ? ' ('+result.white_rating+')' : ''}`;
      if (gameTypeEl) gameTypeEl.textContent = (result.type || result.time_class || result.speed || '') ;
    } catch (e) {}
    // ensure the full UI state is consistent (buttons, arrow, etc.)
    try { if (window._updateBoardUI) window._updateBoardUI(); } catch (e) {}
  }
}

