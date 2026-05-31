import json
import os
import re

directories = ['./data', './ncaa-qualification/public/data']
master_file_name = 'tfrrs_historical_data.json'
cutoff_file_name = 'tfrrs_bubble_cutoffs.json'
active_file_name = 'tfrrs_active_data.json'

def get_cutoff_rank(event_name, season, region):
    if season == "outdoor":
        if "4x" in event_name:
            return 24  # Outdoor Relays top 24
        elif region == "National":
            return 24  # Multi-events
        else:
            return 48  # Regional individual events
    else:
        # Indoor
        if "4x" in event_name or "Distance Medley" in event_name:
            return 12  # Relays
        else:
            return 16  # Individual

def generate_cutoffs():
    primary_master_path = f'./ncaa-qualification/public/data/{master_file_name}'
    if not os.path.exists(primary_master_path):
        print(f"❌ Primary master database not found at {primary_master_path}")
        return

    print(f"Loading master database from {primary_master_path}...")
    with open(primary_master_path, 'r', encoding='utf-8') as f:
        master_data = json.load(f)

    cutoff_records = []
    active_records = []
    
    # We will also group all master data by (season, gender, event) to write individual historical JSONs
    event_groups = {}
    
    for entry in master_data:
        year = entry.get("year", "")
        season = entry.get("season", "")
        region = entry.get("region", "")
        gender = entry.get("gender", "")
        event = entry.get("event", "")
        rankings = entry.get("rankings", [])
        
        # Calculate the proper cutoff rank for this event
        cutoff_rank = get_cutoff_rank(event, season, region)
        
        # Find the bubble athlete (fallback to the last available rank if the list is smaller)
        if rankings:
            actual_cutoff = min(cutoff_rank, len(rankings))
            bubble_entry = next((r for r in rankings if r.get("rank") == actual_cutoff), None)
            
            if bubble_entry:
                cutoff_records.append({
                    "year": year,
                    "season": season,
                    "region": region,
                    "gender": gender,
                    "event": event,
                    "cutoff_rank": actual_cutoff,
                    "cutoff_time": bubble_entry.get("time", "N/A"),
                    "cutoff_athlete": bubble_entry.get("athlete", "N/A"),
                    "cutoff_team": bubble_entry.get("team", "N/A")
                })
            
        # Standardize matching for the current active latest standings
        # We only keep live active standings (without daily progression parentheses)
        is_live_active = "(" not in year and year in ["2025-2026", "2026"]
        if is_live_active:
            active_records.append(entry)
            
        # Group entries for individual event files
        group_key = (season, gender, event)
        if group_key not in event_groups:
            event_groups[group_key] = []
        event_groups[group_key].append(entry)

    # Save to both target directories
    for base_dir in directories:
        if os.path.exists(base_dir):
            # Write cutoffs
            cutoff_output = f'{base_dir}/{cutoff_file_name}'
            with open(cutoff_output, 'w', encoding='utf-8') as f:
                json.dump(cutoff_records, f, indent=4, ensure_ascii=False)
            print(f"✅ Generated bubble cutoffs database written to {cutoff_output} ({len(cutoff_records)} records)")
            
            # Write active records
            active_output = f'{base_dir}/{active_file_name}'
            with open(active_output, 'w', encoding='utf-8') as f:
                json.dump(active_records, f, indent=4, ensure_ascii=False)
            print(f"✅ Generated active records database written to {active_output} ({len(active_records)} records)")

            # Write event-specific historical database files
            print(f"Generating individual event historical databases in {base_dir}...")
            for (season, gender, event), entries in event_groups.items():
                # Clean event name for filename
                clean_event_fn = re.sub(r'[^a-zA-Z0-9]', '_', event)
                clean_event_fn = re.sub(r'_+', '_', clean_event_fn).strip('_')
                
                event_output_file = f"{base_dir}/historical_{season}_{gender}_{clean_event_fn}.json"
                with open(event_output_file, 'w', encoding='utf-8') as f:
                    json.dump(entries, f, indent=4, ensure_ascii=False)
            print(f"✅ Finished writing event-specific JSONs for {len(event_groups)} events in {base_dir}")

if __name__ == "__main__":
    generate_cutoffs()
