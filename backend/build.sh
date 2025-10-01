#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "Setting up Stockfish..."
mkdir -p stockfish

# Download Stockfish directly from GitHub releases
STOCKFISH_URL="https://github.com/official-stockfish/Stockfish/releases/download/sf_16_1/stockfish-ubuntu-20.04-x86-64"

echo "Downloading Stockfish from GitHub..."
wget -O stockfish/stockfish $STOCKFISH_URL

echo "Making Stockfish executable..."
chmod +x stockfish/stockfish

# Verify Stockfish installation
echo "Verifying Stockfish installation..."
./stockfish/stockfish --version

echo "Installing Python dependencies..."
python -m pip install --upgrade pip
pip install -r requirements.txt

echo "Build completed successfully!"
