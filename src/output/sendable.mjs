// Which of the files in `--out` may leave this machine, said in the directory
// itself rather than in documentation nobody opens.
//
// The output directory used to hold the archive a person sends and five files
// that must never be sent, with nothing distinguishing them: `review.md` (real
// workspace names and paths, "raw identity on purpose"), `deident-candidates
// .txt` (the corpus's prose, un-redacted for names), `deident-triage.txt` (each
// session's first prompt, raw), `export-map.txt` (real session ids against
// archive entries) and the `--preview` diff (the original text beside the
// redacted text). occurrences.mjs had already argued the index must live beside
// the salt because `--out` "is the directory a person zips up and sends", and
// then five artifacts were written into it anyway.
//
// Both halves of that failed in the field. The author moved `export-map.txt`
// out by hand after being asked whether the directory was safe to send. And a
// reviewer opened one of the raw files, saw his own details intact, and
// concluded the tool does nothing: two of the six produce exactly that
// impression while every gate is green, so the directory made the wrong
// conclusion the easy one.
//
// The archive moves into a subdirectory of its own and nothing else does. That
// makes the sendable set an ALLOWLIST: what may be sent is what is in `send/`,
// so the next artifact somebody writes with `path.join(outDir, ...)` lands
// outside it and is un-sendable by default. Putting the dangerous files behind
// a `private/` name instead would leave the top level default-sendable, which
// is the arrangement that produced this bug.

import fs from 'node:fs';
import path from 'node:path';

/** The one directory whose contents may leave the machine. */
export const SEND_DIRNAME = 'send';

/** The label. Not documentation: the file a person reads before sending. */
export const MANIFEST_FILENAME = 'WHAT-TO-SEND.txt';

export function sendDir(outDir) {
  return path.join(outDir, SEND_DIRNAME);
}

export function manifestPath(outDir) {
  return path.join(outDir, MANIFEST_FILENAME);
}

// Why each file may not be sent, in the words a person deciding needs. Keyed on
// the literal name each writer uses, so a rename that forgets this table shows
// up as the unknown-file row rather than as a silently missing one.
const WHY = new Map([
  ['review.md', 'your real workspace names and paths: the audit record, not an export'],
  ['review.html', 'the same rows as review.md, rendered'],
  ['deident-candidates.txt', 'prose the semantic pass has not seen: third-party names, raw'],
  ['deident-triage.txt', "each session's first prompt, raw: no substitution has run over it"],
  ['export-map.txt', 'real session ids against the archive entries they became'],
]);

function why(name) {
  const known = WHY.get(name);
  if (known !== undefined) return known;
  // Not "the original text beside the redacted text" any more: excerptAt was
  // changed to cut its windows from the SUBSTITUTED string, and the file's own
  // header now says it pairs no pseudonym to a spelling. What is still raw is
  // the flagged block, which prints `entity.canonical` verbatim for every
  // entity the safety rules refused to substitute, and no check can see it:
  // buildTable puts a null-pseudonym entity in `table.flagged` and the residue
  // scan reads `table.entries` only. A label that describes content the file
  // stopped carrying is a label nobody checks against the content it does.
  if (/^deident-preview-.*\.diff$/.test(name)) return 'the spellings deident refused to substitute, printed in the clear';
  return 'deident did not write this, so it cannot vouch for it';
}

function listFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
}

/**
 * Write the label, and return what it says.
 *
 * Built from a real directory listing rather than from the constants the run
 * happened to use, so every name it prints is a name that is on disk when the
 * run ends. A file the tool never wrote is listed too, under a row that says
 * deident cannot vouch for it: the safe default for a name nothing here knows.
 *
 * `notes` are lines about the archive's CONTENT rather than its sendability,
 * printed under their own heading. The terminal says them too, and scrollback
 * is not a record: this file is the one a person opens when they are about to
 * send, which is the moment "this carries no tool calls" has to be readable.
 * Kept as caller-supplied lines rather than as another table here, because this
 * module's whole job is to decide sendability from a directory listing and it
 * should not start deciding what is in the archive as well.
 *
 * @param {string} outDir
 * @param {string} stamp
 * @param {readonly string[]} [notes]
 * @returns {{path: string, bytes: number, send: string[], hold: string[], notes: string[]}}
 */
export function writeSendManifest(outDir, stamp, notes = []) {
  const send = listFiles(sendDir(outDir));
  const hold = listFiles(outDir).filter((n) => n !== MANIFEST_FILENAME);
  const width = Math.max(12, ...hold.map((n) => n.length));

  const lines = ['WHAT YOU MAY SEND', `written by deident, ${stamp}`, ''];
  if (send.length === 0) {
    lines.push('  SEND        nothing: this run wrote no archive');
  } else {
    for (const [i, name] of send.entries()) {
      lines.push(`  ${i === 0 ? 'SEND      ' : '          '}  ${path.join(SEND_DIRNAME, name)}`);
    }
  }
  lines.push('');
  if (hold.length === 0) {
    lines.push('  DO NOT SEND   nothing else is in this directory');
  } else {
    lines.push('  DO NOT SEND, and do not commit:');
    for (const name of hold) lines.push(`    ${name.padEnd(width)}  ${why(name)}`);
  }
  // Between the listing and the closing instruction, so it is read before the
  // decision rather than after it.
  if (notes.length > 0) {
    lines.push('', '  ABOUT WHAT IS IN IT:');
    for (const note of notes) lines.push(`    ${note}`);
  }
  // The closing line names `send/` only when `send/` exists. A remedy naming a
  // path that is not on disk is worse than no remedy, and a preview run writes
  // no archive and no directory to hold one.
  lines.push(
    '',
    send.length === 0
      ? 'Nothing in this directory may leave the machine. Run the export without'
      : `Send the contents of ${SEND_DIRNAME}${path.sep} and nothing else. Every other file here is`,
    send.length === 0
      ? '--preview to produce an archive that may.'
      : 'here because a person has to read it, not because it ships.',
    'The salt and the rest of the private directory are never written here at all.',
    '',
  );

  const body = lines.join('\n');
  const target = manifestPath(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
  return { path: target, bytes: Buffer.byteLength(body, 'utf8'), send, hold, notes: [...notes] };
}
