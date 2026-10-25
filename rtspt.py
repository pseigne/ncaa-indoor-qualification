"""Fetch the NCAA's championship entry lists from RecordTiming, once a season.

RecordTiming's robots.txt disallows all robots. The owner chose to fetch it
anyway, so every request is spaced out, named, and cached for good.
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
import requests

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "data" / "entries-cache"
BASE = "https://www.rtspt.com/ncaa/"
HEADERS = {"User-Agent": "ncaa-indoor-qualification seasonal import "
                         "(https://github.com/pseigne/ncaa-indoor-qualification)"}
INDEX = "index.html"
PAUSE = 3
BACKOFF = (60, 120)
TIMEOUT = (10, 45)
# Link text and filenames change every year; these cover 2015 to 2026.
WANTED_TEXT = re.compile(r"accepted|declared|qualifier list|preliminary round|first round|decathlon|heptathlon", re.I)
WANTED_FILE = re.compile(r"declared|accepted|selected|entry|qualifiers", re.I)
SKIPPED = re.compile(r"review|start|_res|result|compiled|score|schedule", re.I)

_last_request = [None]


class Refused(Exception):
    """RecordTiming refused us twice after waiting; stop for now."""


def season_dir(season, year):
    """indoor 2025-2026 is d1indoor26; outdoor 2026 is d1outdoor26."""
    year = str(year).replace("_", "-")
    if season == "indoor":
        first, _, second = year.partition("-")
        if not (first.isdigit() and second.isdigit() and int(second) == int(first) + 1):
            raise ValueError(f"Invalid indoor year: {year}")
        last = second
    elif season == "outdoor":
        if not re.fullmatch(r"\d{4}", year):
            raise ValueError(f"Invalid outdoor year: {year}")
        last = year
    else:
        raise ValueError(f"Invalid season: {season}")
    return f"d1{season}{last[2:]}"


def entry_links(html, page_url):
    """Every page linked from a season index that may be an entry list, in page order."""
    soup = BeautifulSoup(html, "html.parser")
    base = urlparse(page_url)
    urls = []
    for link in soup.find_all("a", href=True):
        url = urljoin(page_url, link["href"])
        parsed = urlparse(url)
        name = parsed.path.rsplit("/", 1)[-1]
        text = link.get_text(" ", strip=True)
        if (parsed.hostname != base.hostname or parsed.path.rsplit("/", 1)[0] != base.path.rstrip("/")
                or not re.fullmatch(r"[\w.-]+\.html?", name)):
            continue
        if SKIPPED.search(name) or SKIPPED.search(text):
            continue
        if (WANTED_TEXT.search(text) or WANTED_FILE.search(name)) and url not in urls:
            urls.append(url)
    return urls


def _get(session, url, sleeper):
    """One polite request. Returns the response; raises Refused after two waits."""
    for wait in (*BACKOFF, None):
        if _last_request[0] is not None:
            gap = PAUSE - (time.monotonic() - _last_request[0])
            if gap > 0:
                sleeper(gap)
        try:
            response = session.get(url, timeout=TIMEOUT, headers=HEADERS)
        finally:
            _last_request[0] = time.monotonic()
        if response.status_code not in (403, 429):
            return response
        if wait is None:
            raise Refused(f"RecordTiming refused {url} with {response.status_code}")
        print(f"RecordTiming returned {response.status_code}; waiting {wait}s", flush=True)
        sleeper(wait)


def cached(session, url, path, sleeper, remember_missing=True):
    """The page at url, from the cache or fetched once into it. None when it does not exist.

    A missing linked page is remembered by its metadata alone, so it is not asked for
    again; a missing season index is not, since the season may not be posted yet."""
    path, meta = Path(path), meta_path(path)
    if path.exists():
        return path.read_bytes()
    if meta.exists() and json.loads(meta.read_text()).get("status") == 404:
        return None
    response = _get(session, url, sleeper)
    fetched = datetime.now(timezone.utc).date().isoformat()
    if response.status_code == 404:
        if remember_missing:
            path.parent.mkdir(parents=True, exist_ok=True)
            meta.write_text(json.dumps({"url": url, "fetched": fetched, "status": 404, "sha256": None}, indent=1) + "\n")
        return None
    response.raise_for_status()
    body = response.content
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    meta.write_text(json.dumps({"url": url, "fetched": fetched, "status": response.status_code,
                                "sha256": hashlib.sha256(body).hexdigest()}, indent=1) + "\n")
    return body


def meta_path(path):
    path = Path(path)
    return path.with_name(path.name + ".meta.json")


def fetch_season(season, year, session=None, sleeper=time.sleep, cache_dir=CACHE_DIR):
    """Cache a season's index and every entry list it links to; return the lists' paths.

    A season with no index (outdoor 2020, or one not yet posted) returns []."""
    directory = season_dir(season, year)
    folder = Path(cache_dir) / directory
    index_url = f"{BASE}{directory}/"
    owned = session is None
    session = session or requests.Session()
    try:
        index = cached(session, index_url, folder / INDEX, sleeper, remember_missing=False)
        if index is None:
            return []
        paths = []
        for url in entry_links(index.decode("latin-1"), index_url):
            path = folder / urlparse(url).path.rsplit("/", 1)[-1]
            if cached(session, url, path, sleeper) is None:
                print(f"Linked page is missing: {url}", flush=True)
                continue
            paths.append(path)
        return paths
    finally:
        if owned:
            session.close()


def main(argv):
    import argparse

    parser = argparse.ArgumentParser(description="Cache RecordTiming entry lists")
    parser.add_argument("season", choices=["indoor", "outdoor"])
    parser.add_argument("years", nargs="+")
    parser.add_argument("--cache-dir", default=CACHE_DIR)
    args = parser.parse_args(argv)
    session = requests.Session()
    try:
        for year in args.years:
            paths = fetch_season(args.season, year, session=session, cache_dir=args.cache_dir)
            print(f"{args.season} {year}: {len(paths)} lists", flush=True)
    except Refused as error:
        print(f"Stopped: {error}", flush=True)
        return 1
    finally:
        session.close()
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main(sys.argv[1:]))
