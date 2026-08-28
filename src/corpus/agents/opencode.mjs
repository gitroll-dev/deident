// opencode sessions. NOT JSONL, despite the extension: the whole file is one
// JSON document, `{info, messages}`, written two-space-indented.
//
// Measured over 60 files (SALT-NLP/SWE-chat sample, 2026-08-27):
//   60/60 parse as ONE JSON document; 0 parse as JSONL
//   top-level keys: info, messages -- nothing else in any file
//   info keys: id, slug, projectID, directory, parentID, title, version,
//     summary, permission, time
//   `info.directory` present in 60/60
//   each message is {info, parts}; role at `message.info.role`
//     (user 101, assistant 933)
//   part types: tool 1794, step-start 930, step-finish 929, reasoning 803,
//     text 257, patch 76, file 5
//   assistant messages also carry `info.path.cwd` and `info.path.root`; over
//     all 933 of them `info.path.cwd` equalled `info.directory` 933 times and
//     differed 0 times, and the 101 user messages carry no path at all. So the
//     session's own `info.directory` is the statement, and the per-message
//     copy adds nothing.
//
// Not verified: no opencode is installed on this machine, so the on-disk layout
// of a real installation has never been read and no default path is offered.

import { readDocument, walkSessions, constantCwd } from './shared.mjs';

export const id = 'opencode';
export const label = 'opencode';
export const sessionsDir = (root) => root;
export const layout = 'every *.jsonl under --root, at any depth';
export const hasDefaultRoot = false;

/**
 * false: the file is one two-space-indented document, so there is no line to
 * be byte-identical to. shared.mjs states what that costs.
 */
export const canonicalJson = false;

export const cwdSource = '`info.directory` on the session document, stated once';

export const enumerate = walkSessions;

const SHAPE = 'an object with `info` and an array `messages`';

const recognise = (doc) =>
  doc !== null && typeof doc === 'object' && !Array.isArray(doc) &&
  doc.info !== null && typeof doc.info === 'object' && Array.isArray(doc.messages);

/**
 * Record 1 is the session's own top-level object minus `messages`; records 2..n
 * are the messages, each in its own `{info, parts}` shape, unchanged.
 *
 * Nothing is renamed and nothing is mapped onto another harness's vocabulary:
 * a `part` of type `tool` leaves as a `part` of type `tool`.
 */
const unpack = (doc) => {
  const { messages, ...envelope } = doc;
  return [envelope, ...messages];
};

export function readSession(filePath, opts = {}) {
  return readDocument(filePath, opts, unpack, recognise, SHAPE);
}

/**
 * One directory for the whole session, because that is what the session states.
 * Read off record 1, which is the envelope `unpack` put there, so this stays
 * true whatever order the pipeline hands the records back in.
 */
export function resolveLineCwd(records) {
  const envelope = records.length > 0 ? records[0].value : null;
  const info = envelope === null || typeof envelope !== 'object' ? null : envelope.info;
  const dir = info === null || typeof info !== 'object' ? null : info.directory;
  return constantCwd(records, dir);
}
