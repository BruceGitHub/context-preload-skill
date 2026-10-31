# Context routing

Paths are relative to the repository root.

When I am doing a review, read these files:
- `docs/language.md`
- `src/**/*.ts`
- `tests/**/*.test.mjs`

Skip `tests/fixtures/**`. Report only concrete problems, with file and line.

When I am implementing a feature, read:
- `src/**/*.ts`
- `bin/**/*.ts`
- `package.json`

Run the tests before proposing the change.

When I am debugging, read:
- `src/**/*.ts`
- `tests/**/*.test.mjs`

Find the cause first, then fix it.

Never read `node_modules`, `dist`, or `.git`.
