# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Free-text routing files: a routing file can be plain prose, and the skill
  follows it directly. Structured flows remain optional.
- `context-preload editor <file>` opens the visual editor with a routing file
  loaded (via a temporary HTML copy).
- A **Raw** mode in the editor for editing free-text routing files without
  losing prose.

### Fixed

- English copy and identifiers across the CLI, editor and documentation.

## [0.1.0] — 2026-10-28

### Added

- `routing-context-flow.md` language (CRL v1): front matter, `Global`
  section, flows with `read`, `optional`, `skip`, `includes`, `budget`,
  `steps`, `rules` and `done when`.
- Parser, canonical serializer and structural validator in a dependency-free,
  browser-safe core.
- Glob engine supporting `*`, `**`, `?`, `{a,b}` and `[abc]`.
- Resolver: include merging, skip/ignore filtering, file de-duplication,
  token estimation and missing/empty path reporting.
- Flow inference from natural language (`pick`) and interactive menu
  (`interactive`).
- CLI commands: `list`, `show`, `resolve`, `validate`, `pick`, `interactive`,
  `init`, `editor`.
- Single-file offline visual editor with import/export, download, copy,
  live preview, structural validation and local autosave.
- Universal `SKILL.md` for OpenCode and Claude Code.
- Examples, JSON Schema, language/editor documentation and a how-it-works
  diagram.
- Test suite with `node:test` (core, glob, resolver, CLI) and GitHub Actions
  CI on Node 20 and 22.

[Unreleased]: https://github.com/BruceGitHub/context-preload-skill/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BruceGitHub/context-preload-skill/releases/tag/v0.1.0
