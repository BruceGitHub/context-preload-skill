/**
 * CRC · types
 *
 * Scopo: contratti di tipo condivisi da parser, resolver e CLI
 * (Model, Flow, Issue, ResolveResult, ...).
 * Collaboratori: nessuno a runtime; viene importato solo con `import type`.
 * Consumatori: src/crf-core.ts, src/resolve.ts, src/cli.ts.
 */

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  flow?: string;
}

export interface ReadEntry {
  path: string;
  note: string;
}

export interface Flow {
  id: string;
  description: string;
  includes: string[];
  read: ReadEntry[];
  skip: string[];
}

export interface ModelMeta {
  crf: number;
  name: string;
  description: string;
  root: string;
}

export interface GlobalConfig {
  ignore: string[];
  readOrder: string;
  root: string;
}

export interface Model {
  meta: ModelMeta;
  global: GlobalConfig;
  flows: Flow[];
}

export interface Block {
  key: string;
  inline: string;
  lines: string[];
}

export interface Section {
  kind: 'flow' | 'global';
  id?: string;
  lines: string[];
}

export type EntryStatus =
  | 'ok'
  | 'directory'
  | 'missing'
  | 'empty'
  | 'skipped'
  | 'duplicate'
  | 'outside'
  | 'unchecked';

export interface ResolvedEntry {
  pattern: string;
  note: string;
  matches: string[];
  tokens: number;
  status: EntryStatus;
  isDirectory: boolean;
  duplicateCount?: number;
}

export interface ResolveTotals {
  files: number;
  tokens: number;
  required: number;
  missing: number;
  empty: number;
  skipped: number;
}

export interface ResolveNotFound {
  flow: string;
  found: false;
  error: string;
  issues: Issue[];
}

export interface ResolveFound {
  flow: string;
  found: true;
  description: string;
  includes: string[];
  readOrder: string;
  skip: string[];
  entries: ResolvedEntry[];
  totals: ResolveTotals;
  root: string;
  issues: Issue[];
}

export type ResolveResult = ResolveFound | ResolveNotFound;

export interface LoadedRoutingFile {
  file: string;
  baseDir: string;
  root: string;
  text: string;
  model: Model;
  issues: Issue[];
}

export interface RankedFlow {
  flow: Flow;
  score: number;
  reasons: string[];
}

export interface ParsedFile {
  model: Model;
  issues: Issue[];
}
