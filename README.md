# ATLAS Alicante

Static source captured from the public Alicante site on 2026-11-13 so future changes can be versioned and published from a dedicated repository, independently of ATLAS Murcia.

## Hosting

- GitHub Pages source: branch `main`, repository root.
- Keep `.nojekyll` so all static assets are served as-is.
- Add the custom domain `atlas-alicante.evenso.es` in GitHub Pages before changing its DNS record.
- The domain's CNAME should point directly to `atlasmurcia.github.io`; DNS remains managed at the current provider.
- Keep this repository separate from `atlasmurcia/atlas-murcia` and the isolated private Cloud workspace.

Preview: https://atlasmurcia.github.io/atlas-alicante-pages/

The FlowAtlas entry point uses relative asset paths so the same bundle works at both the preview path and the final custom-domain root.

## Release safety

This repository is a snapshot of the currently served static files, not the original editable application source. The current release must be reconciled and verified against clinic configuration and FlowAtlas behavior before using it as the long-term source of truth. Do not add patient exports, database rows, credentials, or server keys. Production app data must remain in the Alicante backend.