# Built routing — context-preload
# Generated from routing-context-flow.md. Do not edit.

## base
Minimum context shared by the other flows.

Read these paths, in order:

1. `docs/language.md`
2. `src/crf-core.ts`
3. `src/types.ts`

Do not read:

- `node_modules/**`
- `.git/**`

## review
Review a change or a pull request without rewriting it.

Read these paths, in order:

1. `docs/language.md`
2. `src/crf-core.ts`
3. `src/types.ts`
4. `src/**/*.ts`
5. `tests/**/*.test.mjs`

Do not read:

- `node_modules/**`
- `.git/**`
- `tests/fixtures/**`

## coding
Implement or fix code with the minimum context.

Read these paths, in order:

1. `docs/language.md`
2. `src/crf-core.ts`
3. `src/types.ts`
4. `src/**/*.ts`
5. `bin/**/*.ts`
6. `package.json`
7. `tsconfig.json`

Do not read:

- `node_modules/**`
- `.git/**`

## editor
Work on the single-file visual editor.

Read these paths, in order:

1. `docs/language.md`
2. `src/crf-core.ts`
3. `src/types.ts`
4. `editor/template.html`
5. `editor/editor.js`
6. `scripts/build-editor.mjs`
7. `docs/editor.md`

Do not read:

- `node_modules/**`
- `.git/**`

## docs
Write or update documentation and examples.

Read these paths, in order:

1. `README.md`
2. `docs/**/*.md`
3. `examples/**/*.md`
4. `SKILL.md`

Do not read:

- `node_modules/**`
- `.git/**`

## release
Prepare a release or a changelog.

Read these paths, in order:

1. `docs/language.md`
2. `src/crf-core.ts`
3. `src/types.ts`
4. `src/**/*.ts`
5. `bin/**/*.ts`
6. `package.json`
7. `tsconfig.json`
8. `CHANGELOG.md`
9. `README.md`
10. `.github/workflows/ci.yml`

Do not read:

- `node_modules/**`
- `.git/**`
