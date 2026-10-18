"""Discover NCAA Division I season lists from TFRRS's own navigation."""

from copy import deepcopy
from datetime import datetime, timezone
import re
import time
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; TFRRS-Monitor/1.0)",
           "Referer": "https://www.tfrrs.org/"}
HOSTS = {"tfrrs.org", "www.tfrrs.org", "tf.tfrrs.org", "api.tfrrs.org",
         "mobile.tfrrs.org", "upload.tfrrs.org"}
LIST_PATH = re.compile(r"/lists/(\d+)/([A-Za-z0-9_]+)/?$")
SCOPES = {("indoor", "National"), ("outdoor", "East"),
          ("outdoor", "West"), ("outdoor", "National")}


def fetch_page(session, url, sleeper=time.sleep):
    for attempt in range(3):
        try:
            response = session.get(url, timeout=(10, 45), headers=HEADERS)
            response.raise_for_status()
            return response.text
        except requests.RequestException:
            if attempt == 2:
                raise
            sleeper(2 ** attempt)


def list_identity(title):
    """Return a scope only for recognized NCAA DI titles, never URL ID guesses."""
    title = re.sub(r"^(\d{4})_(\d{4})", r"\1-\2", title)
    title = re.sub(r"\((?:FINAL|All Schools)\)", "", title, flags=re.I)
    title = re.sub(r"[_.]", " ", title)
    title = re.sub(r"\bFINAL\b", "", title, flags=re.I)
    title = re.sub(r"\s+", " ", title).strip()
    match = re.fullmatch(
        r"(\d{4})(?:\s*-\s*(\d{4}))? NCAA (?:Division|Div) I "
        r"(?:(East|West) )?(Indoor|Outdoor)?\s*"
        r"((?:(?:Qualifying|Qualifiers|List|Rankings|Multis|POP|Performance)\s*)+)",
        title, re.I)
    if not match:
        return None
    first, second, region, season, suffix = match.groups()
    # TFRRS called the 2023/2024 national outdoor lists simply "Rankings".
    if season is None and (second or "rankings" not in suffix.lower()):
        return None
    season = (season or "outdoor").lower()
    if season == "indoor":
        if second is None or int(second) != int(first) + 1 or region:
            return None
        year = f"{first}-{second}"
    else:
        if second:
            return None
        year = first
    return dict(year=year, season=season, region=region.title() if region else "National")


def candidates_from_page(html, source_url):
    soup = BeautifulSoup(html, "html.parser")
    candidates = []
    for node in soup.select('select[name="other_lists"] option, a[href]'):
        raw_url = node.get("value") if node.name == "option" else node.get("href")
        parsed = urlparse(urljoin(source_url, raw_url or ""))
        match = LIST_PATH.fullmatch(parsed.path)
        if parsed.scheme != "https" or parsed.hostname not in HOSTS or not match:
            continue
        # Homepage links have short labels; their published slugs include the
        # season. Dropdown options have complete visible titles.
        title = node.get_text(" ", strip=True) if node.name == "option" else match[2]
        identity = list_identity(title)
        if identity:
            candidates.append(dict(identity, list_id=match[1], list_name=match[2]))
    if not candidates:
        raise ValueError(f"No recognized NCAA DI list links at {source_url}")
    return candidates


def verify_page_identity(html, cfg, gender):
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.select_one("h3.panel-title")
    identity = list_identity(heading.get_text(" ", strip=True)) if heading else None
    expected = {key: cfg[key] for key in ("year", "season", "region")}
    if identity != expected:
        raise ValueError(f"TFRRS list {cfg['list_id']} identity mismatch: {identity}; expected {expected}")
    form = soup.select_one("form#list_filter")
    if form is None or urlparse(form.get("action", "")).path != f"/list_data/{cfg['list_id']}":
        raise ValueError("TFRRS returned an unexpected list ID")
    selected = soup.select('select[name="gender"] option[selected]')
    if len(selected) != 1 or selected[0].get("value") != gender:
        raise ValueError(f"TFRRS did not return the requested gender: {gender}")


def discover_config(config, session, sleeper=time.sleep, current_year=None):
    """Propose a config; callers must validate all rankings before saving it."""
    settings = config.get("discovery", {})
    if not settings.get("enabled", False):
        return deepcopy(config)
    current_year = current_year or datetime.now(timezone.utc).year
    candidates = {}
    for url in settings["sources"]:
        for candidate in candidates_from_page(fetch_page(session, url, sleeper), url):
            if int(candidate["year"].split("-")[-1]) > current_year + 1:
                continue
            key = (candidate["year"], candidate["season"], candidate["region"])
            previous = candidates.get(key)
            if previous and previous["list_id"] != candidate["list_id"]:
                raise ValueError(f"Ambiguous TFRRS list IDs for {key}")
            # A slug may change when a list is marked FINAL. The ID must agree.
            candidates[key] = candidate
        sleeper(1)
    by_scope = {}
    for item in candidates.values():
        by_scope.setdefault((item["season"], item["region"]), {})[item["year"]] = item
    active = {(c["season"], c["region"]): c for c in config["active"]}
    if set(active) != SCOPES:
        raise ValueError("Automatic discovery requires one indoor and three outdoor scopes")
    if not SCOPES.issubset(by_scope):
        raise ValueError("Discovery did not find all four NCAA DI list scopes")
    proposed = deepcopy(config)
    indoor = by_scope[("indoor", "National")]
    indoor_year = max(indoor)
    if indoor_year >= active[("indoor", "National")]["year"]:
        active[("indoor", "National")] = indoor[indoor_year]
    # East, West and the national list (including multis) roll over together.
    outdoor_scopes = [("outdoor", region) for region in ("East", "West", "National")]
    common_years = set.intersection(*(set(by_scope[scope]) for scope in outdoor_scopes))
    if not common_years:
        raise ValueError("No complete outdoor season found")
    outdoor_year = max(common_years)
    if outdoor_year >= max(active[scope]["year"] for scope in outdoor_scopes):
        for scope in outdoor_scopes:
            active[scope] = by_scope[scope][outdoor_year]
    proposed["active"] = [active[(c["season"], c["region"])] for c in config["active"]]
    history = {(c["year"], c["season"], c["region"]): c for c in config["historical"]}
    for item in config["active"] + proposed["active"]:
        history[(item["year"], item["season"], item["region"])] = item
    proposed["historical"] = list(history.values())
    return proposed
