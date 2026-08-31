// Cursor agent transcripts. True JSONL, `{role, message}` per line.
//
// Measured over 19 files (SALT-NLP/SWE-chat sample, 2026-08-27):
//   19/19 parse as true JSONL
//   top-level keys: role, message -- nothing else in any record
//   roles: assistant 848, user 176
//   message keys: content -- and nothing else in any record
//   content blocks: text 909, tool_use 403
//
// THERE IS NO WORKING DIRECTORY. Every key in every record of all 19 files was
// walked looking for one; the only path-shaped keys that exist are tool
// ARGUMENTS (`working_directory` on 20 tool_use inputs, `path`, `paths`,
// `relative_path`, `target_directory`). A tool argument is a directory a tool
// was pointed at, not a directory the session ran in, and reading one as the
// session's cwd would tier a whole session on a path that happened to appear in
// one call. `cwdSource` is null and the run refuses; see agents.mjs.
//
// Not verified: no Cursor is installed on this machine, so the on-disk layout
// of a real installation has never been read and no default path is offered.

import { readSession as readJsonl } from '../reader.mjs';
import { walkSessions, constantCwd } from './shared.mjs';

/**
 * One record of THIS harness's own shape, minimal, for the guard that checks
 * `retains` against the code.
 *
 * `{role, message}` and nothing else, on every record of every file measured.
 *
 * Declared by the harness rather than built by the guard, because a guard that
 * constructs a probe has to know each shape, and knowing one shape and applying
 * it to every harness is the defect the guard exists to catch. It did exactly
 * that in its first version.
 */
export const shapeSample = Object.freeze({ role: 'user', message: { content: [{ type: 'text', text: 'hi' }] } });

/**
 * No retention branch. Blocked on cwd first (see `cwdSource`), so this has
 * never been reachable, and it is declared rather than left to be found at
 * the moment someone supplies a cwd some other way.
 */
export const retains = false;

export const id = 'cursor';
export const label = 'Cursor';
export const sessionsDir = (root) => root;
export const layout = 'every *.jsonl under --root, at any depth';
export const hasDefaultRoot = false;

/**
 * false, MEASURED: a space after every `:` and `,`, so all 1,024 lines fail
 * I1's byte comparison. Unlike Codex, 0 of them differ once whitespace is
 * normalised away, so nothing but formatting separates source from output.
 * Academic here, since the missing cwd stops a Cursor run earlier.
 */
export const canonicalJson = false;

/** null: the records state no directory, and none is invented from one. */
export const cwdSource = null;

export const enumerate = walkSessions;

export function readSession(filePath, opts = {}) {
  // This writer is not canonical, so the round-trip check asks whether the
  // parse lost anything rather than whether the bytes match ours. See
  // `canonicalJson` above and corpus/lossless.mjs for what that trades.
  return readJsonl(filePath, { ...opts, canonicalJson });
}

/**
 * Null for every record, and reached only by a caller that already knows
 * `cwdSource` is null. Present so the seam has one shape for every agent.
 */
export function resolveLineCwd(records) {
  return constantCwd(records, null);
}
