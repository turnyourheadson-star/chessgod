from fastapi import FastAPI, UploadFile, Form, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from analysis.analyzer import analyze_game
import chess.pgn
import io
import os
import httpx
import json
from keep_alive import start_keep_alive
from pathlib import Path

app = FastAPI(title="ChessGod API", version="1.1.0")

@app.on_event("startup")
async def startup_event():
    start_keep_alive()

# Allow requests from the extension and localhost development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "chrome-extension://*",  # Allow any Chrome extension
        "https://chessgod-backend-wa2i.onrender.com",  # Production backend
        "https://chessgod-backend-wa2i.onrender.com/*"  # With wildcard for subpaths
    ],
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods for flexibility
    allow_headers=["*"],  # Allow all headers
    expose_headers=["*"]  # Expose all headers to the client
)

@app.get("/")
def root():
    return {"message": "ChessGod API running", "version": "1.1.0"}

@app.get("/health")
def health_check():
    """Health check endpoint for the backend"""
    return {"status": "healthy", "stockfish": os.path.exists(Path(__file__).parent / "stockfish" / "stockfish")}

@app.get("/games/{platform}/{username}")
async def get_games(platform: str, username: str, limit: int = 10):
    """Fetch recent games for a user from Chess.com or Lichess"""
    try:
        if platform.lower() == "chess.com":
            # Chess.com API endpoint
            async with httpx.AsyncClient() as client:
                response = await client.get(f"https://api.chess.com/pub/player/{username}/games/archives")
                if response.status_code != 200:
                    raise HTTPException(status_code=404, detail=f"User {username} not found on Chess.com")
                
                archives = response.json()["archives"]
                games = []
                # Get most recent archive
                if archives:
                    recent_archive = archives[-1]
                    archive_response = await client.get(recent_archive)
                    if archive_response.status_code == 200:
                        games = archive_response.json()["games"][-limit:]
                
                return {"games": games}
                
        elif platform.lower() == "lichess":
            # Lichess API endpoint
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"https://lichess.org/api/games/user/{username}",
                    params={"max": limit, "pgnInJson": "true"},
                    headers={"Accept": "application/x-ndjson"}
                )
                if response.status_code != 200:
                    raise HTTPException(status_code=404, detail=f"User {username} not found on Lichess")
                
                # Parse ndjson response
                games = [json.loads(line) for line in response.text.strip().split("\n")]
                return {"games": games}
        
        else:
            raise HTTPException(status_code=400, detail="Platform must be 'chess.com' or 'lichess'")
            
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch games: {str(e)}")

@app.post("/analyze")
async def analyze(request: Request):
    """Analyze a chess game with Stockfish.
    
    Accepts JSON body with:
    - pgn: string (Required)
    - game_id: string (Optional)
    - platform: string (Optional)
    - options: dict (Optional)
        - depth: int
        - multipv: int
        - threads: int
        - hash: int
        - use_nnue: bool
    """
    try:
        body = await request.json()
        pgn = body.get("pgn")
        if not pgn:
            return JSONResponse(
                status_code=400,
                content={"error": "No PGN provided"}
            )

        # Get analysis options
        options = body.get("options", {})
        depth = max(5, min(25, options.get("depth", 18)))  # Default depth 18, clamped 5-25
        multipv = options.get("multipv", 3)  # Default to 3 lines
        
        # Run analysis
        result = analyze_game(
            pgn,
            depth=depth,
            multipv=multipv,
            threads=options.get("threads", 4),
            hash_mb=options.get("hash", 128),
            use_nnue=options.get("use_nnue", True)
        )

        # Try to extract player names from PGN
        try:
            game = chess.pgn.read_game(io.StringIO(pgn))
            white = game.headers.get('White', '') if game else ''
            black = game.headers.get('Black', '') if game else ''
        except Exception:
            white = ''
            black = ''

        # Construct response
        response = {
            "white_name": white,
            "black_name": black,
            "game_id": body.get("game_id", ""),
            "platform": body.get("platform", ""),
            **result
        }
        return JSONResponse(content=response)
        
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Analysis failed: {str(e)}"}
        )

    # Try to extract player names from PGN tags
    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        white = game.headers.get('White', '') if game else ''
        black = game.headers.get('Black', '') if game else ''
    except Exception:
        white = ''
        black = ''

    # result may now include 'fen_history' and 'moves_meta'
    response = {
        "white_name": white,
        "black_name": black,
        "game_url": url or "",
        **result,
    }
    return JSONResponse(content=response)
