"""Fetch and parse Flash Results pages for the outdoor First Rounds and nationals."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
import requests

BASE = Path(__file__).resolve().parent
CACHE_DIR = BASE / "data" / "results-cache"
CONFIG = BASE / "results_config.json"
USER_AGENT = ("ncaa-indoor-qualification seasonal import "
              "(https://github.com/pseigne/ncaa-indoor-qualification)")
DELAY = 3
REFUSAL_WAITS = (60, 120)

FIELD = {"high jump": "High Jump", "pole vault": "Pole Vault", "long jump": "Long Jump",
         "triple jump": "Triple Jump", "shot put": "Shot Put", "discus": "Discus",
         "discus throw": "Discus", "hammer": "Hammer", "hammer throw": "Hammer",
         "javelin": "Javelin", "javelin throw": "Javelin"}
MULTIS = {"decathlon": ("m", "Decathlon"), "heptathlon": ("f", "Heptathlon")}
FLAT = {"100", "200", "400", "800", "1500", "5000", "10000"}
HURDLES = {"m": {"110", "400"}, "f": {"100", "400"}}
_UNIT = r"\s*(?:m|meters?)?"
STATUS = {"DNS": "DNS", "SCR": "DNS", "DNF": "DNF", "DQ": "DQ", "NM": "NM", "NH": "NH",
          "FS": "FS", "X": "NM", "FOUL": "NM", "ND": "NM"}
WIND = re.compile(r"^(?:[+-]?\d{1,2}\.\d|NWI)$")
MARK_HEAD = re.compile(r"^(?:time|best(?: \w+)?|(?:\w+ )?mark|points|result|score|height|distance)$")
HEAT = re.compile(r"^(\d+)(?:\s*\((\d+)\))?")
ROUND_ORDER = ("prelim", "quarterfinal", "semifinal", "final")
EVENT_ORDER = ("100 Meters", "200 Meters", "400 Meters", "800 Meters", "1500 Meters", "5000 Meters",
               "10,000 Meters", "100 Hurdles", "110 Hurdles", "400 Hurdles", "3000 Steeplechase",
               "4 x 100 Relay", "4 x 400 Relay", "High Jump", "Pole Vault", "Long Jump", "Triple Jump",
               "Shot Put", "Discus", "Hammer", "Javelin", "Decathlon", "Heptathlon")


class HostBlocked(Exception):
    pass


class Robots:
    """robots.txt rules with * and $ patterns, matched the same way on every Python version.
    The longest matching rule wins and Allow wins a tie."""

    def __init__(self, text="", allow_all=False, disallow_all=False):
        self.allow_all = allow_all
        self.disallow_all = disallow_all
        self.groups = []
        agents, rules, in_rules = [], [], False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (part.strip() for part in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if in_rules:
                    self.groups.append((agents, rules))
                    agents, rules, in_rules = [], [], False
                agents.append(value.lower())
            elif key in ("allow", "disallow") and agents:
                in_rules = True
                if value:
                    rules.append((key == "allow", value))
        if agents:
            self.groups.append((agents, rules))

    def rules_for(self, agent):
        agent = agent.lower()
        named = [rules for agents, rules in self.groups if any(a != "*" and a in agent for a in agents)]
        if named:
            return [rule for rules in named for rule in rules]
        return [rule for agents, rules in self.groups if "*" in agents for rule in rules]

    def can_fetch(self, agent, url):
        if self.allow_all:
            return True
        if self.disallow_all:
            return False
        parts = urlparse(url)
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        best = None
        for allow, pattern in self.rules_for(agent):
            anchored = pattern.endswith("$")
            body = pattern[:-1] if anchored else pattern
            regex = ".*".join(re.escape(piece) for piece in body.split("*")) + ("$" if anchored else "")
            if re.match(regex, path) and (best is None or (len(pattern), allow) > best):
                best = (len(pattern), allow)
        return True if best is None else best[1]


def decode(body):
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("cp1252", "replace")


class Fetcher:
    """Polite cached fetching: robots.txt, 3 s per host, back off and stop on refusals."""

    def __init__(self, session=None, sleeper=time.sleep, cache_dir=CACHE_DIR,
                 clock=time.monotonic, delay=DELAY):
        self.session = session or requests.Session()
        self.sleeper = sleeper
        self.cache_dir = Path(cache_dir)
        self.clock = clock
        self.delay = delay
        self.last = {}
        self.robots = {}
        self.blocked = set()
        self.requests = 0

    def path_for(self, url):
        parts = urlparse(url)
        path = parts.path.lstrip("/") or "index.htm"
        if path.endswith("/"):
            path += "index.htm"
        return self.cache_dir / parts.netloc / path

    def _send(self, url):
        host = urlparse(url).netloc
        if host in self.last:
            remaining = self.delay - (self.clock() - self.last[host])
            if remaining > 0:
                self.sleeper(remaining)
        try:
            return self.session.get(url, timeout=(10, 45), headers={"User-Agent": USER_AGENT})
        finally:
            self.last[host] = self.clock()
            self.requests += 1

    def _request(self, url):
        host = urlparse(url).netloc
        waits = list(REFUSAL_WAITS)
        while True:
            if host in self.blocked:
                raise HostBlocked(host)
            response = self._send(url)
            if response.status_code not in (403, 429):
                return response
            if not waits:
                self.blocked.add(host)
                raise HostBlocked(f"{host} refused {url} with {response.status_code}")
            self.sleeper(waits.pop(0))

    def allowed(self, url):
        parts = urlparse(url)
        host = parts.netloc
        if host in self.blocked:
            raise HostBlocked(host)
        if host not in self.robots:
            robots_url = f"{parts.scheme}://{host}/robots.txt"
            response = self._send(robots_url)
            if response.status_code == 200:
                rules = Robots(response.text)
            elif response.status_code == 429:
                self.blocked.add(host)
                raise HostBlocked(f"{host} refused robots.txt with 429")
            elif 400 <= response.status_code < 500:
                # A missing robots file (S3 answers 403) means no rules.
                rules = Robots(allow_all=True)
            else:
                rules = Robots(disallow_all=True)
            self.robots[host] = rules
        return self.robots[host].can_fetch(USER_AGENT, url)

    def cached(self, url):
        path = self.path_for(url)
        meta_path = path.with_name(path.name + ".meta.json")
        if not meta_path.exists():
            return False, None
        meta = json.loads(meta_path.read_text())
        return True, decode(path.read_bytes()) if meta["status"] == 200 else None

    def get(self, url):
        """Return the page text, or None when it is missing or disallowed."""
        hit, text = self.cached(url)
        if hit:
            return text
        if not self.allowed(url):
            return None
        response = self._request(url)
        if response.status_code >= 500:
            return None
        path = self.path_for(url)
        path.parent.mkdir(parents=True, exist_ok=True)
        meta = {"url": url, "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "status": response.status_code}
        text = None
        if response.status_code == 200:
            body = response.content
            path.write_bytes(body)
            meta["sha256"] = hashlib.sha256(body).hexdigest()
            text = decode(body)
        path.with_name(path.name + ".meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        return text


class CacheOnly(Fetcher):
    """Read the cache and never touch the network."""

    def get(self, url):
        return self.cached(url)[1]


def event_name(text):
    """Map a Flash event label to (gender, archive event name), or None."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if re.search(r"wheelchair|exhibition|para\b|ambulatory|invitational|jump off", text, re.I):
        return None
    for word, (gender, name) in MULTIS.items():
        if re.fullmatch(rf"(?:(?:men|women)\s+)?{word}(?:\s+(?:spreadsheet|scores?)\b.*)?", text, re.I):
            return gender, name
    match = re.match(r"^(Men|Women)\s+(.+)$", text, re.I)
    if not match:
        return None
    gender = "m" if match.group(1).lower() == "men" else "f"
    rest = match.group(2).lower().strip()
    if rest in FIELD:
        return gender, FIELD[rest]
    if m := re.fullmatch(rf"(\d+){_UNIT}(?: dash| run)?", rest):
        if m.group(1) in FLAT:
            return gender, "10,000 Meters" if m.group(1) == "10000" else f"{m.group(1)} Meters"
    if m := re.fullmatch(rf"(\d+){_UNIT} hurdles", rest):
        if m.group(1) in HURDLES[gender]:
            return gender, f"{m.group(1)} Hurdles"
    if re.fullmatch(rf"3000{_UNIT} steeple(?:chase)?", rest):
        return gender, "3000 Steeplechase"
    if m := re.fullmatch(rf"4\s*x\s*(100|400){_UNIT} relay", rest):
        return gender, f"4 x {m.group(1)} Relay"
    return None


