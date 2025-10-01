# backend/analysis/analyzer.py

import os
import platform
import io
from typing import Dict, Any, List

import chess# backend/analysis/analyzer.py

import os
import platform
import io
import logging
from typing import Dict, Any, List

import chess
import chess.pgn
import chess.engine

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# -------- CONFIG --------
MATE_SCORE = 100000

CATEGORIES = [
    "brilliant",  # Exceptional move that gains a winning advantage
    "great",      # Very strong move that maintains or increases advantage
    "best",       # The engine's top choice
    "excellent",  # Strong move that improves position
    "good",       # Solid move that doesn't lose advantage
    "inaccuracy", # Slight mistake that gives away some advantage
    "mistake",    # Significant error that loses advantage
    "blunder",    # Major mistake that loses material or position
]

# Centipawn thresholds for move classification
THRESHOLDS_CP = {
    "great": 10,      # Loss of up to 0.1 pawns
    "excellent": 30,  # Loss of up to 0.3 pawns
    "good": 75,       # Loss of up to 0.75 pawns
    "inaccuracy": 150, # Loss of up to 1.5 pawns
    "mistake": 300,    # Loss of up to 3 pawns
    # Anything worse is a blunder
}


def get_stockfish_path() -> str:
    """Get the path to Stockfish executable based on platform and environment."""
    # First check environment variable (for cloud deployment)
    env_path = os.getenv('STOCKFISH_PATH')
    if env_path and os.path.exists(env_path):
        logger.info(f"Using Stockfish from environment: {env_path}")
        return env_path
        
    # Fallback to local path
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "stockfish"))
    local_path = os.path.join(base, "stockfish.exe" if platform.system() == "Windows" else "stockfish")
    
    if not os.path.exists(local_path):
        logger.warning(f"Stockfish not found at {local_path}")
        # On Linux/Mac, try to find in PATH
        if platform.system() != "Windows":
            for path in os.environ["PATH"].split(os.pathsep):
                stockfish_path = os.path.join(path, "stockfish")
                if os.path.exists(stockfish_path):
                    logger.info(f"Found Stockfish in PATH: {stockfish_path}")
                    return stockfish_path
                    
    logger.info(f"Using local Stockfish: {local_path}")
    return local_path

# Initialize Stockfish path once
STOCKFISH_PATH = get_stockfish_path()

def classify_cp_loss(cp_loss: int, is_best_move: bool) -> str:
    """Classify a move based on centipawn loss and whether it's the engine's top choice.
    
    Args:
        cp_loss: Centipawn loss compared to best move (non-negative)
        is_best_move: Whether this was the engine's top choice
        
    Returns:
        Category string from CATEGORIES list
    """
    # Zero loss and engine's top choice = best move
    if cp_loss == 0 and is_best_move:
        return "best"
    # Zero loss but not top choice = great (might be equivalent but not preferred)
    if cp_loss == 0:
        return "great"
    # Classify based on thresholds
    if cp_loss <= THRESHOLDS_CP["great"]:
        return "great"
    if cp_loss <= THRESHOLDS_CP["excellent"]:
        return "excellent"
    if cp_loss <= THRESHOLDS_CP["good"]:
        return "good"
    if cp_loss <= THRESHOLDS_CP["inaccuracy"]:
        return "inaccuracy"
    if cp_loss <= THRESHOLDS_CP["mistake"]:
        return "mistake"
    # Anything worse is a blunder
    return "blunder"


