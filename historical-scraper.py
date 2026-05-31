import requests
from bs4 import BeautifulSoup
import json
import os
import time
import re


# Fully mapped historical list IDs across seasons and regional sites
# Comprehensive 10-Year NCAA Division I Qualifying List Configuration (2016-2026)
CONFIGS_TO_SCRAPE = [
    # --- 2026 SEASON ---
    {"year": "2026", "season": "outdoor", "region": "East", "list_id": "5622", "list_name": "NCAA_Div_I_East_Outdoor_List"},
    {"year": "2026", "season": "outdoor", "region": "West", "list_id": "5623", "list_name": "NCAA_Div_I_West_Outdoor_List"},
    {"year": "2026", "season": "outdoor", "region": "National", "list_id": "5624", "list_name": "NCAA_Div_I_Outdoor_Multis_List"},
    {"year": "2025_2026", "season": "indoor", "region": "National", "list_id": "5352", "list_name": "2025_2026_NCAA_Division_I_Indoor_Qualifying_List"},

    # --- 2025 SEASON ---
    {"year": "2025", "season": "outdoor", "region": "East", "list_id": "5055", "list_name": "NCAA_Div_I_East_Outdoor_Qualifying_List"},
    {"year": "2025", "season": "outdoor", "region": "West", "list_id": "5056", "list_name": "NCAA_Div_I_West_Outdoor_Qualifying_List"},
    {"year": "2025", "season": "outdoor", "region": "National", "list_id": "5057", "list_name": "NCAA_Div_I_Outdoor_Multis_List"},
    {"year": "2024_2025", "season": "indoor", "region": "National", "list_id": "4867", "list_name": "2024_2025_NCAA_Division_I_Indoor_Qualifying"},

    # --- 2024 SEASON ---
    {"year": "2024", "season": "outdoor", "region": "East", "list_id": "4950", "list_name": "NCAA_Div_I_East_Outdoor_Qualifying_List"},
    {"year": "2024", "season": "outdoor", "region": "West", "list_id": "4951", "list_name": "NCAA_Div_I_West_Outdoor_Qualifying_List"},
    {"year": "2024", "season": "outdoor", "region": "National", "list_id": "4952", "list_name": "NCAA_Div_I_Outdoor_Multis_List"},
    {"year": "2023_2024", "season": "indoor", "region": "National", "list_id": "4364", "list_name": "2023_2024_NCAA_Division_I_Indoor_Qualifying_List"},

]

# --- trigger cutoffs regeneration at the end if you import new rosters ---

GENDERS = ["m", "f"]
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.tfrrs.org/",
}

directories = ['./data', './ncaa-qualification/public/data']
compiled_manifest_data = []

for cfg in CONFIGS_TO_SCRAPE:
    for gender in GENDERS:
        url = f"https://tf.tfrrs.org/lists/{cfg['list_id']}/{cfg['list_name']}?gender={gender}"
        print(f"Scraping Historical -> {cfg['year']} {cfg['season'].upper()} | Region: {cfg['region']} | Gender: {gender.upper()}")
        
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"❌ Failed to reach page (Error {response.status_code}). Skipping...")
            continue
            
        soup = BeautifulSoup(response.text, "html.parser")
        event_headers = soup.find_all("div", class_="custom-table-title")
        
        for header in event_headers:
            raw_event_name = header.find("h3").get_text(strip=True)
            # Standardize event name format
            event_name = raw_event_name.replace('\n', ' ').replace('\t', ' ')
            event_name = re.sub(r'\(.*?\)', '', event_name)
            event_name = event_name.replace("Men's", "").replace("Women's", "").replace("Men", "").replace("Women", "")
            event_name = re.sub(r'\s+', ' ', event_name).strip()
            
            results_table = header.find_next_sibling("div", class_="performance-list")
            
            if results_table:
                rows = results_table.find_all("div", class_="performance-list-row")
                
                # --- ACCURATE COMPILATION CUTOFFS ---
                if cfg["season"] == "outdoor":
                    if "4x" in event_name:
                        cutoff = 24  # Outdoor Relays top 24
                    elif cfg["region"] == "National":
                        cutoff = 24  # Multi-events
                    else:
                        cutoff = 48  # Standard Regional individual events top 48
                else:
                    cutoff = 12 if "4x" in event_name or "Distance Medley" in event_name else 16
                
                event_rankings = []
                # Scrape up to 60 athletes
                for i, row in enumerate(rows[:60], start=1):
                    athlete_div = row.find("div", attrs={"data-label": "Athlete"})
                    time_div = row.find("div", attrs={"data-label": "Time"})
                    team_div = row.find("div", attrs={"data-label": "Team"})
                    
                    athlete_name = athlete_div.get_text(strip=True) if athlete_div else "N/A"
                    time_text = time_div.get_text(strip=True) if time_div else "N/A"
                    team_text = team_div.get_text(strip=True) if team_div else "N/A"
                    
                    event_rankings.append({
                        "rank": i,
                        "athlete": athlete_name,
                        "team": team_text,
                        "time": time_text
                    })
                
                compiled_manifest_data.append({
                    "year": cfg["year"],
                    "season": cfg["season"],
                    "region": cfg["region"],
                    "gender": gender,
                    "event": event_name,
                    "rankings": event_rankings
                })
                
        time.sleep(1)

# --- READ EXISTING MASTER DATA TO PRESERVE HISTORY ---
master_file_name = 'tfrrs_historical_data.json'
primary_master_path = f'./ncaa-qualification/public/data/{master_file_name}'

existing_master_data = []
if os.path.exists(primary_master_path):
    try:
        with open(primary_master_path, 'r', encoding='utf-8') as f:
            existing_master_data = json.load(f)
    except Exception as e:
        print(f"Warning: Could not read existing master data: {e}")
        existing_master_data = []

# Filter out old copies of this historical year to prevent duplicates
keys_to_exclude = set()
for cfg in CONFIGS_TO_SCRAPE:
    for gender in GENDERS:
        for entry in compiled_manifest_data:
            event = entry["event"]
            keys_to_exclude.add((cfg["year"], cfg["season"], cfg["region"], gender, event))

reconciled_master_data = [
    item for item in existing_master_data
    if (item.get('year'), item.get('season'), item.get('region'), item.get('gender'), item.get('event')) not in keys_to_exclude
]

# Append new historical standings
for entry in compiled_manifest_data:
    reconciled_master_data.append(entry)

# --- WRITE COMPREHENSIVE RECONCILED DATA ---
for base_dir in directories:
    if os.path.exists(base_dir):
        output_file = f'{base_dir}/{master_file_name}'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(reconciled_master_data, f, indent=4, ensure_ascii=False)
        print(f"✅ Reconciled historical data sync pushed to {output_file}")

# --- TRIGGER AUTOMATIC LIGHTWEIGHT BUBBLE CUTOFF GENERATION ---
try:
    from generate_bubble_cutoffs import generate_cutoffs
    generate_cutoffs()
except Exception as e:
    print(f"Warning: Could not automatically generate bubble cutoffs: {e}")