def round_key(label):
    label = (label or "").lower()
    if "quarter" in label:
        return "quarterfinal"
    if "semi" in label:
        return "semifinal"
    if "final" in label or "score" in label:
        return "final"
    return "prelim"


def parse_dates(text):
    """'Eugene, OR | June 11-14, 2025' -> '2025-06-11'."""
    match = re.search(r"([A-Z][a-z]+)\.?\s+(\d{1,2})\b[^,]*,\s*(\d{4})", text or "")
    if not match:
        return None
    month, day, year = match.groups()
    for fmt in ("%B", "%b"):
        try:
            return datetime.strptime(f"{month} {day} {year}", f"{fmt} %d %Y").strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_index(html, base_url=""):
    """Return the meet header and the championship event links on an index page."""
    soup = BeautifulSoup(html, "html.parser")
    name = dates = None
    if top := soup.select_one(".navbar-text"):
        parts = [s.strip() for s in top.stripped_strings]
        name, dates = parts[0], " ".join(parts[1:])
    else:
        if node := soup.select_one(".meetNameTop"):
            name = node.get_text(" ", strip=True)
        if node := soup.select_one(".meetDateTop"):
            dates = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
    if name is None and soup.title:
        name = soup.title.get_text(strip=True)
    events = {}
    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        match = re.search(r"(?:^|/)(\d{3})(?:-(\d+)_compiled|(_Scores))\.htm$", href)
        if not match:
            continue
        row = link.find_parent("tr")
        cells = [c.get_text(" ", strip=True) for c in row.find_all("td")] if row else [link.get_text()]
        identity = next((event_name(c) for c in cells if event_name(c)), None)
        if identity is None:
            continue
        number, round_no, scores = match.groups()
        multi = identity[1] in ("Decathlon", "Heptathlon")
        # Combined events are read from their score sheet, not their sub-events.
        if multi != bool(scores):
            continue
        # Keyed by event number: a jump-off can be listed under its parent event's name.
        entry = events.setdefault(number, {"gender": identity[0], "event": identity[1],
                                           "number": number, "multi": multi, "rounds": {}})
        entry["rounds"][int(round_no or 0)] = urljoin(base_url, href)
    return {"name": name, "dates": dates, "start_date": parse_dates(dates),
            "events": list(events.values())}