def analyze_game(pgn_text: str,
                 depth: int = 15,
                 multipv: int = 1,
                 use_time: bool = False,
                 time_limit: float = 0.08,
                 threads: int = 1,
                 hash_mb: int = 16,
                 syzygy_path: str = None) -> Dict[str, Any]:
    """Analyze a chess game and provide detailed move assessments.

    This function takes a PGN game text, analyzes each position with Stockfish,
    and returns statistics about the quality of moves played by both sides.

    Args:
        pgn_text: The PGN text of the game to analyze
        depth: Stockfish search depth (default: 15, min: 5, max: 25)
        multipv: Number of principal variations to calculate (default: 1)
        use_time: If True, use time_limit instead of depth (default: False)
        time_limit: Time limit per position in seconds (default: 0.08)
        threads: Number of CPU threads for Stockfish (default: 1)
        hash_mb: Hash table size in MB for Stockfish (default: 16)
        syzygy_path: Optional path to Syzygy tablebases

    Returns:
        Dict containing:
        - Per-side statistics (counts of each move category)
        - Move metadata (best moves, evaluations, etc.)
        - FEN history for position replay
        - Engine configuration details
    """
    # Parse PGN and set up initial state
    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        if game is None:
            raise ValueError("Empty or invalid PGN provided")
    except Exception as e:
        logger.error(f"Failed to parse PGN: {e}")
        raise ValueError(f"Invalid PGN format: {e}")

    # Initialize statistics tracking
    stats = {
        "white": {
            "counts": {k: 0 for k in CATEGORIES},
            "moves": {k: [] for k in CATEGORIES},
        },
        "black": {
            "counts": {k: 0 for k in CATEGORIES},
            "moves": {k: [] for k in CATEGORIES},
        },
    }

    # Performance tracking
    total_cp_loss = {"white": 0.0, "black": 0.0}
    total_moves = {"white": 0, "black": 0}

    # Set up initial position
    board = game.board()
    
    # Position history for frontend replay
    fen_history: List[str] = [board.fen()]
    moves_meta: List[Dict[str, Any]] = []

    # Verify Stockfish is available
    if not os.path.exists(STOCKFISH_PATH):
        logger.error(f"Stockfish not found at {STOCKFISH_PATH}")
        raise FileNotFoundError(f"Stockfish engine not found at {STOCKFISH_PATH}. Please ensure Stockfish is installed and accessible.")

    # Initialize and configure Stockfish
    try:
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        
        # Configure engine settings
        config = {'Threads': int(threads), 'Hash': int(hash_mb)}
        if syzygy_path:
            config['SyzygyPath'] = syzygy_path
            
        try:
            engine.configure(config)
            logger.info(f"Engine configured with: {config}")
        except Exception as e:
            logger.warning(f"Some engine configuration failed: {e}")
    except Exception as e:
        logger.error(f"Failed to start Stockfish: {e}")
        raise RuntimeError(f"Failed to initialize Stockfish engine: {e}")

    try:
        # Main analysis loop: evaluate each position before and after moves
        for move in game.mainline_moves():
            try:
                mover_color = board.turn
                side = "white" if mover_color == chess.WHITE else "black"
                move_number = board.fullmove_number

                # Validate move legality
                if not board.is_legal(move):
                    logger.warning(f"Illegal move found in game: {move} at move {move_number}")
                    board.push(move)
                    continue
                    
                logger.debug(f"Analyzing {side}'s move {move} at position {move_number}")
            except Exception as e:
                logger.error(f"Error analyzing move {move}: {e}")
                continue

                # Evaluate position before the move
                try:
                    # Set analysis limits (time or depth based)
                    limit = chess.engine.Limit(time=time_limit) if use_time else chess.engine.Limit(depth=depth)
                    
                    # Handle multiple principal variations if requested
                    if multipv and int(multipv) > 1:
                        try:
                            # First try direct multipv parameter
                            info_before = engine.analyse(board, limit, multipv=int(multipv))
                        except TypeError:
                            # Fallback: configure engine and retry
                            try:
                                engine.configure({'MultiPV': int(multipv)})
                                info_before = engine.analyse(board, limit)
                            except Exception as e:
                                logger.warning(f"MultiPV configuration failed: {e}")
                                info_before = engine.analyse(board, limit)
                    else:
                        info_before = engine.analyse(board, limit)
                        
                    logger.debug(f"Pre-move analysis complete for move {move_number}")
                except Exception as e:
                    logger.error(f"Engine analysis failed: {e}")
                    board.push(move)
                    continue

                # Process engine analysis results
                best_move = None
                best_uci_list = []
                score_before = None
                
                if info_before is not None:
                    try:
                        # Handle multiple PVs (list format) vs single PV (dict format)
                        if isinstance(info_before, list):
                            # Extract all principal variations
                            for entry in info_before:
                                if not isinstance(entry, dict): continue
                                pv = entry.get('pv', [])
                                if pv and len(pv) > 0:
                                    try:
                                        best_uci_list.append(pv[0].uci())
                                    except Exception as e:
                                        logger.debug(f"Failed to get UCI for PV: {e}")
                            
                            # Primary best move is from first PV
                            if len(info_before) > 0 and isinstance(info_before[0], dict):
                                pv0 = info_before[0].get('pv', [])
                                if pv0 and len(pv0) > 0:
                                    best_move = pv0[0]
                                # Get score from first PV
                                score_obj = info_before[0].get('score')
                                if score_obj:
                                    try:
                                        score_before = score_obj.pov(mover_color).score(mate_score=MATE_SCORE)
                                    except Exception as e:
                                        logger.debug(f"Failed to convert score: {e}")
                                        
                        else:  # Single PV (dict format)
                            pv = info_before.get('pv', [])
                            if pv and len(pv) > 0:
                                best_move = pv[0]
                                try:
                                    best_uci_list = [m.uci() for m in pv]
                                except Exception:
                                    if best_move:
                                        try:
                                            best_uci_list = [best_move.uci()]
                                        except Exception:
                                            best_uci_list = []
                            
                            # Get score for single PV
                            score_obj = info_before.get('score')
                            if score_obj:
                                try:
                                    score_before = score_obj.pov(mover_color).score(mate_score=MATE_SCORE)
                                except Exception as e:
                                    logger.debug(f"Failed to convert score: {e}")
                                    
                    except Exception as e:
                        logger.error(f"Failed to process engine analysis: {e}")
                        best_move = None
                        best_uci_list = []
                        score_before = None

                # Play the actual move
                board.push(move)
                fen_history.append(board.fen())

                # Evaluate position after the move
                try:
                    limit_after = chess.engine.Limit(time=time_limit) if use_time else chess.engine.Limit(depth=depth)
                    info_after = engine.analyse(board, limit_after)
                    
                    # Extract score after move
                    score_after = None
                    if info_after and isinstance(info_after, dict):
                        score_obj = info_after.get('score')
                        if score_obj:
                            try:
                                score_after = score_obj.pov(mover_color).score(mate_score=MATE_SCORE)
                            except Exception as e:
                                logger.debug(f"Failed to convert after-move score: {e}")
                except Exception as e:
                    logger.error(f"After-move analysis failed: {e}")
                    info_after = None
                    score_after = None

                # Calculate centipawn loss
                cp_loss = 0.0
                if score_before is not None and score_after is not None:
                    try:
                        cp_loss = float(score_before) - float(score_after)
                        cp_loss = max(0.0, cp_loss)  # Ensure non-negative
                    except Exception as e:
                        logger.debug(f"Failed to calculate cp_loss: {e}")
                        cp_loss = 0.0

                # Check if played move was engine's best
                try:
                    is_best_move = best_move is not None and move == best_move
                except Exception:
                    logger.debug("Failed to compare with best move")
                    is_best_move = False

                # Classify move quality
                cat = classify_cp_loss(int(round(cp_loss)), is_best_move)
                stats[side]["counts"][cat] += 1
                stats[side]["moves"][cat].append(move_number)

                # Update totals
                total_cp_loss[side] += cp_loss
                total_moves[side] += 1

                # Record move metadata for frontend
                move_meta = {
                    'ply_index': len(fen_history) - 2,  # Index of position before this move
                    'move_number': move_number,
                    'side': side,
                    'cp_loss': cp_loss,
                    'category': cat,
                }

                # Add UCI move strings (with error handling)
                try:
                    move_meta['played_uci'] = move.uci()
                except Exception:
                    move_meta['played_uci'] = None

                try:
                    move_meta['best_uci'] = best_move.uci() if best_move else None
                except Exception:
                    move_meta['best_uci'] = None

                move_meta['best_uci_list'] = best_uci_list or []

                # Generate human-readable explanation
                def reason_for_category(category: str) -> str:
                    """Generate a human-readable explanation for move categories."""
                    mapping = {
                        'brilliant': 'A brilliant tactical idea that gained decisive advantage.',
                        'great': 'A very strong move that maintains or increases advantage.',
                        'best': 'Engine agrees — this was the best move available.',
                        'excellent': 'An excellent move that improves the position.',
                        'good': 'A good solid move that maintains the position.',
                        'inaccuracy': 'A small inaccuracy that slightly weakens the position.',
                        'mistake': 'A significant mistake that loses advantage.',
                        'blunder': 'A serious error that loses material or position.'
                    }
                    return mapping.get(category, 'Move classification unavailable.')

                # Add explanation to move metadata
                move_meta['reason'] = reason_for_category(move_meta['category'])
                moves_meta.append(move_meta)

    finally:
        # Ensure engine is properly closed
        try:
            engine.quit()
        except Exception as e:
            logger.error(f"Failed to cleanly close engine: {e}")

    # Return complete analysis results
    return {
        'white': stats['white'],
        'black': stats['black'],
        'fen_history': fen_history,
        'moves_meta': moves_meta,
        'analysis_params': {
            'engine_path': STOCKFISH_PATH,
            'depth': depth,
            'multipv': multipv,
            'use_time': use_time,
            'time_limit': time_limit,
            'threads': threads,
            'hash_mb': hash_mb,
            'syzygy_path': syzygy_path,
        }
    }

