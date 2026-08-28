// The two things every non-Claude-Code reader needs, and nothing else does.
//
// Claude Code's storage layout was read on a real installation, so its reader
// knows where sessions sit (`<root>/projects/<dir>/*.jsonl`, depth 0). No other
// harness has an installation on this machine to read, so no other reader has a
// layout to assume. `--root` is the operator's own statement of where their
// logs are, and `walkSessions` treats every `.jsonl` beneath it as a session.
// That is not a layout guess; it is the absence of one.

import fs from 'node:fs';
import path from 'node:path';
import { ReadError, RefusalError } from '../../cli/errors.mjs';
import { nestingDepth, nestingError } from '../reader.mjs';
import { MAX_RECORD_DEPTH } from '../../retain/constants.mjs';

// U+FFFD, written without an escape so no editing round-trip can mangle it.
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/**
 * Every `*.jsonl` under `dir`, at any depth, in the shape resolveCorpus
 * returns for Claude Code.
 *
 * Depth-0 is Claude Code's rule and it is there for a Claude Code reason
 * (BRIEF 4.10: `<dir>/<uuid>/subagents/` doubles the payload for zero extra
 * human turns). A root the operator hand-picked has no such sub-tree to skip,
 * and Codex's own rollout files are known to sit under a dated tree, so a
 * depth-0 walk of a hand-picked root would report an empty corpus and explain
 * nothing.
 *
 * `dirName` is the file's directory relative to the root. It is a location,
 * not a slug: nothing parses it (4.9), it groups the scan report's rows.
 *
 * @returns {{workspaceDirs: object[], files: object[], bytes: number}}
 */
export function walkSessions(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });

  const files = [];
  const byDir = new Map();
  let bytes = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.jsonl')) continue;
    // `parentPath` since Node 20.12; the floor in runtime.mjs is 20.15.
    const parent = entry.parentPath ?? entry.path ?? dir;
    const filePath = path.join(parent, entry.name);

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

    const rel = path.relative(dir, parent);
    const dirName = rel === '' ? '.' : rel.split(path.sep).join('/');
    if (!byDir.has(dirName)) byDir.set(dirName, { dirPath: parent, sessionCount: 0, bytes: 0 });
    const row = byDir.get(dirName);
    row.sessionCount += 1;
    row.bytes += size;
    bytes += size;

    files.push(
      Object.freeze({
        path: filePath,
        dirName,
        sessionId: entry.name.replace(/\.jsonl$/, ''),
        bytes: size,
        mtimeMs,
      }),
    );
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // A session id is the key review.md holds a decision under and the name the
  // archive entry is written as, and neither is a set: two files that reduce to
  // one id mean one of them is dropped from the zip by whichever extractor runs
  // last, silently. Claude Code cannot reach this (one uuid, one slug); a
  // recursive walk of a hand-picked root can, so it is refused rather than
  // resolved, because resolving it invents an id the operator never saw.
  const byId = new Map();
  for (const f of files) {
    if (byId.has(f.sessionId)) {
      throw new RefusalError(`two session files share the id "${f.sessionId}"`, {
        why: [
          'A session id keys the decision in review.md and names the entry in the archive,',
          'so two files with one id would produce one entry and drop the other silently.',
          '',
          `  ${byId.get(f.sessionId)}`,
          `  ${f.path}`,
        ],
        remedies: [
          { label: 'Point at one of them', command: 'deident scan --root <a directory holding only one>' },
          { label: 'Or rename one file', command: 'give the two files distinct names' },
        ],
      });
    }
    byId.set(f.sessionId, f.path);
  }

  const workspaceDirs = [...byDir]
    .map(([dirName, row]) => Object.freeze({ dirName, ...row, unreadable: null }))
    .sort((a, b) => (a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0));

  return { workspaceDirs, files, bytes };
}

/**
 * Read a harness whose file is ONE JSON document, and hand back the record
 * list `readSession` hands back for a file of lines.
 *
 * The pipeline consumes records, so the reader produces records: the document
 * is not taught to the pipeline.
 *
 * What `unpack` returns is the harness's own shape, unchanged. No field is
 * renamed and no envelope is invented: the session's own top-level object,
 * minus its message array, is record 1, and each message is a record after it.
 * Serialized back out that is JSONL, one message per line, which is what the
 * export already writes for every harness.
 *
 * The I1 byte-identical invariant is NOT reported here, and that is a real
 * hole, stated rather than papered over. I1 compares `stringify(parse(line))`
 * to the line, and these files have no lines: both single-document harnesses
 * measured write two-space-indented JSON, so the comparison would have to be
 * against text this reader itself produced, which is a check that cannot fail.
 * The one part of it that still means something is the UTF-8 decode, and that
 * is kept.
 *
 * @param {string} filePath
 * @param {{skipUnreadable?: boolean, keepRaw?: boolean, inspect?: Function}} opts
 * @param {(doc: object) => object[]} unpack  document -> records, in file order
 * @param {(doc: object) => boolean} recognise  is this that harness's document?
 * @param {string} shape  the shape `recognise` wanted, for the read error
 */
