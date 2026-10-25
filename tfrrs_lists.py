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


# Seconds between requests to TFRRS.
PAUSE = 3
# Waits after a 403 or 429 before trying again; after the last, stop.
BACKOFF = (60, 120)
# The row counts TFRRS's list form offers.
LIMITS = (5, 10, 20, 25, 30, 50, 100, 200, 500)


class Blocked(requests.HTTPError):
    """TFRRS kept refusing requests: stop asking it, keeping what has been fetched."""


def fetch_response(session, url, sleeper=time.sleep, headers=None):
    failures = blocked = 0
    while True:
        try:
            response = session.get(url, timeout=(10, 45), headers=headers or HEADERS)
            if response.status_code in (403, 429):
                if blocked == len(BACKOFF):
                    raise Blocked(f"TFRRS returned {response.status_code} for {url}", response=response)
                sleeper(BACKOFF[blocked])
                blocked += 1
                continue
            response.raise_for_status()
            return response
        except Blocked:
            raise
        except requests.RequestException:
            failures += 1
            if failures == 3:
                raise
            sleeper(2 ** (failures - 1))


def fetch_page(session, url, sleeper=time.sleep, headers=None):
    return fetch_response(session, url, sleeper, headers).text


# National outdoor lists that are Division I but are not labelled FINAL.
ACCEPT_BY_ID = {"4044", "5018"}
_SUFFIX = r"(?:All Schools|Qualifying|Qualifiers|List|Rankings|Multis|POP|Performance)"


def list_identity(title):
    """Return a scope only for recognized NCAA DI titles, never URL ID guesses."""
    title = re.sub(r"^(\d{4})_(\d{4})", r"\1-\2", title)
    title = re.sub(r"\((?:FINAL|All Schools)\)", "", title, flags=re.I)
    title = re.sub(r"[_.]", " ", title)
    title = re.sub(r"\bFINAL\b", "", title, flags=re.I)
    title = re.sub(r"\s+", " ", title).strip()
    if re.search(r"\b(?:Division|Div)\s+(?:II|III|2|3)\b", title, re.I):
        return None
    match = re.fullmatch(
        r"(\d{4})(?:\s*-\s*(\d{4}))? NCAA (?:Division|Div) I "
        rf"(?:(East|West) )?(Indoor|Outdoor)?\s*((?:{_SUFFIX}\s*)+)",
        title, re.I)
    if not match:
        return None
    first, second, region, season, suffix = match.groups()
    suffix_l = suffix.lower()
    # Early regional titles omit the word Outdoor: "POP List", "Qualifiers".
    if season is None:
        regional_list = region and any(word in suffix_l for word in ("pop", "qualifier", "qualifying", "list", "rankings"))
        national_rankings = "rankings" in suffix_l or "all schools" in suffix_l
        if regional_list or national_rankings:
            season = "outdoor"
        else:
            return None
    season = season.lower()
    if season == "indoor":
        if second is None or int(second) != int(first) + 1 or region:
            return None
        year = f"{first}-{second}"
    else:
        # A 2010-2011 East title is the 2011 outdoor season.
        if second:
            if int(second) != int(first) + 1:
                return None
            year = second
        else:
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
    heading_text = heading.get_text(" ", strip=True) if heading else ""
    if re.search(r"\b(?:Division|Div\.?)\s*(?:II|III|2|3)\b", heading_text, re.I):
        raise ValueError(f"TFRRS list {cfg['list_id']} is not Division I: {heading_text}")
    identity = list_identity(heading_text) if heading else None
    expected = {key: cfg[key] for key in ("year", "season", "region")}
    if identity != expected and str(cfg.get("list_id")) in ACCEPT_BY_ID:
        # 2023 and 2025 national outdoor lists are Division I and are not labelled final.
        year_ok = expected["year"] in heading_text.replace("_", "-")
        division_ok = re.search(r"\b(?:Division|Div\.?)\s*I\b", heading_text, re.I) is not None
        if year_ok and division_ok and expected["season"] == "outdoor" and expected["region"] == "National":
            identity = expected
    if identity != expected and cfg.get("status") == "cancelled":
        # 2020 outdoor lists were abandoned. Keep them only when the heading is this Division I season.
        year_ok = expected["year"] in heading_text.replace("_", "-")
        division_ok = re.search(r"\b(?:Division|Div\.?)\s*I\b", heading_text, re.I) is not None
        if year_ok and division_ok:
            identity = expected
    if identity != expected:
        raise ValueError(f"TFRRS list {cfg['list_id']} identity mismatch: {identity}; expected {expected}")
    form = soup.select_one("form#list_filter")
    if form is None or urlparse(form.get("action", "")).path != f"/list_data/{cfg['list_id']}":
        raise ValueError("TFRRS returned an unexpected list ID")
    selected = soup.select('select[name="gender"] option[selected]')
    if len(selected) != 1 or selected[0].get("value") != gender:
        raise ValueError(f"TFRRS did not return the requested gender: {gender}")
    if cfg.get("depth"):
        # TFRRS may ignore the limit; never save a default-length list as a deep one.
        limit = soup.select('select[name="limit"] option[selected]')
        if len(limit) != 1 or limit[0].get("value") != str(cfg["depth"]):
            raise ValueError(f"TFRRS did not return the requested depth: {cfg['depth']}")


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
        sleeper(PAUSE)
    by_scope = {}
    for item in candidates.values():
        by_scope.setdefault((item["season"], item["region"]), {})[item["year"]] = item
    active = {(c["season"], c["region"]): c for c in config["active"]}
    if set(active) != SCOPES:
        raise ValueError("Automatic discovery requires one indoor and three outdoor scopes")
    if not SCOPES.issubset(by_scope):
        raise ValueError("Discovery did not find all four NCAA DI list scopes")
    proposed = deepcopy(config)
    replaced = dict(active)
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
    for scope, item in active.items():
        # A new season keeps the depth of the list it replaces.
        if "depth" in replaced[scope] and item is not replaced[scope]:
            active[scope] = dict(item, depth=replaced[scope]["depth"])
    proposed["active"] = [active[(c["season"], c["region"])] for c in config["active"]]
    history = {(c["year"], c["season"], c["region"]): c for c in config["historical"]}
    for item in config["active"] + proposed["active"]:
        history[(item["year"], item["season"], item["region"])] = item
    proposed["historical"] = list(history.values())
    return proposed
