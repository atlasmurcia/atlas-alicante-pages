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

## Cambios y publicación

- La referencia inicial para los cambios es el contenido publicado en `main`, no el repositorio privado de desarrollo. Los archivos y módulos difieren; no se deben copiar carpetas completas ni sobrescribir `main` desde el otro repositorio.
- Cada cambio se prepara en una rama creada desde `main`, se prueba con datos sintéticos y se entrega mediante una solicitud de cambios. La revisión debe comprobar también los módulos afectados y sus dependencias.
- No se prueban cobros, facturas, datos clínicos, permisos ni autenticación en producción. Cambios de esas áreas necesitan revisión humana y comprobación en un entorno sintético antes de poder considerarse para publicación.
- La carpeta raíz contiene los archivos estáticos servidos por GitHub Pages. La publicación debe hacerse mediante una solicitud revisada y fusionada en `main`; antes de fusionar, el propietario debe confirmar que GitHub Pages sigue configurado para publicar desde `main` y la raíz. No se usa IONOS para subir los archivos del sitio.
- Para restaurar una versión, se revierte en GitHub el commit de publicación correspondiente y se fusiona esa reversión en `main`; se comprueba después el sitio publicado. No se restauran archivos a mano desde un navegador.
- La prueba sintética de ventas de esta propuesta está en `tests/direct-sale-payments.cjs`. Requiere Node.js, Playwright y Chrome disponibles localmente; no accede a servicios ni datos reales.
