#!/usr/bin/env python3
"""
Visions Fine Art crawler / inventory builder.

What it does
------------
1. Crawls same-site HTML pages starting from a URL.
2. Downloads HTML, images, CSS, JavaScript, and other linked local assets.
3. Rewrites downloaded HTML/CSS to point to local copies where possible.
4. Classifies pages into likely page types.
5. Extracts structured artist/artwork/page data into JSON.
6. Writes CSV/JSON inventory reports and an exception report.

Designed around the current static structure of visionsfineart.com, but most of
the crawling/mirroring code is generic.

Usage
-----
    python visions_crawler.py https://www.visionsfineart.com/ -o visions_site

Useful options:
    --delay 0.25
    --max-pages 2000
    --timeout 20
    --no-assets
    --no-rewrite

The script intentionally does NOT publish or modify the live website.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, asdict
from pathlib import Path, PurePosixPath
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import (
    parse_qsl,
    quote,
    unquote,
    urlencode,
    urljoin,
    urlparse,
    urlunparse,
)

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


VERSION = "1.3"

DEFAULT_UA = (
    "Mozilla/5.0 (compatible; VisionsFineArtMigrationCrawler/1.0; "
    "+https://www.visionsfineart.com/)"
)

HTML_EXTENSIONS = {"", ".html", ".htm", ".shtml", ".php", ".asp", ".aspx"}
ASSET_ATTRS = {
    "img": ("src",),
    "script": ("src",),
    "link": ("href",),
    "source": ("src", "srcset"),
    "video": ("src", "poster"),
    "audio": ("src",),
    "iframe": ("src",),
}
SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "data:", "blob:")
CSS_URL_RE = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\(\s*)?(['\"]?)(.*?)\1\s*\)?",
    re.I,
)

# Known top-level informational pages that are not artist/artwork pages.
KNOWN_GENERIC_STEMS = {
    "guarantee",
    "contact",
    "newsletter",
    "events",
    "damaged",
    "tour",
    "index",
}


@dataclass
class PageRecord:
    url: str
    local_path: str
    status: int
    content_type: str
    title: str = ""
    page_type: str = "unknown"
    artist_name: str = ""
    artwork_title: str = ""
    error: str = ""


@dataclass
class ArtistRecord:
    name: str
    url: str
    local_path: str
    biography_url: str = ""
    description: str = ""
    keywords: str = ""
    representative_image: str = ""
    extra_text: str = ""


@dataclass
class ArtworkRecord:
    artist: str
    title: str
    url: str
    local_path: str
    thumbnail_url: str = ""
    image_url: str = ""
    medium: str = ""
    edition: str = ""
    dimensions: str = ""
    description: str = ""
    availability: str = ""


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def make_session(user_agent: str) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        status=4,
        backoff_factor=0.6,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "HEAD"),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    s.headers.update({"User-Agent": user_agent})
    return s


def canonical_host(host: str) -> str:
    host = host.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def normalize_url(url: str, base: Optional[str] = None) -> Optional[str]:
    if not url:
        return None
    url = url.strip()
    if url.startswith(SKIP_SCHEMES) or url.startswith("#"):
        return None
    if base:
        url = urljoin(base, url)

    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        return None

    # Remove fragments and common tracking parameters. Preserve other query
    # parameters, although the mirror path will hash them to avoid collisions.
    params = [
        (k, v)
        for k, v in parse_qsl(p.query, keep_blank_values=True)
        if not k.lower().startswith("utm_")
    ]
    query = urlencode(params, doseq=True)
    path = re.sub(r"/{2,}", "/", p.path or "/")

    # Treat explicit directory index pages as the directory URL. This avoids
    # crawling/saving both "/" and "/index.html", or both "/ho/" and
    # "/ho/index.html", as separate pages.
    lower_path = path.lower()
    for index_name in ("/index.html", "/index.htm"):
        if lower_path.endswith(index_name):
            path = path[: -len(index_name)] + "/"
            break

    return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", query, ""))


def same_site(url: str, root_host: str) -> bool:
    try:
        return canonical_host(urlparse(url).netloc) == canonical_host(root_host)
    except Exception:
        return False


def is_probable_html(url: str) -> bool:
    p = urlparse(url)
    suffix = Path(p.path).suffix.lower()
    return suffix in HTML_EXTENSIONS


def safe_component(s: str) -> str:
    s = unquote(s)
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s)
    s = s.strip("._")
    return s or "_"


def url_to_local_path(url: str, root: Path, force_html: bool = False) -> Path:
    """
    Map URL to a stable path under root/site/.
    - /foo/ -> /foo/index.html
    - /foo -> /foo/index.html if force_html / probable html
    - queries get an 8-char hash suffix
    """
    p = urlparse(url)
    path = PurePosixPath(p.path or "/")
    parts = [safe_component(x) for x in path.parts if x not in ("/", "")]

    if not parts:
        parts = ["index.html"]
    else:
        last = parts[-1]
        suffix = Path(last).suffix
        if path.as_posix().endswith("/"):
            parts.append("index.html")
        elif not suffix and (force_html or is_probable_html(url)):
            # Extensionless page URL, e.g. /artist -> /artist/index.html.
            # Do NOT append index.html after an explicit file such as
            # /newsletter.html.
            parts.append("index.html")

    if p.query:
        qhash = hashlib.sha1(p.query.encode("utf-8")).hexdigest()[:8]
        stem = Path(parts[-1]).stem
        suffix = Path(parts[-1]).suffix or ".html"
        parts[-1] = f"{stem}__q_{qhash}{suffix}"

    return root / "site" / Path(*parts)


def rel_href(from_file: Path, to_file: Path) -> str:
    return os.path.relpath(to_file, start=from_file.parent).replace(os.sep, "/")


def write_bytes(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def get_text_safely(resp: requests.Response) -> str:
    # requests' apparent_encoding can help with the site's Windows-1252 pages.
    if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
        try:
            resp.encoding = resp.apparent_encoding or resp.encoding
        except Exception:
            pass
    return resp.text


def clean_text(node) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def meta_content(soup: BeautifulSoup, name: str) -> str:
    tag = soup.find("meta", attrs={"name": re.compile(f"^{re.escape(name)}$", re.I)})
    return (tag.get("content") or "").strip() if tag else ""


def detect_page_type(url: str, soup: BeautifulSoup) -> Tuple[str, str, str]:
    """
    Returns (page_type, artist_name, artwork_title).
    """
    p = urlparse(url)
    path_parts = [x for x in p.path.split("/") if x]
    basename = Path(p.path).name.lower()
    stem = Path(basename).stem.lower()

    title = clean_text(soup.title)

    if len(path_parts) <= 1 and stem in ("", "index"):
        return "home", "", ""

    if stem in KNOWN_GENERIC_STEMS and len(path_parts) <= 1:
        return "generic", "", ""

    if "artsecrets" in [x.lower() for x in path_parts]:
        return "generic", "", ""

    if "aa_pedestals" in [x.lower() for x in path_parts]:
        return "generic", "", ""

    # Biography pages are normally /artist/bio/bio.html, but some legacy
    # artists (notably Thomas Arvid) use /artist/bio.html.
    if any(x.lower() == "bio" for x in path_parts) or basename in (
        "bio.html",
        "bio.htm",
    ):
        return "biography", "", ""

    artist_name_node = soup.select_one(".artistnamesm")
    artlabel2 = soup.select(".artlabel2")

    # Artist index pages have the artist name and many thumbnail cards.
    cards = soup.select(".artlabel a")
    if artist_name_node and len(cards) >= 2:
        artist_name = clean_text(artist_name_node)
        return "artist_index", artist_name, ""

    # Artwork pages generally have artistnamesm like "Adam, by Gaylord Ho"
    # and a full-size image inside .artlabel2.
    if artist_name_node and artlabel2:
        heading = clean_text(artist_name_node)
        m = re.match(r"(.+?),\s*by\s+(.+)$", heading, flags=re.I)
        if m:
            return "artwork_detail", m.group(2).strip(), m.group(1).strip()

    # Fallback on title pattern. Most pages use "Title, by Artist", while
    # Thomas Arvid's legacy pages use "Title by Thomas Arvid". Strip the site's
    # standard title prefix first so "Sedona Arizona -" is never mistaken for
    # part of the artwork title.
    title_tail = re.sub(
        r"^Visions\s+Fine\s+Art\s+Gallery\s*-\s*Sedona\s+Arizona\s*-\s*",
        "",
        title,
        flags=re.I,
    ).strip()
    m = re.fullmatch(r"(.+?)\s*,?\s+by\s+(.+)", title_tail, flags=re.I)
    if m:
        return "artwork_detail", m.group(2).strip(), m.group(1).strip()

    # A directory/index page under a first-level folder with many artlabel cards.
    if len(path_parts) >= 2 and basename.lower() in ("index.html", "index.htm") and len(cards) >= 2:
        # Try to infer artist from title.
        m2 = re.search(r"-\s*([^-]+)$", title)
        inferred = m2.group(1).strip() if m2 else ""
        return "artist_index", inferred, ""

    return "unknown", "", ""


def extract_home_artists(soup: BeautifulSoup, page_url: str) -> List[dict]:
    """
    Use the homepage artist cards as the canonical artist roster.

    The homepage contains the cleanest display names and representative images.
    Some "coming soon" artists have no link yet; retain those records with an
    empty URL so they can still be represented in a future generated site.
    """
    out = []
    for block in soup.select(".artlabel"):
        a = block.find("a", href=True)
        img = block.find("img", src=True)

        name = clean_text(a) if a else clean_text(block)
        if not name:
            continue

        out.append({
            "name": name,
            "url": normalize_url(a["href"], page_url) if a else "",
            "representative_image": normalize_url(img["src"], page_url) if img else "",
        })
    return out


def artist_match_key(value: str) -> str:
    """Loose comparison key for matching canonical homepage artist names."""
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.casefold().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "", value)


def extract_artist(soup: BeautifulSoup, url: str, local_path: Path) -> ArtistRecord:
    artist_name = clean_text(soup.select_one(".artistnamesm"))
    if not artist_name:
        # Fallback from title's last segment.
        title = clean_text(soup.title)
        artist_name = title.rsplit(" - ", 1)[-1].strip() if title else ""

    bio_url = ""
    for a in soup.find_all("a", href=True):
        txt = clean_text(a).lower()
        if "artist biography" in txt or "/bio/" in a["href"].lower():
            bio_url = normalize_url(a["href"], url) or ""
            break

    extra_text = ""
    long_text = soup.select_one(".artlabel2")
    if long_text:
        extra_text = clean_text(long_text)

    return ArtistRecord(
        name=artist_name,
        url=url,
        local_path=str(local_path),
        biography_url=bio_url,
        description=meta_content(soup, "description"),
        keywords=meta_content(soup, "keywords"),
        extra_text=extra_text,
    )


def extract_artist_artworks(
    soup: BeautifulSoup, artist_name: str, page_url: str
) -> List[ArtworkRecord]:
    records = []
    for block in soup.select(".artlabel"):
        a = block.find("a", href=True)
        img = block.find("img", src=True)
        if not a:
            continue
        title = clean_text(a)
        if not title:
            continue
        records.append(
            ArtworkRecord(
                artist=artist_name,
                title=title,
                url=normalize_url(a["href"], page_url) or "",
                local_path="",
                thumbnail_url=normalize_url(img["src"], page_url) if img else "",
            )
        )
    return records


def parse_artwork_detail(
    soup: BeautifulSoup,
    url: str,
    local_path: Path,
    artist_hint: str = "",
    title_hint: str = "",
) -> ArtworkRecord:
    heading = clean_text(soup.select_one(".artistnamesm"))
    artist = artist_hint
    title = title_hint
    if heading:
        m = re.match(r"(.+?),\s*by\s+(.+)$", heading, flags=re.I)
        if m:
            title = m.group(1).strip()
            artist = m.group(2).strip()

    container = soup.select_one(".artlabel2")
    image_url = ""
    lines: List[str] = []
    if container:
        img = container.find("img", src=True)
        if img:
            image_url = normalize_url(img["src"], url) or ""

        for child in container.find_all(["div", "p"], recursive=True):
            text = clean_text(child)
            if text and text not in lines:
                lines.append(text)

    # Remove title duplicate such as '" Adam "'.
    normalized_title = re.sub(r'^[\s"\']+|[\s"\']+$', "", title or "").lower()
    filtered = []
    for line in lines:
        norm = re.sub(r'^[\s"\']+|[\s"\']+$', "", line).lower()
        if norm == normalized_title:
            continue
        filtered.append(line)
    lines = filtered

    medium = ""
    edition = ""
    dimensions = ""
    description_parts = []

    dim_re = re.compile(
        r"\b\d+(?:[¼½¾⅛⅜⅝⅞]|\s+\d+/\d+|\.\d+)?\s*[\"”']?\s*[hwd]\b",
        re.I,
    )
    for line in lines:
        low = line.lower()
        if "edition size" in low or low.startswith("edition "):
            edition = re.sub(r"(?i)^edition(?:\s+size)?\s*[:\-]?\s*", "", line).strip(" .")
        elif dim_re.search(line) and (" x " in low or "×" in line):
            dimensions = line.strip(" .")
        elif (
            "sculpture" in low
            or "painting" in low
            or "giclee" in low
            or "serigraph" in low
            or "bronze" in low
            or "parian" in low
            or "glass" in low
        ) and not medium:
            medium = line.strip(" .")
        else:
            description_parts.append(line)

    return ArtworkRecord(
        artist=artist,
        title=title,
        url=url,
        local_path=str(local_path),
        image_url=image_url,
        medium=medium,
        edition=edition,
        dimensions=dimensions,
        description=" ".join(description_parts).strip(),
        availability="Please call the gallery for current availability",
    )


def iter_links(soup: BeautifulSoup, page_url: str) -> Iterable[str]:
    for a in soup.find_all("a", href=True):
        u = normalize_url(a.get("href"), page_url)
        if u:
            yield u


def iter_html_assets(soup: BeautifulSoup, page_url: str) -> Iterable[Tuple[object, str, str]]:
    """
    Yield (tag, attribute, absolute_url).
    srcset is handled separately by rewrite_html.
    """
    for tag_name, attrs in ASSET_ATTRS.items():
        for tag in soup.find_all(tag_name):
            for attr in attrs:
                if attr == "srcset":
                    continue
                value = tag.get(attr)
                if not value:
                    continue
                u = normalize_url(value, page_url)
                if u:
                    yield tag, attr, u


def parse_srcset(value: str, page_url: str) -> List[Tuple[str, str]]:
    out = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        bits = part.split()
        u = normalize_url(bits[0], page_url)
        descriptor = " ".join(bits[1:])
        if u:
            out.append((u, descriptor))
    return out


class Crawler:
    def __init__(
        self,
        start_url: str,
        output: Path,
        max_pages: int,
        delay: float,
        timeout: float,
        download_assets: bool,
        rewrite: bool,
        user_agent: str,
    ):
        self.start_url = normalize_url(start_url) or start_url
        self.output = output.resolve()
        self.max_pages = max_pages
        self.delay = delay
        self.timeout = timeout
        self.download_assets = download_assets
        self.rewrite = rewrite
        self.session = make_session(user_agent)
        self.root_host = urlparse(self.start_url).netloc

        self.visited_pages: Set[str] = set()
        self.queued_pages: Set[str] = {self.start_url}
        self.asset_urls: Set[str] = set()
        self.downloaded_assets: Dict[str, Path] = {}
        self.page_paths: Dict[str, Path] = {}
        self.pages: List[PageRecord] = []
        self.artists: Dict[str, ArtistRecord] = {}
        self.artworks: Dict[str, ArtworkRecord] = {}
        self.home_artist_refs: List[dict] = []
        self.home_artist_by_url: Dict[str, dict] = {}
        self.home_artist_by_name: Dict[str, dict] = {}
        self.errors: List[dict] = []
        self.unknown_pages: List[dict] = []

        (self.output / "site").mkdir(parents=True, exist_ok=True)
        (self.output / "reports").mkdir(parents=True, exist_ok=True)
        (self.output / "data").mkdir(parents=True, exist_ok=True)

    def _register_home_artists(self, items: List[dict]):
        """
        Register homepage cards immediately so later artist/artwork extraction
        can use homepage names as canonical labels.
        """
        for item in items:
            name = (item.get("name") or "").strip()
            url = normalize_url(item.get("url") or "") if item.get("url") else ""
            image = item.get("representative_image") or ""
            if not name:
                continue

            normalized = {
                "name": name,
                "url": url,
                "representative_image": image,
            }
            self.home_artist_refs.append(normalized)
            self.home_artist_by_name[name.casefold()] = normalized
            if url:
                self.home_artist_by_url[url] = normalized

            key = name.casefold()
            existing = self.artists.get(key)
            if existing is None:
                predicted_local = (
                    url_to_local_path(url, self.output, force_html=True) if url else None
                )
                self.artists[key] = ArtistRecord(
                    name=name,
                    url=url,
                    local_path=str(predicted_local) if predicted_local else "",
                    representative_image=image,
                )
            else:
                if url and not existing.url:
                    existing.url = url
                if image and not existing.representative_image:
                    existing.representative_image = image

    def _canonical_artist_name(
        self,
        page_url: str,
        raw_name: str = "",
        page_title: str = "",
    ) -> str:
        """
        Resolve legacy artist labels to the clean homepage display name.

        Priority:
        1. Artist URL / URL-prefix match (most reliable).
        2. Canonical homepage name appearing in the page title/raw label.
        3. The raw extracted name as a fallback.

        URL-prefix matching also fixes artwork pages such as /pino/foo.html.
        Text matching handles Ulla Darni's legacy sibling directories such as
        /darni_mo_sconces/, whose URL does not sit beneath her main directory.
        """
        current = normalize_url(page_url) or page_url

        matches = []
        for artist_url, item in self.home_artist_by_url.items():
            if current == artist_url or current.startswith(artist_url):
                matches.append((len(artist_url), item["name"]))
        if matches:
            matches.sort(reverse=True)
            return matches[0][1]

        context_key = artist_match_key(f"{raw_name} {page_title}")
        if context_key:
            textual = []
            for item in self.home_artist_refs:
                name = item.get("name") or ""
                key = artist_match_key(name)
                if key and key in context_key:
                    textual.append((len(key), name))
            if textual:
                textual.sort(reverse=True)
                return textual[0][1]

        return (raw_name or "").strip()

    def _canonical_artist_url(self, canonical_name: str) -> str:
        item = self.home_artist_by_name.get((canonical_name or "").casefold())
        return (item or {}).get("url", "")

    def _merge_artist_record(self, record: ArtistRecord, source_url: str):
        """
        Merge data into one canonical artist record instead of creating aliases.
        Prefer metadata from the artist's primary homepage-linked index page over
        secondary collection/index pages.
        """
        if not record.name:
            return

        key = record.name.casefold()
        existing = self.artists.get(key)
        canonical_url = self._canonical_artist_url(record.name)
        is_primary = bool(canonical_url and normalize_url(source_url) == canonical_url)

        if existing is None:
            self.artists[key] = record
            return

        # Preserve the homepage's canonical URL/name and representative image.
        if canonical_url:
            existing.url = canonical_url
            existing.local_path = str(
                url_to_local_path(canonical_url, self.output, force_html=True)
            )
        elif not existing.url:
            existing.url = record.url
            existing.local_path = record.local_path

        if record.representative_image and not existing.representative_image:
            existing.representative_image = record.representative_image

        # Primary artist page is authoritative for artist-level metadata.
        fields = ("biography_url", "description", "keywords", "extra_text")
        for field in fields:
            value = getattr(record, field)
            if value and (is_primary or not getattr(existing, field)):
                setattr(existing, field, value)

    def fetch(self, url: str) -> Optional[requests.Response]:
        try:
            r = self.session.get(url, timeout=self.timeout, allow_redirects=True)
            return r
        except requests.RequestException as exc:
            self.errors.append({"url": url, "error": repr(exc)})
            eprint(f"[ERROR] {url}: {exc}")
            return None

    def crawl(self):
        queue: List[str] = [self.start_url]
        while queue and len(self.visited_pages) < self.max_pages:
            url = queue.pop(0)
            self.queued_pages.discard(url)
            if url in self.visited_pages:
                continue
            if not same_site(url, self.root_host):
                continue

            self.visited_pages.add(url)
            print(f"[PAGE {len(self.visited_pages):4d}] {url}")

            r = self.fetch(url)
            if r is None:
                continue

            final_url = normalize_url(r.url) or url
            content_type = (r.headers.get("Content-Type") or "").lower()
            local_path = url_to_local_path(final_url, self.output, force_html=True)
            self.page_paths[url] = local_path
            self.page_paths[final_url] = local_path

            if r.status_code >= 400:
                self.pages.append(
                    PageRecord(
                        url=final_url,
                        local_path=str(local_path),
                        status=r.status_code,
                        content_type=content_type,
                        error=f"HTTP {r.status_code}",
                    )
                )
                self.errors.append({"url": final_url, "error": f"HTTP {r.status_code}"})
                continue

            if "text/html" not in content_type and not is_probable_html(final_url):
                # The link looked like a page but actually returned an asset.
                if self.download_assets:
                    self._save_asset_response(final_url, r)
                continue

            text = get_text_safely(r)
            soup = BeautifulSoup(text, "html.parser")
            page_type, artist_hint, artwork_hint = detect_page_type(final_url, soup)
            title = clean_text(soup.title)

            # Queue same-site HTML links.
            for link in iter_links(soup, final_url):
                if same_site(link, self.root_host) and is_probable_html(link):
                    if link not in self.visited_pages and link not in self.queued_pages:
                        queue.append(link)
                        self.queued_pages.add(link)

            # Download linked assets before writing the HTML so rewriting has paths.
            if self.download_assets:
                for _, _, asset_url in iter_html_assets(soup, final_url):
                    if same_site(asset_url, self.root_host):
                        self.download_asset(asset_url)

                for tag in soup.find_all(attrs={"srcset": True}):
                    for asset_url, _ in parse_srcset(tag.get("srcset", ""), final_url):
                        if same_site(asset_url, self.root_host):
                            self.download_asset(asset_url)

            # Extract structured content. Homepage display names are canonical.
            record_artist_name = artist_hint
            record_artwork_title = artwork_hint

            if page_type == "home":
                self._register_home_artists(extract_home_artists(soup, final_url))

            elif page_type == "artist_index":
                artist = extract_artist(soup, final_url, local_path)
                canonical_name = self._canonical_artist_name(
                    final_url, artist.name or artist_hint, title
                )
                if canonical_name:
                    artist.name = canonical_name
                    canonical_url = self._canonical_artist_url(canonical_name)
                    if canonical_url:
                        artist.url = canonical_url
                        artist.local_path = str(
                            url_to_local_path(
                                canonical_url, self.output, force_html=True
                            )
                        )
                    self._merge_artist_record(artist, final_url)
                    record_artist_name = canonical_name

                for art in extract_artist_artworks(
                    soup, canonical_name or artist.name, final_url
                ):
                    if art.url:
                        existing = self.artworks.get(art.url)
                        if existing and existing.thumbnail_url and not art.thumbnail_url:
                            art.thumbnail_url = existing.thumbnail_url
                        self.artworks[art.url] = art

            elif page_type == "artwork_detail":
                art = parse_artwork_detail(
                    soup, final_url, local_path, artist_hint, artwork_hint
                )
                canonical_name = self._canonical_artist_name(
                    final_url, art.artist or artist_hint, title
                )
                if canonical_name:
                    art.artist = canonical_name
                    record_artist_name = canonical_name
                record_artwork_title = art.title or artwork_hint

                if art.url:
                    existing = self.artworks.get(art.url)
                    if existing and existing.thumbnail_url and not art.thumbnail_url:
                        art.thumbnail_url = existing.thumbnail_url
                    self.artworks[art.url] = art

            elif page_type == "biography":
                canonical_name = self._canonical_artist_name(
                    final_url, artist_hint, title
                )
                if canonical_name:
                    record_artist_name = canonical_name

            elif page_type == "unknown":
                self.unknown_pages.append({"url": final_url, "title": title})

            if self.rewrite:
                self.rewrite_html(soup, final_url, local_path)
                out_text = str(soup)
                local_path.parent.mkdir(parents=True, exist_ok=True)
                local_path.write_text(out_text, encoding="utf-8", errors="replace")
            else:
                local_path.parent.mkdir(parents=True, exist_ok=True)
                local_path.write_text(text, encoding="utf-8", errors="replace")

            self.pages.append(
                PageRecord(
                    url=final_url,
                    local_path=str(local_path),
                    status=r.status_code,
                    content_type=content_type,
                    title=title,
                    page_type=page_type,
                    artist_name=record_artist_name,
                    artwork_title=record_artwork_title,
                )
            )

            if self.delay:
                time.sleep(self.delay)

        self._merge_home_artist_data()
        self._fill_artwork_local_paths()
        self.write_reports()

    def _merge_home_artist_data(self):
        # Homepage records were registered at crawl time. This final pass fills
        # any paths/images that became known later without introducing aliases.
        for item in self.home_artist_refs:
            name = (item.get("name") or "").strip()
            if not name:
                continue
            key = name.casefold()
            existing = self.artists.get(key)
            if existing is None:
                continue
            url = item.get("url") or ""
            if url:
                existing.url = url
                existing.local_path = str(
                    self.page_paths.get(url)
                    or url_to_local_path(url, self.output, force_html=True)
                )
            image = item.get("representative_image") or ""
            if image:
                existing.representative_image = image

        # Normalize every artwork one final time, including records first seen
        # on a secondary legacy collection page.
        for art in self.artworks.values():
            canonical = self._canonical_artist_name(art.url, art.artist, "")
            if canonical:
                art.artist = canonical


    def _fill_artwork_local_paths(self):
        for art in self.artworks.values():
            if art.url and not art.local_path:
                p = self.page_paths.get(art.url)
                if p:
                    art.local_path = str(p)

    def download_asset(self, url: str) -> Optional[Path]:
        if url in self.downloaded_assets:
            return self.downloaded_assets[url]
        if not same_site(url, self.root_host):
            return None

        local_path = url_to_local_path(url, self.output, force_html=False)
        self.downloaded_assets[url] = local_path
        self.asset_urls.add(url)

        if local_path.exists():
            return local_path

        r = self.fetch(url)
        if r is None or r.status_code >= 400:
            self.errors.append(
                {"url": url, "error": f"Asset HTTP {getattr(r, 'status_code', 'request error')}"}
            )
            return None

        self._save_asset_response(url, r, local_path)
        return local_path

    def _save_asset_response(
        self, url: str, r: requests.Response, local_path: Optional[Path] = None
    ):
        local_path = local_path or url_to_local_path(url, self.output, force_html=False)
        ctype = (r.headers.get("Content-Type") or "").lower()

        if "text/css" in ctype or local_path.suffix.lower() == ".css":
            text = get_text_safely(r)
            if self.rewrite:
                text = self.rewrite_css(text, url, local_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_text(text, encoding="utf-8", errors="replace")
        else:
            write_bytes(local_path, r.content)

    def rewrite_css(self, text: str, css_url: str, css_path: Path) -> str:
        def repl_url(m):
            quote_char = m.group(1) or ""
            raw = m.group(2).strip()
            u = normalize_url(raw, css_url)
            if not u or not same_site(u, self.root_host):
                return m.group(0)
            p = self.download_asset(u)
            if not p:
                return m.group(0)
            return f"url({quote_char}{rel_href(css_path, p)}{quote_char})"

        text = CSS_URL_RE.sub(repl_url, text)

        def repl_import(m):
            quote_char = m.group(1) or '"'
            raw = m.group(2).strip()
            u = normalize_url(raw, css_url)
            if not u or not same_site(u, self.root_host):
                return m.group(0)
            p = self.download_asset(u)
            if not p:
                return m.group(0)
            return f'@import {quote_char}{rel_href(css_path, p)}{quote_char}'

        return CSS_IMPORT_RE.sub(repl_import, text)

    def rewrite_html(self, soup: BeautifulSoup, page_url: str, page_path: Path):
        # Rewrite same-site anchors to where those pages will be mirrored.
        for a in soup.find_all("a", href=True):
            raw = a["href"]
            u = normalize_url(raw, page_url)
            if not u or not same_site(u, self.root_host):
                continue
            if is_probable_html(u):
                target = self.page_paths.get(u) or url_to_local_path(
                    u, self.output, force_html=True
                )
                a["href"] = rel_href(page_path, target)

        # Rewrite assets.
        for tag_name, attrs in ASSET_ATTRS.items():
            for tag in soup.find_all(tag_name):
                for attr in attrs:
                    if attr == "srcset":
                        value = tag.get(attr)
                        if not value:
                            continue
                        parts = []
                        for u, descriptor in parse_srcset(value, page_url):
                            if same_site(u, self.root_host):
                                p = self.downloaded_assets.get(u)
                                new_u = rel_href(page_path, p) if p else u
                            else:
                                new_u = u
                            parts.append(f"{new_u} {descriptor}".strip())
                        if parts:
                            tag[attr] = ", ".join(parts)
                        continue

                    value = tag.get(attr)
                    if not value:
                        continue
                    u = normalize_url(value, page_url)
                    if not u or not same_site(u, self.root_host):
                        continue
                    p = self.downloaded_assets.get(u)
                    if p:
                        tag[attr] = rel_href(page_path, p)

    def write_reports(self):
        reports = self.output / "reports"
        data = self.output / "data"

        # pages.csv
        with (reports / "pages.csv").open("w", newline="", encoding="utf-8") as f:
            fields = list(PageRecord.__dataclass_fields__.keys())
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for rec in self.pages:
                w.writerow(asdict(rec))

        # artists.csv / json
        artists = sorted(self.artists.values(), key=lambda x: x.name.lower())
        with (reports / "artists.csv").open("w", newline="", encoding="utf-8") as f:
            fields = list(ArtistRecord.__dataclass_fields__.keys())
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for rec in artists:
                w.writerow(asdict(rec))
        (data / "artists.json").write_text(
            json.dumps([asdict(x) for x in artists], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        # artworks.csv / json
        artworks = sorted(
            self.artworks.values(), key=lambda x: (x.artist.lower(), x.title.lower())
        )
        with (reports / "artworks.csv").open("w", newline="", encoding="utf-8") as f:
            fields = list(ArtworkRecord.__dataclass_fields__.keys())
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for rec in artworks:
                w.writerow(asdict(rec))
        (data / "artworks.json").write_text(
            json.dumps([asdict(x) for x in artworks], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        # All pages as JSON for later conversion/template code.
        (data / "pages.json").write_text(
            json.dumps([asdict(x) for x in self.pages], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        (reports / "unknown_pages.json").write_text(
            json.dumps(self.unknown_pages, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (reports / "errors.json").write_text(
            json.dumps(self.errors, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        type_counts: Dict[str, int] = {}
        for p in self.pages:
            type_counts[p.page_type] = type_counts.get(p.page_type, 0) + 1

        summary = {
            "start_url": self.start_url,
            "pages_fetched": len(self.pages),
            "page_types": dict(sorted(type_counts.items())),
            "artists": len(artists),
            "artworks": len(artworks),
            "assets_discovered": len(self.asset_urls),
            "assets_downloaded": len(
                [p for p in self.downloaded_assets.values() if p.exists()]
            ),
            "unknown_pages": len(self.unknown_pages),
            "errors": len(self.errors),
        }
        (reports / "summary.json").write_text(
            json.dumps(summary, indent=2), encoding="utf-8"
        )

        print("\n=== Crawl summary ===")
        print(json.dumps(summary, indent=2))
        print(f"\nMirror:  {self.output / 'site'}")
        print(f"Data:    {self.output / 'data'}")
        print(f"Reports: {self.output / 'reports'}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Crawl and inventory the Visions Fine Art static website."
    )
    p.add_argument(
        "start_url",
        nargs="?",
        default="https://www.visionsfineart.com/",
        help="Starting URL (default: https://www.visionsfineart.com/)",
    )
    p.add_argument(
        "-o",
        "--output",
        default="visions_site",
        help="Output directory (default: visions_site)",
    )
    p.add_argument(
        "--max-pages",
        type=int,
        default=3000,
        help="Maximum HTML pages to crawl (default: 3000)",
    )
    p.add_argument(
        "--delay",
        type=float,
        default=0.20,
        help="Delay between HTML page requests, seconds (default: 0.20)",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="Per-request timeout in seconds (default: 20)",
    )
    p.add_argument(
        "--user-agent",
        default=DEFAULT_UA,
        help="HTTP User-Agent string",
    )
    p.add_argument(
        "--no-assets",
        action="store_true",
        help="Do not download linked same-site assets",
    )
    p.add_argument(
        "--no-rewrite",
        action="store_true",
        help="Do not rewrite same-site links/assets to local mirror paths",
    )
    return p


def main():
    args = build_parser().parse_args()
    crawler = Crawler(
        start_url=args.start_url,
        output=Path(args.output),
        max_pages=args.max_pages,
        delay=max(0.0, args.delay),
        timeout=max(1.0, args.timeout),
        download_assets=not args.no_assets,
        rewrite=not args.no_rewrite,
        user_agent=args.user_agent,
    )
    crawler.crawl()


if __name__ == "__main__":
    main()