def _header(soup):
    table = soup.find("table", id="headerevent")
    rows = table.find_all("tr") if table else []
    for row in rows:
        cell = row.find("td")
        if cell:
            return re.sub(r"\s+", " ", cell.get_text(" ", strip=True))
    return ""


def _results_table(soup):
    for table_id in ("events", "multitotalscores"):
        if table := soup.find("table", id=table_id):
            return table
    return None


def _name(text):
    """'Kanyinsola AJAYI' -> 'Kanyinsola Ajayi'; the first word is left as written."""
    words = text.split()
    out = words[:1]
    for word in words[1:]:
        if word.isupper() and len(word) > 1 and word not in ("II", "III", "IV"):
            word = re.sub(r"[A-Za-z]+", lambda m: m.group(0).capitalize(), word.lower())
            word = re.sub(r"^Mc([a-z])", lambda m: "Mc" + m.group(1).upper(), word)
        out.append(word)
    return " ".join(out)


def _mark(text):
    text = re.sub(r"\s+", " ", text or "").strip()
    token = text.split(" ")[0] if text else ""
    upper = token.upper().rstrip(".")
    if upper in STATUS:
        return None, STATUS[upper]
    if not re.search(r"\d", token):
        return None, None
    return re.sub(r"m$", "", token), None