import chess.pgn
import chess.engine

# -------- CONFIG --------
MATE_SCORE = 100000

CATEGORIES = [
    "brilliant",
    "great",
    "best",
    "excellent",
    "good",
    "inaccuracy",
    "mistake",
    "blunder",
    # 'missed' removed to keep each move in exactly one category
]

THRESHOLDS_CP = {
    "great": 10,
    "excellent": 30,
    "good": 75,
    "inaccuracy": 150,
    "mistake": 300,
}


def get_stockfish_path() -> str:
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "stockfish"))
    if platform.system() == "Windows":
        return os.path.join(base, "stockfish.exe")
    return os.path.join(base, "stockfish")


STOCKFISH_PATH = get_stockfish_path()


def classify_cp_loss(cp_loss: int, is_best_move: bool) -> str:
    if cp_loss == 0 and is_best_move:
        return "best"
    if cp_loss == 0:
        return "great"
    if cp_loss <= THRESHOLDS_CP["great"]:
        return "great"
    if cp_loss <= THRESHOLDS_CP["excellent"]:
        return "excellent"
    if cp_loss <= THRESHOLDS_CP["good"]:
        return "good"
    if cp_loss <= THRESHOLDS_CP["inaccuracy"]:
        return "inaccuracy"
    if cp_loss <= THRESHOLDS_CP["mistake"]:
        return "mistake"
    return "blunder"


