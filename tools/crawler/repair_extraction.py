#!/usr/bin/env python3
"""
Rebuild artist/artwork extraction from an existing Visions crawler mirror.

This does not access the network. It reparses the locally mirrored HTML and
rewrites data/artists.json, data/artworks.json, data/pages.json and their CSV
reports using the v1.3 extraction logic.

Usage:
    python repair_extraction.py visions_site
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict
from pathlib import Path

from bs4 import BeautifulSoup

from visions_crawler import (
    ArtistRecord,
    ArtworkRecord,
    PageRecord,
    Crawler,
    clean_text,
    detect_page_type,
    extract_artist,
    extract_artist_artworks,
    extract_home_artists,
    parse_artwork_detail,
    url_to_local_path,
)


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_csv(path: Path, records, dataclass_type):
    fields = list(dataclass_type.__dataclass_fields__.keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for rec in records:
            w.writerow(asdict(rec))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("output", help="Existing crawler output directory, e.g. visions_site")
    args = ap.parse_args()

    output = Path(args.output).resolve()
    pages_path = output / "data" / "pages.json"
    if not pages_path.exists():
        raise SystemExit(f"Missing {pages_path}")

    raw_pages = load_json(pages_path, [])
    crawler = Crawler(
        start_url="https://www.visionsfineart.com/",
        output=output,
        max_pages=0,
        delay=0,
        timeout=1,
        download_assets=False,
        rewrite=False,
        user_agent="VisionsExtractionRepair/1.3",
    )

    # Pass 1: register canonical homepage roster.
    for pd in raw_pages:
        if pd.get("page_type") != "home":
            continue
        url = pd["url"]
        path = url_to_local_path(url, output, force_html=True)
        if path.exists():
            soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "html.parser")
            crawler._register_home_artists(extract_home_artists(soup, url))
            break

    rebuilt_pages = []

    # Pass 2: reclassify every mirrored page. Parse artist indexes before
    # artwork details so thumbnail/title records exist when details are merged.
    ordered = sorted(
        raw_pages,
        key=lambda p: {
            "artist_index": 0,
            "artwork_detail": 1,
        }.get(p.get("page_type"), 2),
    )

    page_updates = {}
    reparsed_meta = {}
    repaired_unknown = []

    for pd in ordered:
        url = pd["url"]
        local = url_to_local_path(url, output, force_html=True)
        if not local.exists() or pd.get("status", 200) >= 400:
            continue

        soup = BeautifulSoup(
            local.read_text(encoding="utf-8", errors="replace"), "html.parser"
        )
        page_type, artist_hint, artwork_hint = detect_page_type(url, soup)
        title = clean_text(soup.title)
        canonical_artist = artist_hint
        canonical_artwork = artwork_hint

        if page_type == "home":
            # Homepage roster was registered in pass 1.
            pass

        elif page_type == "artist_index":
            artist = extract_artist(soup, url, local)
            canonical_artist = crawler._canonical_artist_name(
                url, artist.name or artist_hint, title
            )
            if canonical_artist:
                artist.name = canonical_artist
                canonical_url = crawler._canonical_artist_url(canonical_artist)
                if canonical_url:
                    artist.url = canonical_url
                    artist.local_path = str(
                        url_to_local_path(
                            canonical_url, output, force_html=True
                        )
                    )
                crawler._merge_artist_record(artist, url)

            for art in extract_artist_artworks(
                soup, canonical_artist or artist.name, url
            ):
                if art.url:
                    existing = crawler.artworks.get(art.url)
                    if (
                        existing
                        and existing.thumbnail_url
                        and not art.thumbnail_url
                    ):
                        art.thumbnail_url = existing.thumbnail_url
                    crawler.artworks[art.url] = art

        elif page_type == "artwork_detail":
            art = parse_artwork_detail(
                soup, url, local, artist_hint, artwork_hint
            )
            canonical_artist = crawler._canonical_artist_name(
                url, art.artist or artist_hint, title
            )
            if canonical_artist:
                art.artist = canonical_artist
            canonical_artwork = art.title or artwork_hint

            existing = crawler.artworks.get(art.url)
            if existing and existing.thumbnail_url and not art.thumbnail_url:
                art.thumbnail_url = existing.thumbnail_url
            crawler.artworks[art.url] = art

        elif page_type == "biography":
            canonical_artist = crawler._canonical_artist_name(
                url, artist_hint, title
            )

        elif page_type == "unknown":
            repaired_unknown.append({"url": url, "title": title})

        reparsed_meta[url] = {
            "page_type": page_type,
            "artist_name": canonical_artist or "",
            "artwork_title": canonical_artwork or "",
            "title": title,
        }

    crawler._merge_home_artist_data()
    crawler._fill_artwork_local_paths()

    # Preserve request/status information while replacing classification and
    # extracted labels with the v1.3 local reparse.
    pages = []
    for pd in raw_pages:
        pd = dict(pd)
        meta = reparsed_meta.get(pd.get("url"))
        if meta:
            pd.update(meta)
        pages.append(
            PageRecord(
                **{
                    k: pd.get(k, "")
                    for k in PageRecord.__dataclass_fields__
                }
            )
        )

    artists = sorted(crawler.artists.values(), key=lambda x: x.name.casefold())
    artworks = sorted(crawler.artworks.values(), key=lambda x: (x.artist.casefold(), x.title.casefold()))

    data = output / "data"
    reports = output / "reports"
    data.mkdir(parents=True, exist_ok=True)
    reports.mkdir(parents=True, exist_ok=True)

    (data / "artists.json").write_text(
        json.dumps([asdict(x) for x in artists], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (data / "artworks.json").write_text(
        json.dumps([asdict(x) for x in artworks], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (data / "pages.json").write_text(
        json.dumps([asdict(x) for x in pages], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    write_csv(reports / "artists.csv", artists, ArtistRecord)
    write_csv(reports / "artworks.csv", artworks, ArtworkRecord)
    write_csv(reports / "pages.csv", pages, PageRecord)

    (reports / "unknown_pages.json").write_text(
        json.dumps(repaired_unknown, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    type_counts = {}
    for page in pages:
        type_counts[page.page_type] = type_counts.get(page.page_type, 0) + 1

    summary_path = reports / "summary.json"
    summary = load_json(summary_path, {})
    summary["pages_fetched"] = len(pages)
    summary["page_types"] = dict(sorted(type_counts.items()))
    summary["artists"] = len(artists)
    summary["artworks"] = len(artworks)
    summary["unknown_pages"] = len(repaired_unknown)
    summary["extraction_version"] = "1.3"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Rebuilt extraction from {len(raw_pages)} mirrored pages.")
    print(f"Canonical artists: {len(artists)}")
    print(f"Artwork records:   {len(artworks)}")
    print(f"Unknown pages:     {len(repaired_unknown)}")
    print(f"Page types:        {dict(sorted(type_counts.items()))}")
    print(f"Updated: {data}")
    print(f"Updated: {reports}")


if __name__ == "__main__":
    main()