def parse_round(html):
    """Parse one compiled round page (or a combined-event score sheet)."""
    soup = BeautifulSoup(html, "html.parser")
    header = _header(soup)
    match = re.match(r"^(?:Dec |Hep )?(.*?)\s*(?:\(([^)]*)\))?\s*$", header)
    label, round_label = match.groups() if match else (header, "")
    label = re.sub(r"\s+Scores\b.*$", "", label)
    identity = event_name(label)
    if "Scores" in header:
        round_label = "Final"
    table = _results_table(soup)
    result = {"event": identity[1] if identity else None, "gender": identity[0] if identity else None,
              "label": header, "round": round_key(round_label), "round_label": round_label or None,
              "caption": None, "rows": []}
    if table is None:
        return result
    caption = table.find("caption")
    caption_text = caption.get_text(" ", strip=True) if caption else ""
    result["caption"] = caption_text or None
    caption_wind = re.search(r"Wind:\s*([+-]?\d+\.\d|NWI)", caption_text)
    head = None
    for row in table.find_all("tr"):
        if row.find("th") and head is None:
            head = [th.get_text(" ", strip=True).lower() for th in row.find_all("th")]
            continue
        cells = row.find_all("td", recursive=False)
        if head is None or len(cells) < 4:
            continue
        result["rows"].append(_row(cells, head, caption_wind))
    return result


def _column(head, *names):
    for i, text in enumerate(head):
        if text in names:
            return i
    return None


def _row(cells, head, caption_wind):
    texts = [c.get_text(" ", strip=True) for c in cells]
    name_i = _column(head, "athlete", "team", "name", "relay")
    mark_i = next((i for i, h in enumerate(head) if MARK_HEAD.match(h)), None)
    if name_i is None:
        name_i = 2
    if mark_i is None:
        mark_i = name_i + 1
    cell = cells[name_i]
    strings = [s.strip() for s in cell.stripped_strings if s.strip()]
    relay = head[name_i] in ("team", "relay")
    stats = cell.find(attrs={"stats-name": True})
    school = cls = None
    if mark_i - name_i >= 3:
        cls = texts[name_i + 1] or None
        school = texts[mark_i - 1] or None
    else:
        rest = [s for s in strings[1:] if not re.fullmatch(r"\d+", s)]
        classed = [m for s in rest if (m := re.match(r"^(.*?)\s*\[([A-Z0-9-]+)\]$", s))]
        if classed:
            school, cls = classed[0].group(1).strip() or None, classed[0].group(2)
        elif rest:
            school = rest[0]
    if stats and not school:
        school = stats["stats-name"].split("|")[-1].strip() or None
    if relay:
        school = school or (strings[0] if strings else None)
        name = school
    elif stats:
        name = stats["stats-name"].split("|")[0].strip()
    else:
        name = _name(strings[0]) if strings else None
    place_text = texts[0]
    mark, status = _mark(texts[mark_i] if mark_i < len(texts) else "")
    if status is None and not place_text.isdigit():
        status = STATUS.get(place_text.upper())
    q = wind = heat = heat_place = None
    for text in texts[mark_i + 1:]:
        # Jump-off qualifiers are written "JOq", "q JO", "q-JO" or "q (won JO)".
        if q is None and (m := re.match(r"^(?:JO)?([Qq])(?:$|[\s(-])", text)):
            q = m.group(1)
        elif WIND.match(text) and wind is None:
            wind = text
    heat_i = next((i for i, h in enumerate(head) if "(pl)" in h), None)
    if heat_i is not None and heat_i < len(texts):
        if m := HEAT.match(texts[heat_i]):
            heat = int(m.group(1))
            heat_place = int(m.group(2)) if m.group(2) else None
    if wind is None and caption_wind and mark is not None:
        wind = caption_wind.group(1)
    tfrrs = re.search(r"tfrrs\.org/athletes/(\d+)", str(cell))
    points_i = _column(head, "pts", "team pts")
    points = None
    if points_i is not None and points_i < len(texts) and re.fullmatch(r"\d+(?:\.\d+)?", texts[points_i]):
        points = float(texts[points_i]) if "." in texts[points_i] else int(texts[points_i])
    return {"place": int(place_text) if place_text.isdigit() else None, "name": name,
            "school": school, "class": cls, "mark": mark, "wind": wind, "q": q,
            "status": status, "tfrrs_id": tfrrs.group(1) if tfrrs else None,
            "heat": heat, "heat_place": heat_place, "points": points}


