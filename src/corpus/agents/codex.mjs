// Codex CLI rollout files.
//
// Provenance, so nobody has to take the shape on faith: `session_meta.payload`
// carries `originator` ("codex-tui" in 53 of the 60 files measured, "codex_exec"
// in the other 7), `source: "cli"`, a `cli_version`, the `cwd` and a `git`
// block. That is the Codex CLI's own rollout file collected verbatim, not
// something a collector reshaped.
//
// Measured over 60 files (SALT-NLP/SWE-chat sample, 2026-08-27):
//   60/60 parse as true JSONL, every line `{timestamp, type, payload}`
//   top-level types: response_item 8865, event_msg 6627, turn_context 159,
//     session_meta 60, compacted 3
//   session_meta is the FIRST record in 60/60 and carries a cwd in 60/60
//   turn_context carries a cwd in 159/159, and it equalled the session_meta
//     cwd in 159/159 -- so tracking it costs nothing here and is the only
//     thing that would be right if a turn ever moved.
//
// Not verified: no Codex CLI is installed on this machine, so the on-disk
// layout of a real installation has never been read and no default path is
// offered. `--root` is the only way in.

import { readSession as readJsonl } from '../reader.mjs';
import { walkSessions } from './shared.mjs';

/**
 * One record of THIS harness's own shape, minimal, for the guard that checks
 * `retains` against the code.
 *
 * A `{timestamp, type, payload}` line whose real record is the payload's own type.
 *
 * Declared by the harness rather than built by the guard, because a guard that
 * constructs a probe has to know each shape, and knowing one shape and applying
 * it to every harness is the defect the guard exists to catch. It did exactly
 * that in its first version.
 */
export const shapeSample = Object.freeze({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'user_message', message: 'hi' } });

/** A retention branch exists: retainCodexLine, added once the schema had one. */
export const retains = true;

export const id = 'codex';
export const label = 'Codex CLI';
export const sessionsDir = (root) => root;
export const layout = 'every *.jsonl under --root, at any depth';
export const hasDefaultRoot = false;

/**
 * false, MEASURED. Codex writes a space after every `:` and `,`, so
 * `JSON.stringify(JSON.parse(line)) !== line` on 15,714 of 15,714 lines of a
 * corpus in perfect health, and I1 refuses every Codex export today.
 *
 * With whitespace normalised away, 904 of those 15,714 still differ, and all
 * of them are one thing: a whole float written `5.0`, which JavaScript's
 * Number cannot carry back out and re-serializes as `5`. 18 distinct
 * divergence sites, every one of them `used_percent` inside a `token_count`
 * event. The VALUE is unchanged; the text is not.
 *
 * So Codex sessions can be found, read, scanned and typed, and cannot yet be
 * exported. Relaxing a shipped invariant is not this reader's decision to
 * make, and the refusal now names the harness so nobody reads it as "Claude
 * Code's format changed".
 */
export const canonicalJson = false;

export const cwdSource = '`session_meta.payload.cwd`, then `turn_context.payload.cwd` per turn';

export const enumerate = walkSessions;

export function readSession(filePath, opts = {}) {
  // This writer is not canonical, so the round-trip check asks whether the
  // parse lost anything rather than whether the bytes match ours. See
  // `canonicalJson` above and corpus/lossless.mjs for what that trades.
  return readJsonl(filePath, { ...opts, canonicalJson });
}

/**
 * The cwd in force at each record.
 *
 * Codex states it directly, which Claude Code does not: BRIEF 4.9 forbids
 * parsing Claude Code's directory slug precisely because the cwd is not stated
 * there, and here it is, once at the top of the file and again on every turn.
 */
export function resolveLineCwd(records) {
  const out = new Array(records.length);
  let current = null;
  for (let i = 0; i < records.length; i += 1) {
    const declared = cwdChangeFrom(records[i].value);
    if (declared !== null) current = declared;
    out[i] = current;
  }
  // session_meta was first in all 60 files measured, so this back-fill has
  // never fired on real data. It is here for the file where it is not first:
  // leaving null means "unknown", which the line filter treats as deny, and a
  // session cannot have been in a different directory before the first one it
  // reports.
  const firstKnown = out.find((v) => v !== null) ?? null;
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === null) out[i] = firstKnown;
    else break;
  }
  return Object.freeze(out);
}

/** The cwd this record establishes, or null. Exported so a fixture can ask it directly. */
export function cwdChangeFrom(rec) {
  if (rec === null || typeof rec !== 'object') return null;
  if (rec.type !== 'session_meta' && rec.type !== 'turn_context') return null;
  const cwd = rec.payload === null || typeof rec.payload !== 'object' ? null : rec.payload.cwd;
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : null;
}
