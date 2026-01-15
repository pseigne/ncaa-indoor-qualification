import requests
from bs4 import BeautifulSoup
from pprint import pprint
import pandas as pd
import json
import os
from datetime import datetime

url = "https://tf.tfrrs.org/lists/5352/2025_2026_NCAA_Division_I_Indoor_Qualifying_List?gender="

# 1. Define Headers to mimic a browser
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",  # Tells the server you can accept JSON
    "Referer": "https://www.tfrrs.org/", # Tells the server you came from their main site
}

# 2. Pass the headers argument into the request
response = requests.get(url, headers=headers)

if response.status_code == 200:
    print("Success!")
    # data = response.json() # Since this is an API, use .json(), not BeautifulSoup
    # print(data)
else:
    print(f"Error: {response.status_code}")
    

soup = BeautifulSoup(response.text, "html.parser")

# 1. Find the "Event Titles" first. 
# In your HTML, every event starts with a div class="custom-table-title"
event_headers = soup.find_all("div", class_="custom-table-title")

data = []

for header in event_headers:
    # 2. Extract the Event Name (e.g., "Mile") from the <h3> tag inside the header
    event_name = header.find("h3").get_text(strip=True)
    
    # 3. Find the specific list of results for THIS event
    # In the HTML, the results list is the immediate neighbor (sibling) of the title
    results_table = header.find_next_sibling("div", class_="performance-list")
    
    if results_table:
        # 4. Now find rows ONLY inside this specific event's table
        rows = results_table.find_all("div", class_="performance-list-row")
        
        for row in rows:
            athlete_div = row.find("div", attrs={"data-label": "Athlete"})
            time_div = row.find("div", attrs={"data-label": "Time"})
            
            athlete_name = athlete_div.get_text(strip=True) if athlete_div else "N/A"
            time_text = time_div.get_text(strip=True) if time_div else "N/A"
            
            # Save properly
            data.append({
                "Event": event_name,
                "Athlete": athlete_name,
                "Time": time_text
            })

df = pd.DataFrame(data)

df_merged = df.groupby('Event')


final_json_data = []

# Unpack the tuple immediately for clarity
for event_name, event_df in df_merged:
    
    # We use .iloc to look at positions 0 to 16
    top_16 = event_df.iloc[:20]
    
    # Create a dictionary for this specific event
    event_entry = {
        "event": event_name,
        "rankings": []
    }
    
    # Iterate through these top rows
    for i, (index, row) in enumerate(top_16.iterrows(), start=1):
        
        # Add athlete info to the rankings list
        event_entry["rankings"].append({
            "rank": i,
            "athlete": row['Athlete'],
            "time": row['Time']
        })
    
    # Add the completed event to the final list
    final_json_data.append(event_entry)

today = datetime.now().strftime('%Y-%m-%d')

# Write the list to a JSON file
with open(f'./data/tfrrs_data ({today}).json', 'w', encoding='utf-8') as f:
    json.dump(final_json_data, f, indent=4, ensure_ascii=False)

print("Data exported to tfrrs_data.json")


# FROM GOOGLE GEMINI

# ==========================================
# 5. UPDATE THE MANIFEST FILE (dates.json)
# ==========================================
manifest_path = './data/dates.json'
existing_dates = []

# Load existing dates if the file exists
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, 'r') as f:
            existing_dates = json.load(f)
    except json.JSONDecodeError:
        existing_dates = []

# Add today's date if it isn't already in the list
if today not in existing_dates:
    existing_dates.append(today)
    # Optional: Sort dates so the graph is always in order
    existing_dates.sort()
    
    with open(manifest_path, 'w') as f:
        json.dump(existing_dates, f, indent=4)
    print(f"Updated manifest: {today} added to dates.json")
else:
    print(f"Manifest up to date: {today} already exists.")