def fetch_meet(index_url, session=None, sleeper=time.sleep, cache_dir=CACHE_DIR,
               rounds="all", fetcher=None):
    """Fetch an index page and its championship round pages; return the cached paths.

    rounds="last" fetches only each event's final round at the meet.
    """
    fetcher = fetcher or Fetcher(session=session, sleeper=sleeper, cache_dir=cache_dir)
    html = fetcher.get(index_url)
    if html is None:
        raise ValueError(f"Index page unavailable: {index_url}")
    paths = [fetcher.path_for(index_url)]
    for event in parse_index(html, index_url)["events"]:
        for url in _round_urls(event, rounds):
            if fetcher.get(url) is not None:
                paths.append(fetcher.path_for(url))
    return paths


def _round_urls(event, rounds):
    numbers = sorted(event["rounds"])
    return [event["rounds"][n] for n in (numbers[-1:] if rounds == "last" else numbers)]


def load_config(path=CONFIG):
    return json.loads(Path(path).read_text())


def _meet(fetcher, index_url, rounds):
    html = fetcher.get(index_url)
    if html is None:
        raise ValueError(f"Index page unavailable: {index_url}")
    index = parse_index(html, index_url)
    events, skipped = {}, []
    for event in index["events"]:
        for url in _round_urls(event, rounds):
            page = fetcher.get(url)
            if page is None:
                skipped.append({"url": url, "reason": "unavailable"})
                continue
            result = parse_round(page)
            result["url"] = url
            if (result["gender"], result["event"]) != (event["gender"], event["event"]):
                skipped.append({"url": url, "reason": f"page is {result['label']!r}"})
                continue
            events.setdefault((event["gender"], event["event"]), []).append(result)
    return index, events, skipped


def _round_names(rounds):
    labels = [r["round"] for r in rounds]
    # Pages call the round before the final "Semis", "Semifinals" or "Prelims" in different
    # years; name rounds by position so seasons compare.
    if labels and labels[-1] == "final":
        labels = ["prelim"] * (len(labels) - 2) + ["semifinal", "final"][-len(labels):]
    return labels


def _nationals(rounds, relay):
    """Each athlete's last round reached, with final places for finalists."""
    athletes, by_id = {}, {}
    for result, label in zip(rounds, _round_names(rounds)):
        for row in result["rows"]:
            if relay:
                key = (row["school"] or row["name"] or "").lower()
            else:
                key = by_id.get(row["tfrrs_id"]) or ((row["name"] or "").lower(), (row["school"] or "").lower())
            if row["tfrrs_id"]:
                by_id[row["tfrrs_id"]] = key
            previous = athletes.pop(key, None)
            athletes[key] = {"name": row["name"], "school": row["school"],
                             "tfrrs_id": row["tfrrs_id"] or (previous or {}).get("tfrrs_id"),
                             "round": label, "place": row["place"] if label == "final" else None,
                             "mark": row["mark"], "wind": row["wind"], "status": row["status"],
                             "points": row["points"], "url": result["url"]}
    # Deepest round first, finalists by place, the rest in their last round's order.
    return sorted(athletes.values(), key=lambda a: (-ROUND_ORDER.index(a["round"]),
                                                    a["place"] is None, a["place"] or 0))


