// The third source of entities: values the person DECLARES.
//
// deident had two sources and both of them were inference. Tier 0 infers from
// machine state (the username, paths, git config, credential shapes); tier 1
// infers from prose (what a reader can see). Neither can be TOLD "this exact
// string is mine", so the only way a value got protected was for the tool, or a
// model reading the prose, to work out on its own that it mattered.
//
// The measured cost of having no third source: a finished export with all six
// gates green shipped 21 identity fields in plaintext. Passport name orderings
// and three name spellings used across visa documents, a date and place of
// birth, a household registration address in two languages, three country
// addresses, a driving licence address, two banks' address of record, a phone
// number and a payment-platform account id. Concentrated in two sessions, one
// of them a browser-automation session filling a booking form with passport
// data. Every one of those values was already written down, by hand, in a
// personal-details file the same person maintained: the tool was performing
// semantic discovery to find a list that already existed.
//
// Same directory as the salt and denied.json, and the same properties: local,
// never committed, never written into the archive, never into --out. The shape
// follows denied.json's precedent, including the bare-array shorthand for the
// common case, because a second file with a third convention is a file people
// get wrong.

import fs from 'node:fs';
import path from 'node:path';
import { RefusalError } from '../cli/errors.mjs';
import { KINDS } from '../entities/seed.mjs';
// Imported rather than reimplemented: the four existence tests are identical
// for every file that lives beside the salt, and the consequence sentence is
// the only part that differs per file.
import { missingFromSaltDir } from './userdeny.mjs';

/** Filename read from the salt directory. */
export const KNOWN_VALUES_FILENAME = 'known-values.json';

/**
 * The kind a bare string gets.
 *
 * `secret` and not `person`, for the reason src/entities/tier1.mjs gives for
 * having the kind at all: it exists "so the semantic pass can name a VALUE, not
 * only an identity". A date of birth, a postal address and an account handle
 * are values, not identities, and they are most of what leaked. It also keeps
 * them out of the single-word path in src/entities/probe.mjs, which proposes
 * bare words only from a `person` and would otherwise offer `Road`, `Crescent`
 * and `Bay` out of every declared address.
 *
 * A person who wants a better pseudonym writes {"kind": "person", "value": ...}
 * and gets one. Nothing else about the run changes.
 */
export const DEFAULT_KIND = 'secret';

/**
 * Read the declared values from the salt directory.
 *
 * Missing returns an empty list here and is NOT the normal case: `export`
 * refuses on it a few lines later (see the declaration gate below). This
 * function stays lenient because `scan`, `review` and `triage` ship nothing,
 * and the gate is on the command that does.
 *
 * Malformed REFUSES, the way loadUserDeny
 * refuses, and for a sharper version of the same reason: an export that
 * silently loaded none of this list is indistinguishable, in every check the
 * tool has, from the export that leaked. Degrading to an empty list here would
 * turn the one source that cannot miss into the one that misses silently.
 *
 * @returns {ReadonlyArray<{value: string, kind: string}>}
 */
export function loadKnownValues(saltDir) {
  const file = path.join(saltDir, KNOWN_VALUES_FILENAME);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return Object.freeze([]);
    throw new RefusalError(`could not read ${file}`, {
      why: [
        `${err.code}: ${err.message}`,
        'This file is the only list of your own values deident does not have to guess at.',
      ],
      remedies: [{ label: 'Fix or remove it', command: `edit ${file}` }],
    });
  }
  return parseKnownValues(text, file);
}

