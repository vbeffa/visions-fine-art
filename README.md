# Visions Fine Art

Prototype, proposal, and migration tooling for a prospective website modernization engagement with Visions Fine Art Gallery.

This repository is **not** the source repository for the gallery's production website. It contains client-facing proposal prototypes and technical tooling used to understand the current site and evaluate migration/redesign options. No production deployment should be performed from this repository without an explicit agreement and a verified migration plan.

## Current status

The work is currently in the proposal/discovery stage. Three work streams have been prepared and can be considered independently or combined:

1. **Hosting migration** — move the existing site to modern hosting while preserving the current site and minimizing disruption.
2. **Website redesign** — apply a new visual direction to the existing gallery content.
3. **Website management portal** — make the artist/artwork catalog easier to maintain without editing HTML directly.

Current visual feedback is to retain the gallery's gold text treatment and move the background toward a warmer black.

The cross-client sales status for this opportunity belongs in the private **Tech Consulting** GitHub Project. This repository should contain only Visions-specific technical/prototype work.

## Repository layout

```text
docs/
└── proposals/
    ├── index.html             # client-facing proposal overview
    ├── proposal-a/            # hosting migration proposal
    ├── proposal-b/            # redesign concepts and generated prototype pages
    └── proposal-c/            # catalog/admin prototype and full static preview

tools/
└── crawler/
    ├── README.md
    ├── visions_crawler.py
    ├── repair_extraction.py
    └── requirements.txt
```

The proposal material under `docs/proposals/` is intended for browser/GitHub Pages review. The repository is public, so do not commit credentials, private account information, client secrets, or other sensitive material.

## Proposal A — hosting migration

See [`docs/proposals/proposal-a/`](docs/proposals/proposal-a/).

The migration proposal keeps the existing site intact while moving it to a modern hosting environment. The expected workflow includes:

- review current hosting, domain/DNS configuration, and available access
- create or verify a complete backup
- configure the new hosting environment
- transfer the site
- test pages, links, images, and basic functionality
- configure SSL and complete DNS cutover
- verify the site after migration

Email and DNS need particular care during any cutover. The proposal deliberately treats unknown legacy/server-side behavior as something to verify before committing to a fixed migration scope.

## Proposal B — redesign

See [`docs/proposals/proposal-b/`](docs/proposals/proposal-b/).

Three working design directions have been generated from real Visions content:

- **Heritage Luxury**
- **Musea Art Gallery**
- **Virtual Tour**

The prototype package uses normalized data from the site crawl and includes representative artists, biographies, gallery-information pages, and hundreds of generated artwork-detail pages. Generated links and local image references are checked automatically, but the package is still a prototype and does not replace manual QA before production.

The redesign approach is intentionally compatible with a largely static generated site so that the gallery does not have to adopt an expensive hosted art-management SaaS product just to modernize the presentation.

## Proposal C — website management portal

See [`docs/proposals/proposal-c/`](docs/proposals/proposal-c/).

The current prototype includes:

- 42 artists
- 875 artwork records
- a full browsable static preview
- add/edit artist and artwork workflows
- image replacement
- Available / Sold / Hidden status
- site-information and general-page editing
- homepage/featured-artist editing
- search and pagination

The prototype stores edits and its Publish Preview state in browser `localStorage`. **Publish Preview does not modify GitHub or the real gallery website.**

A production implementation would still need decisions and implementation around:

- authentication and authorization
- persistent shared storage
- image handling
- validation
- backup and rollback
- static-site regeneration
- deployment/publishing
- production hosting integration

## Site inventory and crawler

See [`tools/crawler/README.md`](tools/crawler/README.md) for full usage instructions.

The crawler mirrors and inventories the existing site and extracts normalized artist/artwork/page data. Its output is intended to support migration and redesign work rather than act as an unquestioned source of truth.

Typical output:

```text
visions_site/
├── site/
├── data/
│   ├── artists.json
│   ├── artworks.json
│   └── pages.json
└── reports/
    ├── summary.json
    ├── pages.csv
    ├── artists.csv
    ├── artworks.csv
    ├── unknown_pages.json
    └── errors.json
```

The current extraction uses the homepage artist cards as the canonical artist roster and repairs several legacy naming/path inconsistencies. Unknown and exceptional pages should be manually reviewed before any generated replacement site is published.

## Production boundaries

Before any production work, verify the selected scope and then:

1. obtain the necessary hosting/domain access using delegated or temporary access where possible
2. create and verify a complete backup of the current site
3. confirm DNS and email dependencies before changing hosting or nameservers
4. review crawler errors and exceptional pages
5. spot-check normalized artist/artwork data
6. finalize the approved visual direction if Proposal B is selected
7. define authentication/storage/deployment architecture if Proposal C is selected
8. test generated pages, links, images, redirects, and rollback procedures before cutover

Do not make a production DNS, hosting, or publishing change solely from assumptions derived from the public website or prototype.

## Working with this repository in ChatGPT

For a new Visions-specific chat, this README is the starting context. Then inspect the relevant proposal or crawler README as needed.

Use this repository for Visions-specific implementation issues and pull requests. Keep prospect/follow-up/sales-pipeline information in the private Tech Consulting project rather than duplicating CRM data here.