def season_results(year, config=None, fetcher=None, cache_dir=CACHE_DIR, session=None,
                   sleeper=time.sleep):
    """Structured First Round and nationals results for one outdoor season."""
    config = config if config is not None else load_config()
    season = config[str(year)]
    fetcher = fetcher or Fetcher(session=session, sleeper=sleeper, cache_dir=cache_dir)
    regions = {}
    skipped = []
    for region in ("East", "West"):
        index, results, missed = _meet(fetcher, season[region.lower()], "last")
        regions[region] = index, results
        skipped += missed
    national_index, national, missed = _meet(fetcher, season["nationals"], "all")
    skipped += missed
    indexes = [(region, index) for region, (index, _) in regions.items()] + [("Nationals", national_index)]
    keys = list(national)
    for region in regions.values():
        keys += [k for k in region[1] if k not in keys]
    events = []
    keys.sort(key=lambda k: (k[0], EVENT_ORDER.index(k[1])))
    for gender, event in keys:
        relay = event.endswith("Relay")
        multi = event in ("Decathlon", "Heptathlon")
        first_round = {}
        for region, (_, results) in regions.items():
            pages = results.get((gender, event))
            if pages:
                last = pages[-1]
                first_round[region] = {"round": last["round_label"], "url": last["url"],
                                       "caption": last["caption"], "rows": last["rows"],
                                       "advanced": sum(1 for r in last["rows"] if r["q"])}
        rounds = national.get((gender, event), [])
        events.append({"gender": gender, "event": event, "relay": relay, "multi": multi,
                       "first_round": first_round,
                       "nationals_rounds": [{"round": name, "label": r["round_label"], "url": r["url"]}
                                            for r, name in zip(rounds, _round_names(rounds))],
                       "nationals": _nationals(rounds, relay)})
    return {"season": "outdoor", "year": str(year), "meet": season.get("meet"),
            "sources": {"east": season["east"], "west": season["west"],
                        "nationals": season["nationals"]},
            "pages": {label: {"name": index["name"], "dates": index["dates"]} for label, index in indexes},
            "events": events, "skipped": skipped}


def season_checks(data):
    """Return warnings where a season departs from 12 advancers and 24 national entrants."""
    warnings = []
    for event in data["events"]:
        tag = f"{data['year']} {event['gender']} {event['event']}"
        if not event["multi"]:
            for region in ("East", "West"):
                block = event["first_round"].get(region)
                if block is None:
                    warnings.append(f"{tag}: no {region} First Round results")
                elif block["advanced"] != 12:
                    warnings.append(f"{tag}: {block['advanced']} {region} advancers")
        if not event["nationals"]:
            warnings.append(f"{tag}: no nationals results")
        elif not event["multi"] and len(event["nationals"]) != 24:
            warnings.append(f"{tag}: {len(event['nationals'])} nationals entrants")
    return warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description="Fetch or dump one season's Flash Results")
    parser.add_argument("year")
    parser.add_argument("--cache-dir", default=str(CACHE_DIR))
    parser.add_argument("--config", default=str(CONFIG))
    parser.add_argument("--offline", action="store_true", help="read the cache only")
    parser.add_argument("--check", action="store_true", help="print sanity warnings instead of JSON")
    args = parser.parse_args(argv)
    cls = CacheOnly if args.offline else Fetcher
    fetcher = cls(cache_dir=args.cache_dir)
    data = season_results(args.year, load_config(args.config), fetcher=fetcher)
    if args.check:
        for warning in season_checks(data):
            print(warning)
        print(f"{len(data['events'])} events, {fetcher.requests} requests", file=sys.stderr)
    else:
        json.dump(data, sys.stdout, indent=1, ensure_ascii=False)
        print()


if __name__ == "__main__":
    main()