/** Validation, with no I/O in it. Same split as readVerdicts and parseVerdicts. */
export function parseKnownValues(text, source = KNOWN_VALUES_FILENAME) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new RefusalError(`${source} is not valid JSON`, {
      why: [err.message, 'Refusing rather than exporting with none of the values you declared.'],
      remedies: [{ label: 'Fix it', command: `edit ${source}` }],
    });
  }

  // A bare array is the values, because that is the common case. Same
  // shorthand denied.json accepts, for the same reason.
  const raw = Array.isArray(parsed) ? parsed : parsed?.values;
  if (!Array.isArray(raw)) {
    throw new RefusalError(`${source} has no "values" array`, {
      why: [
        'Expected either a bare array of strings, or an object with a "values" array.',
        'Read as written it would declare nothing, and silence here is a leak.',
      ],
      remedies: [{ label: 'Fix it', command: `edit ${source}` }],
    });
  }

  const out = [];
  const seen = new Set();
  for (const [i, item] of raw.entries()) {
    const at = `${source} values[${i}]`;
    const isObject = item !== null && typeof item === 'object' && !Array.isArray(item);
    if (typeof item !== 'string' && !isObject) {
      throw badValue(at, 'is neither a string nor {"value": "...", "kind": "..."}', source);
    }

    const value = typeof item === 'string' ? item : item.value;
    if (typeof value !== 'string' || value.trim() === '') {
      // A blank declared value is not a harmless no-op: a spelling of
      // whitespace matches every space in the corpus, which is the condition
      // rejectReason names first. Refused here so the person sees the row they
      // typed, rather than a flagged entity in the export map three steps on.
      throw badValue(at, 'has no non-blank "value"', source);
    }

    const kind = (typeof item === 'string' ? undefined : item.kind) ?? DEFAULT_KIND;
    if (!KINDS.includes(kind)) {
      throw badValue(at, `has kind "${kind}"; expected one of ${KINDS.join(', ')}`, source);
    }

    // A repeated line is a typo in a hand-written file, not a decision worth
    // refusing over, and buildEntities would collapse it anyway.
    const key = JSON.stringify([kind, value.trim()]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Object.freeze({ value: value.trim(), kind }));
  }
  return Object.freeze(out);
}

function badValue(at, problem, source) {
  return new RefusalError(`${at} ${problem}`, {
    why: [
      'deident will not guess what a malformed declaration was meant to mean.',
      'Loading half this list is worse than loading none, because every check',
      'would still pass over the values it dropped. Nothing was read.',
    ],
    remedies: [{ label: 'Fix the row', command: `edit ${source}` }],
  });
}

/**
 * The warning for a salt directory that silently has none of the list.
 *
 * The same trap missingDenyWarning exists for, on the file whose absence is the
 * more expensive one: `--salt-dir` at a fresh directory is the documented way
 * to run as if for the first time, this file lives IN the salt directory, and a
 * run that declares nothing passes every gate. Narrow for the same reason: a
 * machine with no list anywhere is a genuine first run and must not be nagged,
 * which is F7's cry-wolf failure arriving on every install.
 */
export function missingKnownValuesWarning(saltDir, defaultDir) {
  const found = missingFromSaltDir(saltDir, defaultDir, KNOWN_VALUES_FILENAME);
  if (found === null) return null;
  return (
    `${saltDir} has no ${KNOWN_VALUES_FILENAME}, so none of the values you declared as your own ` +
    `are loaded, while ${found.fallback} has some. They will be replaced only if a reader happens to ` +
    `spot them in the prose, and no check will say otherwise. ` +
    `Copy it first: cp "${found.fallback}" "${found.here}"`
  );
}

// --- The declaration gate ---------------------------------------------------
//
// Everything above assumes the file is optional. It is not, and README said
// "no file is the normal case" until this shipped identity twice.
//
// The asymmetry is the whole argument. Tier 0 infers the username, the paths,
// the git identity and the git remotes from the machine, so an operator who
// declares nothing still gets those. Nothing on the machine says that a given
// string is their passport number, so an operator who declares nothing gets
// NOTHING for it, and every check still reports green, because every check in
// this tool is an internal-consistency check against a table that value never
// entered. docs/limits.md carries the measurement: six green checks, 21
// identity fields in plaintext.
//
// So the export asks once. Either the file exists, or the operator says once
// that they have nothing to declare and that answer is written down, and the
// manifest states which of the two happened. A run that declared nothing and a
// run that declared and got no hits are different facts and printed the same
// until now.
//
// The acknowledgement is stored IN known-values.json rather than beside it,
// with an empty `values` array. This module's own header gives the reason: "a
// second file with a third convention is a file people get wrong". It also
// means an operator can hand-write the acknowledgement, the parser needs no
// change (`acknowledged` is an extra key parseKnownValues already ignores), and
// the question "what did I declare, and when did I decide that" has one answer
// in one file.

