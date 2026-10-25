"""Parse HY-TEK Meet Manager "Performance List" pages from RecordTiming.

The NCAA's accepted, declared and qualifier lists are fixed-width text in a
<pre> block. Columns move between years, so each event's own column heading
line gives the positions. Pages are identified by their own header, never by
filename.
"""

from datetime import datetime
import re

from bs4 import BeautifulSoup

# HY-TEK event headings, with entry counts and round words removed, to the
# archive's TFRRS event names.
EVENT_NAMES = {
    "60 Meter Dash": "60 Meters",
    "100 Meter Dash": "100 Meters",
    "200 Meter Dash": "200 Meters",
    "400 Meter Dash": "400 Meters",
    "800 Meter Run": "800 Meters",
    "1500 Meter Run": "1500 Meters",
    "1 Mile Run": "Mile",
    "Mile Run": "Mile",
    "3000 Meter Run": "3000 Meters",
    "5000 Meter Run": "5000 Meters",
    "10000 Meter Run": "10,000 Meters",
    "3000 Meter Steeplechase": "3000 Steeplechase",
    "60 Meter Hurdles": "60 Hurdles",
    "100 Meter Hurdles": "100 Hurdles",
    "110 Meter Hurdles": "110 Hurdles",
    "400 Meter Hurdles": "400 Hurdles",
    "4x100 Meter Relay": "4 x 100 Relay",
    "4x400 Meter Relay": "4 x 400 Relay",
    "Distance Medley": "Distance Medley Relay",
    "Distance Medley Relay": "Distance Medley Relay",
    "High Jump": "High Jump",
    "Pole Vault": "Pole Vault",
    "Long Jump": "Long Jump",
    "Triple Jump": "Triple Jump",
    "Shot Put": "Shot Put",
    "Weight Throw": "Weight Throw",
    "Discus Throw": "Discus",
    "Hammer Throw": "Hammer",
    "Javelin Throw": "Javelin",
    "Pentathlon": "Pentathlon",
    "Indoor Pentathlon": "Pentathlon",
    "Heptathlon": "Heptathlon",
    "Indoor Heptathlon": "Heptathlon",
    "Decathlon": "Decathlon",
    # Short headings, as on the 2018 indoor and some outdoor First Round lists.
    "60 m": "60 Meters",
    "60 m H": "60 Hurdles",
    "1 Mile": "Mile",
    "3000 m": "3000 Meters",
    "DMR": "Distance Medley Relay",
    "WT": "Weight Throw",
    "100 m": "100 Meters",
    "200 m": "200 Meters",
    "400 m": "400 Meters",
    "800 m": "800 Meters",
    "1500 m": "1500 Meters",
    "5000 m": "5000 Meters",
    "10000 m": "10,000 Meters",
    "3000 m SC": "3000 Steeplechase",
    "100 m H": "100 Hurdles",
    "110 m H": "110 Hurdles",
    "400 m H": "400 Hurdles",
    "4x100 m Rly": "4 x 100 Relay",
    "4x400 m Rly": "4 x 400 Relay",
    "HJ": "High Jump",
    "PV": "Pole Vault",
    "LJ": "Long Jump",
    "TJ": "Triple Jump",
    "SP": "Shot Put",
    "DT": "Discus",
    "HT": "Hammer",
    "JT": "Javelin",
}
MULTIS = {"Pentathlon", "Heptathlon", "Decathlon"}
GENDERS = {"Men": "m", "Women": "f"}
CLASSES = {"FR", "SO", "JR", "SR", "GR"}

