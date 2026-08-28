// Every deny rule, re-run over the bytes the recipient opens.
//
// Of the guarantees this tool makes, exactly one had a gate that re-read the
// finished archive: entity substitution. pipeline.mjs re-opens the zip and runs
// `checkResidue` over the shipped bytes, which is why a second code path that
// skipped substitution could never survive. It gets caught whatever route it
// took, and nobody has to have remembered it existed.
//
// Denial, injection-stripping and the placeholder had no such gate. They were
// enforced at whichever call site remembered to call them, so each of them
// grew one list per caller, and the tool was fixed four times for exactly
// that: a `document` block reviewed on one path and unknown on another, a
// `queued_command` prompt copied verbatim past the decision list,
// `edited_text_file` and `file` two lines below it, and `retainPrompt` never
// calling stripInjected at all. Six of the confirmed findings were on that
// list, and every one of them is visible in the finished archive without
// anybody enumerating a call site.
//
// So: no call sites. The shipped entries, the same lists the retention path
// uses, read back off disk.
//
// It reports and does not refuse, and §F7 is the whole reason. Measured on the
// archive shipped 2026-08-27, after the DENY_TOKEN fix and with deident's own
// markers excluded: 7 hits, every one of them DENIED_CONTENT against a memory
// FILENAME sitting in prose. Six are `memory.md` inside a published
// documentation URL that a turn was discussing; the seventh names one of this
// machine's own memory files in a sentence about it.
//
// Neither is a leak. It is the limit README states as "the bare NAME of a file
// or directory you discussed, where prose quotes it without a path":
// DENIED_CONTENT is a filename test that gates a tool_use parameter and an
// attachment, prose is gated by DENIED_TEXT, and prose naming a file that was
// never opened is a case the tool has always declined to withhold, because
// withholding an assistant turn for mentioning a filename throws away the
// scoring evidence the export exists for. A gate that refused there would
// refuse on every export this machine makes, and a check that cries wolf is
// the first thing switched off.

import {
  DENIED_CONTENT,
  DENIED_TEXT,
  DENIED_PATH_RE,
  DENIED_PATH_HEAD_RE,
  DENIED_MARKER,
  DENIED_PATH_MARKER,
  INJECTED_SPANS,
  EXAMPLES_PER_REPORT,
} from '../retain/constants.mjs';
import { userDenyPatterns } from '../policy/userdeny.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The markers deident itself mints, excluded explicitly rather than by luck.
 *
 * A marker carries its own reason text, so `[412 bytes withheld by deident: a
 * deny-listed directory]` trips DENIED_PATH_RE on the word it just used to
 * explain a removal, and the sweep would report deident's own successes as
 * findings. Excluded here, out loud, because the alternative is a count that
 * looks clean for a reason nobody wrote down.
 *
 * Derived from the two constants rather than copied, so a reworded marker
 * cannot silently stop being excluded. The two sentinels are rendered into a
 * real marker and then swapped for what the marker actually varies by: they
 * contain no regex metacharacter, so `escapeRe` returns them untouched.
 */
const BYTES_SENTINEL = 'zzBYTESzz';
const REASON_SENTINEL = 'zzREASONzz';
const MINTED_MARKER_RE = new RegExp(
  [
    escapeRe(DENIED_MARKER(BYTES_SENTINEL, REASON_SENTINEL))
      .replace(BYTES_SENTINEL, '\\d+')
      .replace(REASON_SENTINEL, '[^\\]]*'),
    escapeRe(DENIED_PATH_MARKER),
  ].join('|'),
  'g',
);

/**
 * The lists, named as the operator would have to name them to act.
 *
 * `userDenyPatterns()` is read here rather than captured at module load: it is
 * set once from beside the salt before retention, and a sweep holding a stale
 * empty copy of it would be silently blind to exactly the rules that are one
 * person's own.
 */
function denyRules() {
  return [
    ...DENIED_CONTENT.map(({ re }) => ({ list: 'DENIED_CONTENT', re })),
    ...DENIED_TEXT.map(({ re }) => ({ list: 'DENIED_TEXT', re })),
    ...userDenyPatterns().map((re) => ({ list: 'your denied.json', re })),
    { list: 'DENIED_PATH_RE', re: DENIED_PATH_RE },
    { list: 'DENIED_PATH_HEAD_RE', re: DENIED_PATH_HEAD_RE },
    ...INJECTED_SPANS.map((re) => ({ list: 'INJECTED_SPANS', re })),
  ];
}

const asGlobal = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);

/**
 * Sweep the entries read back out of the finished zip.
 *
 * The entry NAMES are swept with the data, for the reason F38 exists: a value
 * can ride out inside one.
 *
 * @param {ReadonlyArray<{name: string, data: string}>} entries  from readZipFile
 * @returns {{name, ok, detail, total, byList, hits}} a check result, shaped
 *   like checkResidue's so the report renders it beside that one
 */
export function sweepDenied(entries) {
  // Built once, with `g` forced and a fresh object per rule: several of the
  // shipped patterns already carry `g`, and a shared `lastIndex` across
  // entries is how a scan silently starts in the middle of the next one.
  const rules = denyRules().map(({ list, re }) => ({ list, scan: asGlobal(re) }));
  const byList = new Map();
  const hits = [];
  for (const entry of entries) {
    const text = `${entry.name}\n${entry.data}`.replace(MINTED_MARKER_RE, ' ');
    for (const { list, scan } of rules) {
      scan.lastIndex = 0;
      let m;
      while ((m = scan.exec(text)) !== null) {
        byList.set(list, (byList.get(list) ?? 0) + 1);
        // Redacted to 40 characters, the same cut checks.mjs makes: a finding
        // that prints the whole matched span leaks the thing it is reporting.
        if (hits.length < EXAMPLES_PER_REPORT) {
          hits.push(Object.freeze({ list, entry: entry.name, excerpt: `${m[0].slice(0, 40)}…` }));
        }
        if (m[0] === '') scan.lastIndex += 1;
      }
    }
  }
  const total = [...byList.values()].reduce((a, b) => a + b, 0);
  return Object.freeze({
    name: 'output deny sweep',
    ok: total === 0,
    detail: `${total} hit${total === 1 ? '' : 's'} from ${rules.length} deny rules`,
    total,
    byList: Object.freeze(
      [...byList]
        .map(([list, count]) => Object.freeze({ list, count }))
        .sort((a, b) => b.count - a.count),
    ),
    hits: Object.freeze(hits),
  });
}