export function readDocument(filePath, opts, unpack, recognise, shape) {
  const keepRaw = opts.keepRaw !== false;
  const inspect = typeof opts.inspect === 'function' ? opts.inspect : null;
  const skip = opts.skipUnreadable === true;

  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    throw new ReadError(`could not open ${filePath}`, {
      detail: {
        file: filePath,
        line: null,
        parserMessage: `${err.code}: ${err.message}`,
        likelyCause: 'The file was removed or is locked by another process.',
      },
    });
  }

  const raw = buf.toString('utf8');
  const bytes = buf.length;
  const lossyUtf8 = raw.includes(REPLACEMENT_CHAR) && Buffer.compare(Buffer.from(raw, 'utf8'), buf) !== 0;
  buf = null;

  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  // The same bound the line reader applies, for the same reason: without it
  // what refuses a pathologically nested file is whichever V8 function runs out
  // of stack first, which is a different depth on every platform. The unit here
  // is the DOCUMENT, because that is what the file is, so this is measured
  // across the envelope and every record inside it at once. Real files of this
  // shape nest around a dozen levels, so the two readings never diverge in
  // practice; where they could, the document reading is the stricter one.
  const docDepth = nestingDepth(text);
  if (docDepth > MAX_RECORD_DEPTH) {
    if (!skip) throw nestingError(filePath, null, null, docDepth);
    return emptyRead(filePath, bytes, `nests ${docDepth} levels deep`);
  }

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    if (skip) return emptyRead(filePath, bytes, err.message);
    throw new ReadError('unparseable document', {
      detail: {
        file: filePath,
        line: null,
        parserMessage: err.message,
        likelyCause:
          'This file has a .jsonl extension but the whole file is one JSON document, ' +
          'and it did not parse. It may belong to a different harness than --agent named.',
      },
    });
  }

  if (!recognise(doc)) {
    if (skip) return emptyRead(filePath, bytes, `not ${shape}`);
    // Measured: two of the 58 files in the gemini-cli sample directory are
    // Claude Code JSONL (`parentUuid`, `isSidechain`, `file-history-snapshot`),
    // so a mixed directory is not hypothetical. Naming the shape that was
    // wanted is what turns "it broke" into "you named the wrong --agent".
    throw new ReadError('not this session format', {
      detail: {
        file: filePath,
        line: null,
        parserMessage: `expected ${shape}`,
        likelyCause: 'The file parsed, but it is not the shape --agent named. Check --agent.',
      },
    });
  }

  const records = [];
  const badLines = [];
  const roundTripFailures = [];
  if (lossyUtf8) {
    roundTripFailures.push(Object.freeze({ file: filePath, line: null, why: 'invalid UTF-8 bytes' }));
  }

  const unpacked = unpack(doc);
  for (let i = 0; i < unpacked.length; i += 1) {
    const index = i + 1;
    let line;
    try {
      line = JSON.stringify(unpacked[i]);
    } catch (err) {
      // Same rule as reader.mjs: a record too deep to re-serialize is a record
      // too deep to export, so --skip-unreadable skips it rather than offering
      // a remedy that does nothing.
      if (err instanceof RangeError && skip) {
        badLines.push(Object.freeze({ line: index, message: err.message }));
        continue;
      }
      throw err;
    }
    if (inspect !== null) inspect(line, index);
    records.push(Object.freeze(keepRaw ? { index, line, value: unpacked[i] } : { index, value: unpacked[i] }));
  }

  return Object.freeze({
    path: filePath,
    records: Object.freeze(records),
    badLines: Object.freeze(badLines),
    roundTripFailures: Object.freeze(roundTripFailures),
    bytes,
    lineCount: records.length + badLines.length,
  });
}

function emptyRead(filePath, bytes, message) {
  return Object.freeze({
    path: filePath,
    records: Object.freeze([]),
    badLines: Object.freeze([Object.freeze({ line: 1, message })]),
    roundTripFailures: Object.freeze([]),
    bytes,
    lineCount: 1,
  });
}

/** The same cwd for every record: a value the session states once, or none. */
export function constantCwd(records, cwd) {
  const value = typeof cwd === 'string' && cwd.length > 0 ? cwd : null;
  return Object.freeze(new Array(records.length).fill(value));
}
