# Proposal C — Full Catalog Website Management Portal

Static GitHub Pages prototype.

## Contents

- 42 artists
- 875 artwork records
- 8 general/informational pages
- 1736 copied catalog image assets
- Full browsable static site under `live/`
- Draft editing stored in localStorage
- Separate browser-local Publish Preview state
- Add/edit artists and artwork
- Image replacement
- Available / Sold / Hidden status
- Site info and general page editing
- Homepage content editing, including featured artists
- Search and pagination for the complete catalog

## GitHub Pages

Copy the `proposal-c` folder to:

    proposals/proposal-c/

The admin portal will be:

    https://vbeffa.github.io/visions-fine-art/proposals/proposal-c/

The full published-preview site will be:

    https://vbeffa.github.io/visions-fine-art/proposals/proposal-c/live/

## Publishing behavior

`Publish Preview` does not modify GitHub or the real Visions website. It copies the saved draft into a separate localStorage key. The static pages under `live/` read that published state, so edits appear across the full site in the same browser.

This demonstrates the production workflow while keeping GitHub Pages completely static.

## Reset

`Reset Demo` clears both draft and published-preview localStorage and restores the original extracted catalog.

## Production boundary

A real production version would require validation of the hosting environment, full backup/rollback, a verified structured-site regeneration process, authentication, persistent shared storage, and a tested deployment mechanism.

`Publish Preview` is disabled until at least one saved change is waiting to be published.


## Local file testing

The full live preview now works when opened from the admin portal with `file://`.
The admin page passes the last published snapshot to the live-preview tab.

For the most production-like behavior, you can also serve the folder locally:

```bash
cd proposal-c
python -m http.server 8000
```

Then open `http://localhost:8000/`.