/** What this machine has said about its own values. Never throws. */
export function declarationState(saltDir) {
  const file = path.join(saltDir, KNOWN_VALUES_FILENAME);
  if (!fs.existsSync(file)) return Object.freeze({ present: false, acknowledgedAt: null });
  let acknowledgedAt = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed) && typeof parsed?.acknowledged === 'string') {
      acknowledgedAt = parsed.acknowledged;
    }
  } catch {
    // Unreachable in an export: loadKnownValues reads the same file first and
    // refuses on anything this could throw on. Swallowed rather than duplicated
    // so the gate reports presence, which is all it is asked for, and the
    // parse error keeps its one owner.
  }
  return Object.freeze({ present: true, acknowledgedAt });
}

/**
 * The refusal for a run whose operator has never said anything either way.
 *
 * Names the KIND of value, with the shape, in the body. "Declare your own
 * values" means nothing to somebody who has not read the docs, and this is the
 * message that reaches an operator who never will.
 */
export function undeclaredRefusal(saltDir) {
  const file = path.join(saltDir, KNOWN_VALUES_FILENAME);
  return new RefusalError('you have not told deident which values are your own', {
    why: [
      `${file} does not exist, and it is the one list no inference reaches.`,
      'deident reads your username, your paths and your git identity off this machine.',
      'It cannot know that a string is your passport number, your date of birth, your',
      'phone number, or the spelling of your name on a document, because nothing on',
      'this machine says so. Undeclared, those are replaced only if a reader happens',
      'to spot them in the prose, and every check still reports green.',
      '',
      'One line is a whole file:',
      '  {"values": ["1974-11-03", {"kind": "person", "value": "Nora Lund"}]}',
      '',
      'An archive whose six checks were all green shipped 21 such fields in plaintext',
      'for want of this file. Nothing was written.',
    ],
    remedies: [
      { label: 'Declare them', command: `edit ${file}` },
      { label: 'Or say once that you have none', command: 'deident export --declare-nothing' },
    ],
  });
}

const NOTHING_NOTE = [
  'You ran deident export --declare-nothing: you have no literal values of your own',
  'to declare. Add them here at any time and they are protected from the next run on:',
  'a bare string, or {"kind": "person", "value": "..."} for a name. Local only: never',
  'share this file, never commit it, never put it in the output directory.',
].join(' ');

/**
 * Record "I have nothing to declare", once, beside the salt.
 *
 * Refuses over an existing file rather than overwriting it. An operator who
 * types this by mistake with a real list on disk would otherwise drop every
 * value they declared and keep a green export, which is the failure this whole
 * gate exists to stop, arriving through the door built to stop it.
 */
export function declareNothing(saltDir) {
  const file = path.join(saltDir, KNOWN_VALUES_FILENAME);
  if (fs.existsSync(file)) {
    throw new RefusalError(`${file} already exists, so there is nothing to acknowledge`, {
      why: [
        '--declare-nothing writes this file, and it will not write over the list you',
        'already have: that would drop every value you declared while every check kept',
        'reporting green. Nothing was written.',
      ],
      remedies: [
        { label: 'Read what is there', command: `edit ${file}` },
        { label: 'Then export', command: 'deident export' },
      ],
    });
  }
  const at = new Date().toISOString();
  try {
    fs.mkdirSync(saltDir, { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ _note: NOTHING_NOTE, acknowledged: at, values: [] }, null, 1)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch (err) {
    // NOT swallowed, unlike recordRead's write. That one is bookkeeping about a
    // command that already did its job; this one IS the operator's answer, and
    // an export that proceeds on an answer nobody recorded is the state this
    // gate refuses.
    throw new RefusalError(`could not write ${file}`, {
      why: [`${err.code}: ${err.message}`, 'Your acknowledgement was not recorded, so nothing was exported.'],
      remedies: [{ label: 'Write it by hand', command: `edit ${file}   # {"values": []}` }],
    });
  }
  return Object.freeze({ file, at });
}