def chesscom_accuracy_from_acl(acl: float) -> float:
    """
    Approximate Chess.com-style formula based on curve fit.
    accuracy ≈ 103.3979 − 0.3820659 * ACL − 0.002169231 * ACL^2
    """
    acc = 103.3979 - 0.3820659 * acl - 0.002169231 * (acl ** 2)
    acc = max(0.0, min(100.0, acc))
    return round(acc, 2)


def analyze_game(pgn_text: str,
                 depth: int = 15,
                 multipv: int = 1,
                 use_time: bool = False,
                 time_limit: float = 0.08,
                 threads: int = 1,
                 hash_mb: int = 16,
                 syzygy_path: str = None) -> Dict[str, Any]:
    """Analyze a single PGN game and return per-side statistics.

    Args:
        pgn_text: The PGN text to analyze
        depth: Stockfish search depth (default: 15, min: 5, max: 25)

    Returns:
        Dict with counts and per-category move number lists.
    """
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("Invalid PGN provided")

    # Initialize stats with counts and lists of move numbers for each category
    stats = {
        "white": {
            "counts": {k: 0 for k in CATEGORIES},
            "moves": {k: [] for k in CATEGORIES},
        },
        "black": {
            "counts": {k: 0 for k in CATEGORIES},
            "moves": {k: [] for k in CATEGORIES},
        },
    }

    total_cp_loss = {"white": 0.0, "black": 0.0}
    total_moves = {"white": 0, "black": 0}

    board = game.board()

    # We will record the FEN after each ply so frontend can step through positions
    fen_history: List[str] = [board.fen()]
    moves_meta: List[Dict[str, Any]] = []

    # Verify stockfish exists
    if not os.path.exists(STOCKFISH_PATH):
        raise FileNotFoundError(f"Stockfish not found at {STOCKFISH_PATH}")

    # Use engine context to ensure clean shutdown and configure engine for reproducible results
    with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
        # Configure common UCI options (best-effort; not all engines expose the same options)
        try:
            engine.configure({'Threads': int(threads), 'Hash': int(hash_mb)})
            if syzygy_path:
                try:
                    engine.configure({'SyzygyPath': syzygy_path})
                except Exception:
                    # Not all engine wrappers accept SyzygyPath; ignore if unsupported
                    pass
        except Exception:
            # ignore config errors and proceed
            pass

        # Iterate through every move and evaluate before and after the move
        for move in game.mainline_moves():
            mover_color = board.turn
            side = "white" if mover_color == chess.WHITE else "black"
            move_number = board.fullmove_number

            # Safety: skip illegal moves (shouldn't normally happen)
            if not board.is_legal(move):
                # record as missed if you like, but skip for now
                board.push(move)
                continue

            # Engine evaluation before the move (get best move and score)
            try:
                # attempt to request multiple PVs if configured; prefer time-based limits for reproducibility if requested
                limit = chess.engine.Limit(time=time_limit) if use_time else chess.engine.Limit(depth=depth)
                if multipv and int(multipv) > 1:
                    try:
                        # many engines accept a multipv kwarg; try that first
                        info_before = engine.analyse(board, limit, multipv=int(multipv))
                    except TypeError:
                        # Some wrappers return a list when multipv is configured via engine.configure
                        try:
                            engine.configure({'MultiPV': int(multipv)})
                        except Exception:
                            pass
                        info_before = engine.analyse(board, limit)
                else:
                    info_before = engine.analyse(board, limit)
            except Exception:
                # If engine fails, push move and continue
                board.push(move)
                continue

            # Extract best move(s). Handle both single-dict and list-of-dicts responses for MultiPV
            best_move = None
            best_uci_list = []
            if info_before is not None:
                # If engine.analyse returned a list (multiple PVs), normalize it
                try:
                    if isinstance(info_before, list):
                        # each entry may contain 'pv' and 'score'
                        for entry in info_before:
                            pv = entry.get('pv') if isinstance(entry, dict) else None
                            if pv and len(pv) > 0:
                                try:
                                    best_uci_list.append(pv[0].uci())
                                except Exception:
                                    pass
                        # primary best move is first entry's pv[0] when present
                        first_entry = info_before[0] if len(info_before) > 0 else None
                        if first_entry and isinstance(first_entry, dict):
                            pv0 = first_entry.get('pv')
                            if pv0 and len(pv0) > 0:
                                best_move = pv0[0]
                    else:
                        pv = info_before.get("pv") if isinstance(info_before, dict) else None
                        if pv:
                            best_move = pv[0]
                            try:
                                best_uci_list = [m.uci() for m in pv]
                            except Exception:
                                if best_move is not None:
                                    try:
                                        best_uci_list = [best_move.uci()]
                                    except Exception:
                                        best_uci_list = []
                except Exception:
                    # Fallback: try to extract single pv field
                    try:
                        pv = info_before.get("pv") if isinstance(info_before, dict) else None
                        if pv:
                            best_move = pv[0]
                            best_uci_list = [m.uci() for m in pv]
                    except Exception:
                        best_move = None
                        best_uci_list = []

            # Extract score for the primary PV (handle list or dict formats)
            score_before_obj = None
            score_before = None
            try:
                if isinstance(info_before, list) and len(info_before) > 0 and isinstance(info_before[0], dict):
                    score_before_obj = info_before[0].get('score')
                elif isinstance(info_before, dict):
                    score_before_obj = info_before.get('score')
                if score_before_obj is not None:
                    try:
                        # Convert to centipawn value respecting mate handling
                        score_before = score_before_obj.pov(mover_color).score(mate_score=MATE_SCORE)
                    except Exception:
                        score_before = None
            except Exception:
                score_before_obj = None
                score_before = None

            # Play the actual move
            board.push(move)

            # record FEN after this move
            fen_history.append(board.fen())

            # Engine evaluation after the move (from same mover's perspective)
            try:
                limit_after = chess.engine.Limit(time=time_limit) if use_time else chess.engine.Limit(depth=depth)
                info_after = engine.analyse(board, limit_after)
            except Exception:
                info_after = None

            score_after_obj = info_after.get("score") if info_after and isinstance(info_after, dict) else None
            score_after = None
            if score_after_obj is not None:
                try:
                    score_after = score_after_obj.pov(mover_color).score(mate_score=MATE_SCORE)
                except Exception:
                    score_after = None

            # Compute centipawn loss (non-negative)
            cp_loss = 0.0
            if score_before is not None and score_after is not None:
                try:
                    cp_loss = float(score_before) - float(score_after)
                    if cp_loss < 0:
                        cp_loss = 0.0
                except Exception:
                    cp_loss = 0.0

            # Determine if the move played was the engine's best move
            try:
                is_best_move = best_move is not None and move == best_move
            except Exception:
                is_best_move = False

            # Classify and record
            cat = classify_cp_loss(int(round(cp_loss)), is_best_move)
            stats[side]["counts"][cat] += 1
            stats[side]["moves"][cat].append(move_number)
            # Each move is counted in exactly one category; previous logic also
            # added a 'missed' bucket for mistakes/blunders which caused duplicates.
            # We intentionally avoid adding duplicate buckets here so classification
            # is exclusive.

            total_cp_loss[side] += cp_loss
            total_moves[side] += 1

            # Persist per-move metadata for frontend (played move, best move, classification)
            try:
                played_uci = move.uci()
            except Exception:
                played_uci = None
            try:
                best_uci = best_move.uci() if best_move is not None else None
            except Exception:
                best_uci = None
            # ensure best_uci_list is present and as UCI strings
            try:
                if not best_uci_list and best_uci:
                    best_uci_list = [best_uci]
            except Exception:
                best_uci_list = []

            # Simple reason generator (human-readable explanation stub)
            def reason_for_category(category: str) -> str:
                mapping = {
                    'brilliant': 'A brilliant tactical idea that gained decisive advantage.',
                    'great': 'A very strong move that keeps an advantage.',
                    'best': 'Engine agrees — the best move in the position.',
                    'excellent': 'An excellent move improving the position.',
                    'good': 'A good solid move.',
                    'inaccuracy': 'A small inaccuracy that slightly worsened the position.',
                    'mistake': 'A mistake that lost significant advantage or material.',
                    'blunder': 'A blunder that lost material or allowed decisive tactics.'
                }
                return mapping.get(category, '')

            # The engine evaluation (best_move) was computed for the position BEFORE the
            # played move. To make frontend mapping intuitive (fen_history index ->
            # best move to play from that position), record ply_index as the index
            # of the position BEFORE the move.
            prev_index = max(0, len(fen_history) - 2)
            moves_meta.append({
                'ply_index': prev_index,  # index into fen_history for the position before the move
                'move_number': move_number,
                'side': side,
                'played_uci': played_uci,
                'best_uci': best_uci,
                'best_uci_list': best_uci_list,
                'cp_loss': cp_loss,
                'category': cat,
                'reason': reason_for_category(cat),
            })

    # Remove accuracy - frontend requested counts and moves only

    # Return stats plus fen history and per-move metadata for frontend UI
    return {
        'white': stats['white'],
        'black': stats['black'],
        'fen_history': fen_history,
        'moves_meta': moves_meta,
        'analysis_params': {
            'engine_path': STOCKFISH_PATH,
            'depth': depth,
            'multipv': multipv,
            'use_time': use_time,
            'time_limit': time_limit,
            'threads': threads,
            'hash_mb': hash_mb,
            'syzygy_path': syzygy_path,
        }
    }