HEADING = re.compile(r"Event\s+\d+\s+(Men|Women)\s+(.+?)\s*")
COUNT = re.compile(r"\s*\(\d+\)")
ROUND = re.compile(r"\s+(?:Prelims|Preliminaries|Finals?|Semis|Semi-Finals|Quarterfinals)$")
STAMP = re.compile(r"(?:HY-TEK's Meet Manager|Revised)\s+(\d{1,2}/\d{1,2}/\d{4})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?")
RULE = re.compile(r"={20,}")
SEED = re.compile(r"((?:\d+:)?\d+(?:\.\d+)?)(m)?([ADS])?")
RANKED = re.compile(r"\s*(\d+)\s+\S")
RUNNERS = re.compile(r"\s+\d\)")
RELAY_ROW = re.compile(r"\s*(\d+)\s+(.+?)\s+(\S+)\s*")
RELAY_TEAM = re.compile(r"\s+'[A-Z]'$")
DATES = re.compile(r"\s*-?\s*\d{1,2}/\d{1,2}/\d{4}\s+to\s+\d{1,2}/\d{1,2}/\d{4}\s*$")
REVIEW = re.compile(r"to be considered|coaches review|scratched", re.I)


def event_name(heading):
    """The archive's name for a HY-TEK event heading; anything unknown is an error."""
    name = ROUND.sub("", COUNT.sub("", heading)).strip()
    if name not in EVENT_NAMES:
        raise ValueError(f"Unrecognized HY-TEK event heading: {heading!r}")
    return EVENT_NAMES[name]


def parse_seed(text):
    """A seed without its m and D/A/S suffixes, and the status letter."""
    match = SEED.fullmatch(text)
    if not match:
        raise ValueError(f"Unrecognized seed: {text!r}")
    return match[1], match[3]


def _generated(lines):
    for line in lines:
        match = STAMP.search(line)
        if match:
            day = datetime.strptime(match[1], "%m/%d/%Y")
            if match[2] is None:
                return day.strftime("%Y-%m-%d")
            clock = datetime.strptime(re.sub(r"\s+", " ", match[2]), "%I:%M %p")
            return day.replace(hour=clock.hour, minute=clock.minute).strftime("%Y-%m-%dT%H:%M")
    return None


def _meet(lines):
    """The meet's title lines, from the NCAA line to the line before Performance List."""
    start = next((i for i, line in enumerate(lines) if "NCAA" in line), None)
    if start is None:
        raise ValueError("No NCAA meet name in the page header")
    title = []
    for line in lines[start:]:
        if line.strip() == "Performance List":
            break
        if line.strip():
            title.append(line.strip())
    return title


def _classify(title, page_text, events):
    meet = " ".join(title)
    if not re.search(r"\bNCAA\b", meet) or not re.search(r"Division (?:I|1)\b", meet):
        raise ValueError(f"Not an NCAA Division I list: {meet}")
    regions = set(re.findall(r"\b(East|West)\s+(?:First Rounds?|Preliminary|Prelims?|Regionals?)\b", meet))
    if len(regions) > 1:
        raise ValueError(f"Page names two regions: {meet}")
    if not regions and any(re.search(r"\b(?:East|West)\b", line) for line in title if "Championship" in line):
        raise ValueError(f"Unrecognized region in {meet}")
    region = regions.pop() if regions else "National"
    statuses = {entry["status"] for event in events for entry in event["entries"]}
    # Review pages mark each athlete A or S. A declared list may mark them too, with D
    # for those in the meet, as the 2016 decathlon and heptathlon lists do.
    if REVIEW.search(page_text) and "D" not in statuses:
        return "other", region
    if "Indoor" in meet:
        if region != "National":
            raise ValueError(f"Indoor list with a region: {meet}")
        return "accepted", region
    if "Outdoor" not in meet:
        raise ValueError(f"Neither indoor nor outdoor: {meet}")
    if region != "National":
        return "accepted", region
    if events and all(event["event"] in MULTIS for event in events):
        return "multi", region
    return "qualifiers", region


def _columns(header):
    """Positions of the Name, Year and School headings in an event's column heading line."""
    positions = {}
    for label in ("Name", "Year", "School"):
        found = re.search(rf"\b{label}\b", header)
        positions[label] = found.start() if found else None
    return positions


