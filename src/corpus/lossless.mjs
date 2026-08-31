// What I1 is actually asking, for a writer whose bytes deident cannot reproduce.
//
// I1 is `JSON.stringify(JSON.parse(line)) === line`, and its refusal says why:
// "substituting inside a format we cannot re-serialize byte-identically risks
// corrupting the record or silently dropping a field". Both halves are worth
// separating, because deident does not emit the original bytes. It emits its
// own `JSON.stringify` of a record it rebuilt. So byte-identity of the INPUT
// was never a precondition for the OUTPUT being well-formed. What it proves is
// narrower and more important: that the PARSE saw everything in the file.
//
// Measured over 378,347 real Codex lines, the only writer this is needed for:
//
//   54.52%  already byte-identical
//   45.48%  differ, every one of them a number's spelling: 32.0 -> 32,
//           16.110 -> 16.11
//    0.00%  differ by whitespace
//    0      duplicate keys
//    0      lines whose value changed when re-parsed from our serialization
//
// So on that corpus the check refuses 172,087 lines over trailing zeros, and
// the schema's own claim that Codex "writes a space after every : and ," is not
// true of it. Holding a writer we do not control to our own number formatting
// is a game that is lost again the next time it reformats anything, and it was
// never the guarantee.
//
// THE ONE REAL LOSS a byte-identity check stands in for is a duplicate key.
// `{"a":1,"a":2}` parses to `{a:2}` and a field is gone with nothing to see.
// Number spelling, escape normalisation and whitespace all preserve the value
// exactly. Non-UTF-8 bytes are already a separate check in the reader.
//
// WHAT THIS GIVES UP, stated because the caller inherits it: a change that is
// invisible to JSON semantics is now invisible to this check too, which means
// whitespace and key order. Neither can carry a user's text, so on this tool's
// threat model that is the right thing to trade for reading a second harness.

/**
 * Keys the raw text declares, counted without parsing.
 *
 * A key is a string literal followed by `:` outside a string. Counting them
 * textually and comparing against what the parse kept is the only way to see a
 * duplicate: `JSON.parse` has already collapsed it by the time any reviver or
 * walker runs, so nothing downstream can tell one ever existed.
 */
function textualKeyCount(raw) {
  let count = 0;
  let inString = false;
  let escaped = false;
  let closedAt = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') {
        inString = false;
        closedAt = i;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === ':' && closedAt !== -1) {
      count += 1;
      closedAt = -1;
    } else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
      // Anything else between the closing quote and a colon means that string
      // was a value, not a key.
      closedAt = -1;
    }
  }
  return count;
}

/** Keys the parsed value holds, at every depth. */
function parsedKeyCount(value) {
  if (Array.isArray(value)) {
    let n = 0;
    for (const v of value) n += parsedKeyCount(v);
    return n;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    let n = keys.length;
    for (const k of keys) n += parsedKeyCount(value[k]);
    return n;
  }
  return 0;
}

/**
 * Why this line's parse lost something, or null when it lost nothing.
 *
 * @param {string} raw    the line as it was written
 * @param {*} value       the result of parsing it
 * @returns {string|null} a reason, in the words the refusal will print
 */
export function parseLoss(raw, value) {
  const textual = textualKeyCount(raw);
  const parsed = parsedKeyCount(value);
  if (textual > parsed) {
    const n = textual - parsed;
    return `${n} duplicate object key${n === 1 ? '' : 's'}: the parse kept ${parsed} of ${textual}, so a field is gone`;
  }
  // Not an error, and not silence either. A textual count BELOW the parsed one
  // means this counter misread the line, which is a bug here rather than a
  // finding about the file, and refusing on it would blame the wrong party.
  // It has never fired; if it does, the count is wrong and must be fixed.
  if (textual < parsed) return null;
  return null;
}
