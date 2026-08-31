// Read one session file, parse each line, and assert the serialization
// invariant I1 on the *untouched* input: stringify(parse(line)) === line.
//
// PLAN §2: this runs first, before any substitution. Once a string has been
// substituted the check tests our serializer against our own output and can
// only pass. Its job is to detect a future Claude Code writer whose format we
// fail to round-trip (BRIEF §4.7b), and run late it detects nothing.

import fs from 'node:fs';
import { parseLoss } from './lossless.mjs';
import { ReadError, RefusalError } from '../cli/errors.mjs';
import { MAX_RECORD_DEPTH } from '../retain/constants.mjs';

// U+FFFD, written without an escape so no editing round-trip can mangle it.
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/**
 * @param {string} filePath
 * @param {{skipUnreadable?: boolean, keepRaw?: boolean, inspect?: Function}} opts
 *   keepRaw: false drops each record's raw line text once it has been checked.
 *     The raw text is as large as the file itself, and the export pass has no
 *     use for it, holding it is a second copy of the corpus for nothing.
 *   inspect(line, lineNo): called with the raw text of every parsed line, so a
 *     caller that needs to look at raw lines (the namespace collision check)
 *     can do so without the reader accumulating them.
 * @returns {Readonly<{path, records, badLines, bytes, lineCount, roundTripFailures}>}
 *   records: [{index, line?, value}] in file order, 1-based `index`.
 */
export function readSession(filePath, opts = {}) {
  const skip = opts.skipUnreadable === true;
  // Default true: a caller that says nothing gets the strong check, so a new
  // reader has to opt out deliberately rather than inherit the weaker one.
  const canonicalJson = opts.canonicalJson !== false;
  const keepRaw = opts.keepRaw !== false;
  const inspect = typeof opts.inspect === 'function' ? opts.inspect : null;

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

  // The serialization invariant is reported as "byte-identical", and it cannot
  // be that while the comparison happens against an already-lossily-decoded
  // string. `readFileSync(path, 'utf8')` replaces every invalid byte with
  // U+FFFD, so `stringify(parse(line)) === line` compares two strings that both
  // already lost the bytes, the check can never see the damage, by
  // construction, and the report still says byte-identical.
  //
  // Re-encoding is the cheap proof: a lossless decode round-trips. It is only
  // attempted when U+FFFD is actually present, so the common path costs one
  // substring search rather than a second copy of the file.
  const lossyUtf8 = raw.includes(REPLACEMENT_CHAR) && Buffer.compare(Buffer.from(raw, 'utf8'), buf) !== 0;
  buf = null;

  // A BOM is legal in the file but is not part of the first JSON line.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const records = [];
  const badLines = [];
  const roundTripFailures = [];
  if (lossyUtf8) {
    roundTripFailures.push(Object.freeze({ file: filePath, line: null, why: 'invalid UTF-8 bytes' }));
  }

  // Split on \n and tolerate a trailing \r (Git Bash / Windows editors) and a
  // trailing newline. An empty file yields zero records, not an error (F19).
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.trim() === '') continue;

    const lineNo = i + 1;

    // deident's own depth bound, on the TEXT, before the parse. Until this
    // existed the refusal came from whichever V8 function ran out of stack
    // first, which is a different depth on every platform: the same 6,000-deep
    // record was refused on win32 and kept on macOS. See MAX_RECORD_DEPTH.
    //
    // The `skip` test comes first here for the same reason it does below: the
    // refusal names --skip-unreadable, so --skip-unreadable has to get past it.
    const depth = nestingDepth(line);
    if (depth > MAX_RECORD_DEPTH) {
      if (!skip) throw nestingError(filePath, lineNo, null, depth);
      badLines.push(Object.freeze({ line: lineNo, message: `nests ${depth} levels deep` }));
      continue;
    }

    let value;
    try {
      value = JSON.parse(line);
    } catch (err) {
      // Pathologically nested JSON exhausts the JS stack rather than failing to
      // parse. That is a property of the INPUT, so it is a read error naming
      // the file and the line (exit 3), not "a bug in deident" (exit 1).
      //
      // The `skip` test comes FIRST. It used to come second, so the refusal
      // told the user to run --skip-unreadable and running it produced the
      // identical exit 3: a remedy that cannot work is worse than none
      // (cli-ux §8). A record nobody can parse is a record nobody can export,
      // so skipping it is exactly what the flag means.
      if (err instanceof RangeError && !skip) throw nestingError(filePath, lineNo, err);
      if (!skip) {
        throw new ReadError('unparseable line', {
          detail: {
            file: filePath,
            line: lineNo,
            parserMessage: err.message,
            likelyCause:
              i === lines.length - 1 || i === lines.length - 2
                ? 'This usually means the session was still being written. Close that Claude Code session.'
                : 'A line in the middle of the file is truncated, which usually means the file was interrupted mid-write.',
          },
        });
      }
      badLines.push(Object.freeze({ line: lineNo, message: err.message }));
      continue;
    }

    // I1. Recorded rather than thrown here so the caller can report every
    // failing line at once; runAllChecks turns a non-empty list into a refusal.
    //
    // Two forms of one question, chosen by the writer. Byte-identity is the
    // strong form and is free where the writer emits canonical JSON, so Claude
    // Code keeps it. For any other writer it asks for something deident never
    // needed -- it emits its own serialization, not these bytes -- and refuses
    // over a number's spelling: measured on 378,347 Codex lines, 45.48% differ
    // and every one is `32.0` against `32`, with zero whitespace differences,
    // zero duplicate keys and zero values that changed. `parseLoss` asks the
    // question I1 exists for, which is whether the parse saw everything.
    //
    // What only the strong form catches is whitespace and key order. Neither
    // can carry a user's text, and that trade is stated in lossless.mjs.
    try {
      if (canonicalJson) {
        if (JSON.stringify(value) !== line) {
          roundTripFailures.push(Object.freeze({ file: filePath, line: lineNo }));
        }
      } else {
        const why = parseLoss(line, value);
        if (why !== null) roundTripFailures.push(Object.freeze({ file: filePath, line: lineNo, why }));
      }
    } catch (err) {
      // Same rule as the parse above: a record too deep to re-serialize is a
      // record too deep to export, so --skip-unreadable skips it rather than
      // offering a remedy that does nothing.
      if (err instanceof RangeError && skip) {
        badLines.push(Object.freeze({ line: lineNo, message: err.message }));
        continue;
      }
      if (err instanceof RangeError) throw nestingError(filePath, lineNo, err);
      throw err;
    }

    if (inspect !== null) inspect(line, lineNo);
    records.push(Object.freeze(keepRaw ? { index: lineNo, line, value } : { index: lineNo, value }));
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

