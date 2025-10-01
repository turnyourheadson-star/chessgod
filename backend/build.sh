#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "Installing system dependencies..."
apt-get update && apt-get install -y wget unzip

echo "Setting up Stockfish..."
# Create stockfish directory
mkdir -p stockfish

# Download Stockfish
wget https://stockfishchess.org/files/stockfish_15.1_linux_x64.zip
unzip stockfish_15.1_linux_x64.zip
mv stockfish_15.1_linux_x64/stockfish_15.1_x64 stockfish/stockfish
chmod +x stockfish/stockfish

# Verify Stockfish installation
echo "Verifying Stockfish installation..."
./stockfish/stockfish --version

echo "Installing Python dependencies..."
python -m pip install --upgrade pip
pip install -r requirements.txt

echo "Build completed successfully!"