def _individual(line, columns, event):
    name_at, year_at, school_at = columns["Name"], columns["Year"], columns["School"]
    if name_at is None or school_at is None:
        raise ValueError(f"No Name or School column in {event}")
    rank = RANKED.match(line)
    if not rank or (name_at and line[name_at - 1:name_at] != " "):
        raise ValueError(f"Unreadable entry in {event}: {line!r}")
    left = line[:school_at].rstrip()
    athlete_class = None
    year = re.search(r"\s(\S+)$", left)
    if year_at is not None and year and year.start(1) >= year_at:
        if year[1] not in CLASSES:
            raise ValueError(f"Unrecognized class in {event}: {line!r}")
        athlete_class = year[1]
        left = left[:year.start()]
    name = left[name_at:].strip()
    if "," in name:
        # A few lists write "Last, First".
        surname, _, first = name.partition(",")
        name = f"{first.strip()} {surname.strip()}"
    prefix = line[:name_at].split()
    if not name or len(prefix) > 2 or not all(part.isdigit() for part in prefix):
        raise ValueError(f"Unreadable entry in {event}: {line!r}")
    right = line[school_at:].rstrip()
    seed_text = right.split()[-1] if right.split() else ""
    school = right[:len(right) - len(seed_text)].strip()
    if not school:
        raise ValueError(f"No school in {event}: {line!r}")
    seed, status = parse_seed(seed_text)
    return dict(rank=int(rank[1]), name=name, **{"class": athlete_class}, school=school,
                seed=seed, status=status)


def _relay(line, event):
    match = RELAY_ROW.fullmatch(line)
    if not match:
        raise ValueError(f"Unreadable relay entry in {event}: {line!r}")
    school = RELAY_TEAM.sub("", match[2]).strip()
    seed, status = parse_seed(match[3])
    return dict(rank=int(match[1]), name=school, **{"class": None}, school=school,
                seed=seed, status=status)


def _events(lines):
    events, index = [], 0
    while index < len(lines):
        heading = HEADING.fullmatch(lines[index].rstrip())
        if not heading:
            if lines[index].strip().startswith("Event "):
                raise ValueError(f"Unrecognized event line: {lines[index]!r}")
            index += 1
            continue
        gender, name = GENDERS[heading[1]], event_name(heading[2])
        relay = "Relay" in name
        # The column headings are the line before the second rule; notes may sit between.
        rules = [i for i in range(index + 1, min(index + 12, len(lines))) if RULE.fullmatch(lines[i].strip())]
        if len(rules) < 2:
            raise ValueError(f"No column headings for {name}")
        columns = _columns(lines[rules[1] - 1])
        entries, index = [], rules[1] + 1
        while index < len(lines) and lines[index].strip() and not HEADING.fullmatch(lines[index].rstrip()):
            line = lines[index].rstrip()
            index += 1
            if relay and RUNNERS.match(line):
                continue
            entries.append(_relay(line, name) if relay else _individual(line, columns, name))
        if not entries:
            raise ValueError(f"No entries for {name}")
        events.append(dict(gender=gender, event=name, relay=relay, entries=entries))
    return events


def decode(body):
    """Most pages are Windows-1252; a few are UTF-8."""
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("cp1252", errors="replace")


def parse_performance_list(html):
    """The page's meet, generated time, kind, region and every event's entries.

    `html` may be the page's bytes or text."""
    if isinstance(html, bytes):
        html = decode(html)
    soup = BeautifulSoup(html, "html.parser")
    blocks = soup.find_all("pre")
    if not blocks:
        raise ValueError("No HY-TEK listing in the page")
    for block in blocks:
        # Hand-edited lists sometimes break a line with <br>.
        for br in block.find_all("br"):
            br.replace_with("\n")
    text = "\n".join(block.get_text() for block in blocks).replace("\r", "")
    lines = text.split("\n")
    first_event = next((i for i, line in enumerate(lines) if HEADING.fullmatch(line.rstrip())), None)
    if first_event is None or not any(line.strip() == "Performance List" for line in lines[:first_event]):
        raise ValueError("Not a HY-TEK Performance List")
    header = lines[:first_event]
    title = _meet(header)
    events = _events(lines[first_event:])
    for block in blocks:
        block.extract()
    outside = soup.get_text(" ", strip=True)
    kind, region = _classify(title, outside, events)
    meet = DATES.sub("", " ".join(title)).strip()
    return dict(meet=meet, generated=_generated(header), kind=kind, region=region, events=events)