// The characters that decide nesting depth, and the one that escapes them.
// Named because a bare 0x5c in a loop reads as noise.
const CH_QUOTE = 34;
const CH_BACKSLASH = 92;
const CH_OPEN_BRACKET = 91;
const CH_CLOSE_BRACKET = 93;
const CH_OPEN_BRACE = 123;
const CH_CLOSE_BRACE = 125;

/**
 * How deeply one line of JSON nests, counted over the text.
 *
 * Deliberately BEFORE the parse and deliberately iterative. A recursive check
 * would exhaust the same stack it exists to protect, and a check on the parsed
 * value would mean the runtime's parser had already run at whatever depth that
 * runtime happens to tolerate, which is the thing being removed. Counting
 * brackets outside string literals is exact for well-formed JSON; a line that
 * is not well-formed is refused by the parse that follows.
 *
 * String bodies are jumped with `indexOf` rather than stepped through, because
 * almost every byte of a session log is inside one: prose, code, paths, pasted
 * output. Measured over 300 real session files, 169,752 records, 1.0 GB: 2,807
 * ms stepping character by character against 273 ms jumping, agreeing on the
 * depth of every line. This runs on every line of every file, so a fifth of the
 * read stage spent on a guard that fires on nothing is not a trade worth making.
 *
 * The jump is the only subtle part: a quote ends the string only when the run
 * of backslashes before it is even, since each pair is one escaped backslash.
 * An unterminated string returns the depth so far and the parse below reports
 * the line, which is the right division of labour: this function measures, it
 * does not validate.
 */
