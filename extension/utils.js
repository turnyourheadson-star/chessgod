// Chess.com fetch: first get archive list, then fetch the last archive
async function fetchChesscomGames(username) {
  const archiveRes = await fetch(`https://api.chess.com/pub/player/${username}/games/archives`);
  if (!archiveRes.ok) throw new Error("Failed to fetch archives");
  const archives = await archiveRes.json();
  const lastUrl = (archives.archives && archives.archives.length) ? archives.archives.pop() : null;
  if (!lastUrl) return [];

  const gamesRes = await fetch(lastUrl);
  if (!gamesRes.ok) throw new Error("Failed to fetch games");
  const data = await gamesRes.json();

  // Take last 10 games
  return data.games.slice(-10).reverse().map(g => ({
    white: (g.white && (g.white.username || g.white.username)) || 'White',
    black: (g.black && (g.black.username || g.black.username)) || 'Black',
    white_rating: (g.white && (g.white.rating || g.white.rating)) || null,
    black_rating: (g.black && (g.black.rating || g.black.rating)) || null,
    result: ((g.white && g.white.result) || '') + " - " + ((g.black && g.black.result) || ''),
    time: g.end_time ? new Date(g.end_time * 1000) : new Date(),
    type: g.time_class || '',
    pgn: g.pgn || '',
    url: g.url || ''
  }));
}

// Lichess fetch: uses NDJSON format
async function fetchLichessGames(username) {
  const res = await fetch(
    `https://lichess.org/api/games/user/${username}?max=10&clocks=false&evals=false&moves=true&pgnInJson=true`,
    { headers: { Accept: "application/x-ndjson" } }
  );
  if (!res.ok) throw new Error("Failed to fetch Lichess games");

  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);

  return lines.map(line => {
    const g = JSON.parse(line);
    return {
      white: g.players?.white?.user?.name || 'White',
      black: g.players?.black?.user?.name || 'Black',
      white_rating: g.players?.white?.rating || g.players?.white?.user?.rating || null,
      black_rating: g.players?.black?.rating || g.players?.black?.user?.rating || null,
      result: (g.players?.white?.result || '') + " - " + (g.players?.black?.result || ''),
      time: g.createdAt ? new Date(g.createdAt) : new Date(),
      type: g.speed || '',
      pgn: g.pgn || '',
      url: g.id ? `https://lichess.org/${g.id}` : ''
    };
  });
}

// Send PGN to backend
async function analyzeGame(pgn, url = '', depth = 15) {
  const BACKEND_URL = 'https://chessgod-backend-wa2i.onrender.com'; // Update this with your Render URL
  
  // Try both endpoints - JSON and form data
  try {
    // First try the JSON endpoint
    const moves = pgn.split(/\s+/).filter(move => move.trim());
    const jsonResponse = await fetch(`${BACKEND_URL}/analyze`, {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        moves: moves,
        platform: 'extension',
        depth: depth,
        url: url
      })
    });

    if (jsonResponse.ok) {
      return jsonResponse.json();
    }

    // Fallback to form data if JSON fails
    const formData = new FormData();
    const file = new Blob([pgn], { type: "text/plain" });
    formData.append("file", file, "game.pgn");
    if (url) formData.append('url', url);
    formData.append('depth', String(depth));

    const res = await fetch(`${BACKEND_URL}/analyze`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      throw new Error("Backend error");
    }
    return res.json();
  } catch (error) {
    console.error("Analysis failed:", error);
    throw error;
  }
  if (!res.ok) {
    throw new Error("Backend error");
  }
  return res.json();
}
