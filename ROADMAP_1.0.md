# Roadmap to 1.0 - closed 2026-10-30

The server-side-banks refactor this file planned is finished and merged:
every bank game serves its curated store from puzzles/<game>/puzzles.json,
the client banks are re-emitted from the stores by tools/export-puzzles.mjs,
and CI verifies the knowledge layer, the stores and the banks on every
push. All the phases completed in order: the server core, the client
repairs, the curated banks, the test layers, and the docs sweep. The
original curated banks were recovered from the pre-refactor client pages
through git history instead of being re-authored, which is why the port
kept its content.

Nothing here is pending. Where the remaining 1.0 work lives now:

- the release and deploy story plus the go-live checklist: README.md
- content conventions and design notes: NOTES.md
- the knowledge layer format reference: knowledge/SCHEMA.md
- the privacy flip when 1.0 ships: Carl flips the repo private in GitHub
  settings (recorded with the decision in NOTES.md and SCHEMA.md)