export function nestingDepth(text) {
  let depth = 0;
  let deepest = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === CH_QUOTE) {
      let end = i + 1;
      for (;;) {
        end = text.indexOf('"', end);
        if (end < 0) return deepest;
        let back = end - 1;
        let slashes = 0;
        while (back >= 0 && text.charCodeAt(back) === CH_BACKSLASH) {
          slashes += 1;
          back -= 1;
        }
        if (slashes % 2 === 0) break;
        end += 1;
      }
      i = end;
    } else if (c === CH_OPEN_BRACE || c === CH_OPEN_BRACKET) {
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else if (c === CH_CLOSE_BRACE || c === CH_CLOSE_BRACKET) {
      depth -= 1;
    }
  }
  return deepest;
}

/**
 * A record nested deeper than deident reads.
 *
 * Every walker in the pipeline is recursive, so this is a property of the
 * input and belongs in the same shape as an unparseable line: exit 3, the file
 * and the line named. Reported as "a bug in deident" it sends the user to file
 * an issue about their own data.
 *
 * Two callers, and the difference between them is the point. `depth` given: the
 * bound above refused it, the same way on every platform. `depth` null: a
 * RangeError got there first, which now means a runtime whose stack gives out
 * below MAX_RECORD_DEPTH rather than the ordinary case it used to be. Both are
 * the same refusal to the user; only the sentence differs.
 */
export function nestingError(filePath, lineNo, err, depth = null) {
  return new ReadError('a record is nested too deeply to process', {
    detail: {
      file: filePath,
      line: lineNo,
      parserMessage:
        depth === null
          ? err && err.message
            ? err.message
            : 'stack exhausted'
          : `nesting depth ${depth} is past the limit of ${MAX_RECORD_DEPTH}`,
      likelyCause:
        depth === null
          ? 'This record nests JSON deeply enough to exhaust the stack every walker in deident uses.'
          : `This record nests JSON ${depth} levels deep. deident reads to ${MAX_RECORD_DEPTH}, because every walker in the pipeline is recursive and no real session log comes near it.`,
      remedy: 'Skip the record with --skip-unreadable.',
    },
  });
}

/**
 * The I1 refusal. Separated from the reader so the reader stays a pure
 * boundary and the wording stays with the other refusals.
 */
export function roundTripRefusal(failures, agent = null) {
  const first = failures.slice(0, 5);
  // The agent is named because the sentence used to say "Claude Code's log
  // format has changed" whatever had been read, and on a Codex run that is
  // false twice over: it is not Claude Code, and nothing has changed. Codex
  // writes a space after every `:` and `,` and writes a whole float as `5.0`,
  // so JSON.stringify reproduces neither, and 15,714 of 15,714 lines measured
  // fail this check on a corpus that is in perfect health. Naming the harness
  // is what makes that reading available to whoever hits it.
  const label = agent === null ? "Claude Code's" : `${agent.label}'s`;
  return new RefusalError(
    `${failures.length} input${failures.length === 1 ? '' : 's'} do not round-trip byte-identically`,
    {
      why: [
        `${label} log format is one deident does not round-trip byte for byte,`,
        'or a file contains bytes that are not valid UTF-8. Substituting inside a',
        'format we cannot re-serialize byte-identically risks corrupting the record',
        'or silently dropping a field. Do not export; report this.',
        '',
        ...(agent === null || agent.canonicalJson
          ? []
          : [
              `deident has never claimed byte-identity for ${agent.label}, and this`,
              'refusal is the shipped invariant standing, not a fault in your logs.',
              'Whether to hold a non-canonical writer to a whitespace-insensitive',
              'form of the same check is a decision nobody has made yet.',
              '',
            ]),
        ...first.map((f) =>
          f.line === null || f.line === undefined
            ? `  ${f.file}  ${f.why ?? 'does not round-trip'}`
            : `  ${f.file}  line ${f.line}`,
        ),
      ],
      remedies: [{ label: 'Report with the lines above', command: 'file an issue against deident' }],
      detail: { failures: failures.length },
    },
  );
}
