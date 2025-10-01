import requests
import time
import os
from threading import Thread

def keep_alive():
    while True:
        try:
            # Replace with your Render.com URL once deployed
            url = os.getenv('RENDER_EXTERNAL_URL', 'http://localhost:8000')
            
            # Sample game position for analysis
            sample_data = {
                "moves": ["e4", "e5", "Nf3"],  # Minimal game to analyze
                "platform": "test"
            }
            
            response = requests.post(f"{url}/analyze", json=sample_data)
            print(f"Keep-alive ping sent. Status: {response.status_code}")
            
            # Wait for 10 minutes
            time.sleep(600)
        except Exception as e:
            print(f"Keep-alive error: {e}")
            time.sleep(60)  # Wait a minute before retrying if there's an error

def start_keep_alive():
    keep_alive_thread = Thread(target=keep_alive, daemon=True)
    keep_alive_thread.start()