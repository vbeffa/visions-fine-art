# Visions Fine Art crawler


## Version 1.2: canonical artist extraction

Version 1.2 uses the homepage artist cards as the canonical artist roster. This
fixes legacy labels such as promotional text being mistaken for artist names,
and collapses aliases such as `Pino Daeni`/`Pino`, `H Leung`/`H. Leung`,
`John-Mark Gleadow`/`John Gleadow`, and Ulla Darni's secondary collection
directories into the homepage display name.

It also retains homepage "coming soon" artists that do not currently have a
linked artist page.

If a crawl already completed with v1.1, you do **not** need to crawl the site
again. Copy `visions_crawler.py` and `repair_extraction.py` from v1.2 next to
the existing `visions_site` directory, then run:

```bash
python repair_extraction.py visions_site
```

That reparses the mirrored HTML locally and rebuilds the structured JSON/CSV
files without making network requests.


## Version 1.1 note

Version 1.1 fixes a path collision in the original crawler where an explicit
`index.html` URL could be treated as a directory. If you ran the original
version and it stopped with `FileExistsError`, delete the partially generated
output directory before rerunning:

```bash
rm -rf visions_site
```

Then rerun the crawl normally.


This crawler is intended to inventory and mirror the current static Visions Fine Art website before applying a new template.

## What it produces

Running:

```bash
python visions_crawler.py https://www.visionsfineart.com/ -o visions_site
```

creates roughly:

```text
visions_site/
├── site/                    # mirrored HTML/assets
├── data/
│   ├── artists.json         # structured artist records
│   ├── artworks.json        # structured artwork records
│   └── pages.json           # all crawled pages
└── reports/
    ├── summary.json
    ├── pages.csv
    ├── artists.csv
    ├── artworks.csv
    ├── unknown_pages.json   # pages needing manual inspection
    └── errors.json
```

## Install

Python 3.10+ recommended.

```bash
python -m venv .venv
source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
```

On Windows:

```powershell
.venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
python visions_crawler.py
```

The default start URL is:

```text
https://www.visionsfineart.com/
```

A cautious first pass:

```bash
python visions_crawler.py \
  https://www.visionsfineart.com/ \
  -o visions_site \
  --max-pages 500 \
  --delay 0.3
```

Then inspect:

```text
visions_site/reports/summary.json
visions_site/reports/unknown_pages.json
visions_site/reports/errors.json
```

If the inventory looks correct, rerun with the normal page limit.

## Useful options

```text
-o, --output DIR       output directory
--max-pages N          crawl cap (default 3000)
--delay SECONDS        delay between HTML page requests (default .20)
--timeout SECONDS      HTTP timeout (default 20)
--no-assets            inventory HTML only
--no-rewrite           save HTML without rewriting local links
```

## Page classification

The script attempts to recognize:

- homepage
- artist index pages
- individual artwork detail pages
- biography pages
- known general/static pages
- unknown/exception pages

`unknown_pages.json` is intentionally part of the workflow. Those pages should be reviewed before an automated redesign is published.

## Structured data extraction

For artists it tries to collect:

- name
- URL
- biography URL
- meta description/keywords
- representative homepage image
- artist-specific explanatory text

For artworks it tries to collect:

- artist
- title
- detail URL
- thumbnail URL
- full-size image URL
- medium
- edition
- dimensions
- descriptive text
- availability language

The site is old and not every page will follow one template, so the extraction should be treated as a migration aid, not as an unquestioned source of truth.

## Recommended migration workflow

1. Crawl and inventory the complete live site.
2. Review `unknown_pages.json` and `errors.json`.
3. Spot-check several artists and artwork pages.
4. Normalize the JSON data as needed.
5. Apply the chosen redesign template to the normalized data.
6. Generate the replacement static website.
7. Run a link/image checker against the generated result.
8. Manually review exceptional pages before deployment.

The same JSON model can later be used by the Proposal C admin/editor tool.
