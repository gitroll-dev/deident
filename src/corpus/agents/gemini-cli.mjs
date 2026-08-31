// Gemini CLI sessions. NOT JSONL, despite the extension: the whole file is one
// JSON document, written two-space-indented.
//
// Measured over 58 files (SALT-NLP/SWE-chat sample, 2026-08-27):
//   56/58 parse as ONE JSON document. The other 2 are Claude Code JSONL
//     (`parentUuid`, `isSidechain`, `file-history-snapshot`, `summary`) sitting
//     in the same directory, which is why the reader checks the shape and names
//     it in the error rather than assuming the directory is homogeneous.
//   top-level keys: sessionId, projectHash, startTime, lastUpdated, messages,
//     kind, and `summary` on some files
//   each message: {id, timestamp, type, content} plus, on some, thoughts,
//     tokens, model, toolCalls, displayContent
//   message types: gemini 5647, user 603, info 118, warning 14, error 9
//   `content` is a STRING 5816 times, an ARRAY 573 times, and absent twice, so
//     nothing here assumes it is one of those.
//
// THERE IS NO WORKING DIRECTORY. `projectHash` is the only project-identifying
// field, in 55 of 56 documents, and it is a hash: it identifies the project
// WITHOUT naming it, so it cannot yield a cwd and nothing is derived from it.
// `cwdSource` is null and the run refuses; see agents.mjs.
//
// Not verified: no Gemini CLI is installed on this machine, so the on-disk
// layout of a real installation has never been read and no default path is
// offered.

import { readDocument, walkSessions, constantCwd } from './shared.mjs';

/** No retention branch. Blocked on cwd first (see `cwdSource`). */
export const retains = false;

export const id = 'gemini-cli';
export const label = 'Gemini CLI';
export const sessionsDir = (root) => root;
export const layout = 'every *.jsonl under --root, at any depth';
export const hasDefaultRoot = false;

/**
 * false: the file is one two-space-indented document, so there is no line to
 * be byte-identical to. shared.mjs states what that costs.
 */
export const canonicalJson = false;

/** null: `projectHash` identifies a project without naming it. */
export const cwdSource = null;

export const enumerate = walkSessions;

const SHAPE = 'an object with `sessionId` and an array `messages`';

const recognise = (doc) =>
  doc !== null && typeof doc === 'object' && !Array.isArray(doc) &&
  typeof doc.sessionId === 'string' && Array.isArray(doc.messages);

/** Record 1 is the document minus `messages`; records 2..n are the messages. */
const unpack = (doc) => {
  const { messages, ...envelope } = doc;
  return [envelope, ...messages];
};

export function readSession(filePath, opts = {}) {
  return readDocument(filePath, opts, unpack, recognise, SHAPE);
}

export function resolveLineCwd(records) {
  return constantCwd(records, null);
}
