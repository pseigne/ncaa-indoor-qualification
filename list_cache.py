"""Fetch TFRRS list pages at a given limit into data/list-cache, once.

    python list_cache.py --group archive --from 2015 --to 2023 --regions National,East,West

Each page is saved as {list_id}-{gender}-{limit}.html beside a .meta.json holding
{url, fetched, status, sha256}. A cached page is never fetched again. Pages are
checked like collected lists before they are saved. Years are championship
years, so 2015 is indoor 2014-2015.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import requests

from tfrrs_data import DATA_DIR, GENDERS, TIE_MARGIN, list_url, load_config, parse_page
from tfrrs_lists import HEADERS, LIMITS, PAUSE, Blocked, fetch_response, verify_page_identity

CACHE_DIR = DATA_DIR / "list-cache"


def cache_path(list_id, gender, limit, cache_dir=CACHE_DIR):
    return Path(cache_dir) / f"{list_id}-{gender}-{limit}.html"


def check_page(html, cfg, gender, limit):
    """The page's events, after the same identity checks a collected list gets."""
    deep = dict(cfg, depth=limit)
    verify_page_identity(html, deep, gender)
    return parse_page(html, deep, gender, cap=limit + TIE_MARGIN)


def read_cached(cfg, gender, limit, cache_dir=CACHE_DIR):
    path = cache_path(cfg["list_id"], gender, limit, cache_dir)
    return path.read_text(encoding="utf-8") if path.exists() else None


def write_cached(path, html, url, status):
    body = html.encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    meta = {"url": url, "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "status": status, "sha256": hashlib.sha256(body).hexdigest()}
    path.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2) + "\n")


def prefetch(configs, limit=100, session=None, sleeper=time.sleep, cache_dir=CACHE_DIR):
    """Fetch both genders of each list unless cached. Returns one result per page.

    A page that fails its checks is reported and not saved. A host that keeps refusing
    requests stops the run; every later page is reported as skipped."""
    if limit not in LIMITS:
        raise ValueError(f"TFRRS offers no limit of {limit}")
    owned_session = session is None
    session = session or requests.Session()
    results, requested, blocked = [], False, None
    try:
        for cfg in configs:
            for gender in GENDERS:
                result = {key: cfg[key] for key in ("year", "season", "region", "list_id")}
                result["gender"] = gender
                path = cache_path(cfg["list_id"], gender, limit, cache_dir)
                result["path"] = str(path)
                results.append(result)
                html = read_cached(cfg, gender, limit, cache_dir)
                if html is not None:
                    result["status"] = "cached"
                elif blocked:
                    result.update(status="skipped", error=blocked)
                    continue
                else:
                    if requested:
                        sleeper(PAUSE)
                    requested = True
                    url = list_url(cfg, gender, limit)
                    print(f"Fetching {cfg['year']} {cfg['season']} {cfg['region']} {gender}", flush=True)
                    try:
                        response = fetch_response(session, url, sleeper, HEADERS)
                    except Blocked as error:
                        blocked = str(error)
                        result.update(status="failed", error=blocked)
                        continue
                    except requests.RequestException as error:
                        result.update(status="failed", error=str(error))
                        continue
                    html = response.text
                    result["status"] = "fetched"
                try:
                    events = check_page(html, cfg, gender, limit)
                except ValueError as error:
                    result.update(status="failed", error=str(error))
                    continue
                if result["status"] == "fetched":
                    write_cached(path, html, url, response.status_code)
                result["events"] = {event["event"]: len(event["rankings"]) for event in events}
    finally:
        if owned_session:
            session.close()
    return results


def choose(configs, start=None, end=None, season=None, regions=None):
    def year(cfg):
        return int(cfg["year"].split("-")[-1])

    return [cfg for cfg in configs
            if (start is None or year(cfg) >= start) and (end is None or year(cfg) <= end)
            and (season is None or cfg["season"] == season)
            and (not regions or cfg["region"] in regions)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--group", default="archive", choices=("active", "historical", "archive"))
    parser.add_argument("--from", dest="start", type=int, help="first championship year")
    parser.add_argument("--to", dest="end", type=int, help="last championship year")
    parser.add_argument("--season", choices=("indoor", "outdoor"))
    parser.add_argument("--regions", help="comma-separated: National, East, West")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    args = parser.parse_args(argv)
    regions = {region.strip().title() for region in args.regions.split(",")} if args.regions else None
    configs = choose(load_config().get(args.group) or [], args.start, args.end, args.season, regions)
    if not configs:
        raise SystemExit(f"No {args.group} lists match")
    results = prefetch(configs, args.limit, cache_dir=args.cache_dir)
    for result in results:
        label = f"{result['year']} {result['season']} {result['region']} {result['gender']} ({result['list_id']})"
        detail = result.get("error") or (f"{len(result['events'])} events, "
                                         f"{min(result['events'].values())}-{max(result['events'].values())} rows")
        print(f"{result['status']:8} {label}: {detail}", flush=True)
    counts = {status: sum(r["status"] == status for r in results) for status in ("fetched", "cached", "failed", "skipped")}
    print(", ".join(f"{count} {status}" for status, count in counts.items()), flush=True)
    if counts["failed"] or counts["skipped"]:
        raise SystemExit(1)
    return results


if __name__ == "__main__":
    main()
