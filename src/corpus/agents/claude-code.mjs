// Claude Code. The default, and the only harness with a default path.
//
// The path is a default because it was read on a real installation, not
// because it is plausible. Every other reader in this directory takes `--root`
// and nothing else, for the reason stated in agents.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { readSession as readJsonl } from '../reader.mjs';
import { resolveLineCwd as trackLineCwd } from '../cwdtrack.mjs';

export const id = 'claude-code';
export const label = 'Claude Code';

/** Where sessions sit under the config root. */
export const sessionsDir = (configDir) => path.resolve(configDir, 'projects');

export const layout = '<root>/projects/<dir>/*.jsonl';

/** There is an installed Claude Code to read a default from. Nothing else has one. */
export const hasDefaultRoot = true;

/**
 * Its writer emits canonical `JSON.stringify` output, which is what makes I1
 * (BRIEF 4.7b) a byte-for-byte check here: any deviation is a writer deident
 * does not understand. Every other harness measured writes a space after `:`
 * and `,`, so byte-identity is unreachable for them by construction.
 */
export const canonicalJson = true;

/**
 * Per LINE, from `cwd` on the record itself and from the two records that move
 * it (`relocated`, `worktree-state`). BRIEF 4.8: only 67% of lines carry one,
 * and one file spanned 11 distinct values.
 */
export const cwdSource = 'the `cwd` field on each record, tracked per line';

/**
 * Depth-0 only: `<projectsDir>/<dir>/*.jsonl` and nothing deeper.
 * `<dir>/<uuid>/subagents/...` is deliberately not walked (BRIEF 4.10, a
 * recursive glob ships 2.2x the payload with zero extra human turns).
 */
export function enumerate(dir) {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });

  const workspaceDirs = [];
  const files = [];
  let bytes = 0;

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const dirPath = path.join(dir, dirent.name);

    let inner;
    try {
      inner = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
      // One unreadable workspace must not sink the run (BRIEF 2).
      workspaceDirs.push(
        Object.freeze({ dirName: dirent.name, dirPath, sessionCount: 0, bytes: 0, unreadable: err.code }),
      );
      continue;
    }

    const wsFiles = [];
    let wsBytes = 0;
    for (const f of inner) {
      if (!f.isFile()) continue;
      if (!f.name.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, f.name);
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = fs.statSync(filePath);
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        // A file that vanished between readdir and stat is not an error.
        continue;
      }
      wsBytes += size;
      wsFiles.push(
        Object.freeze({
          path: filePath,
          dirName: dirent.name,
          sessionId: f.name.replace(/\.jsonl$/, ''),
          bytes: size,
          mtimeMs,
        }),
      );
    }

    wsFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    // A loop, not `push(...arr)`: a workspace directory with enough session
    // files would blow the argument stack before anything could be reported.
    for (const f of wsFiles) files.push(f);
    bytes += wsBytes;
    workspaceDirs.push(
      Object.freeze({
        dirName: dirent.name,
        dirPath,
        sessionCount: wsFiles.length,
        bytes: wsBytes,
        unreadable: null,
      }),
    );
  }

  workspaceDirs.sort((a, b) => (a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0));
  return { workspaceDirs, files, bytes };
}

export function readSession(filePath, opts = {}) {
  return readJsonl(filePath, opts);
}

export function resolveLineCwd(records) {
  return trackLineCwd(records);
}
