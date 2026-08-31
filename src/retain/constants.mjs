// Every threshold, cap and toggle in the codebase.
//
// BRIEF §6 posture: four of six scoring axes depend on rules that are not in
// any local repo, so prefer preserving evidence over shrinking bytes wherever
// the two conflict, and make every truncation threshold a named constant in
// ONE file so it can be changed without a rewrite.
//
// No literal number with a policy meaning appears anywhere else.

// The tool_result head/tail caps used to live here, with a comment conceding
// that nobody knew what `failure_signal` was counted from and that the values
// were therefore "set generously, not tightly". Nothing is truncated now
// because nothing is kept, so there is no threshold left to hedge about: the
// open question is MOOT rather than answered. `is_error` is still preserved
// verbatim, which is the half of that hedge that was load-bearing.

/**
 * BRIEF §6 posture again: thinking blocks are agent reasoning, so they are
 * kept, and this is the knob to turn if a corpus ever makes them expensive.
 *
 * This comment used to call them "the single largest byte lever", which is
 * false on the corpus in front of it and was never measured. Claude Code
 * writes the block with `thinking: ""` and keeps only the encrypted
 * `signature`, so the reasoning text is not in the log at all. Counted over
 * the 30 largest sessions on this machine: 7,771 thinking blocks, every one
 * of them empty, 0 bytes. `retainBlock` drops them on the empty-string guard
 * and this constant never decides anything here.
 *
 * It stays true, and the case stays, because a harness that DOES persist the
 * text is exactly what BRIEF §4.4 says not to guess about. Turning the knob
 * on the strength of one client's behaviour would discard reasoning prose for
 * every other one.
 */
export const KEEP_THINKING_BLOCKS = true;

/** §F4: quantise timestamps to the minute. Millisecond stamps fingerprint. */
export const TIMESTAMP_QUANTUM_MS = 60_000;

/**
 * Tool parameters whose value is code, not prose. BRIEF §3: code content is
 * never exported; it is replaced by a count.
 */
export const CODE_VALUED_TOOL_PARAMS = Object.freeze([
  'content',
  'new_string',
  'old_string',
  'edits',
]);

/** Minimum spelling length before an entity may be substituted at all. */
export const MIN_ENTITY_LENGTH = 3;

/** Minimum codepoint length for a CJK-only entity (BRIEF §4.5). */
export const MIN_CJK_ENTITY_CODEPOINTS = 2;

/**
 * How long a string has to be before it counts as "the same text".
 *
 * A cwd-less record (last-prompt, queue-operation, mode) is dropped only when
 * it REPLAYS something authored inside an excluded directory, and the test for
 * that is an exact string match against the excluded lines. Short strings are
 * useless for it: `"user"`, `"text"` and every JSON key appear on both sides,
 * so a floor is what keeps the test from matching everything.
 */
export const MIN_REPLAY_MATCH_CHARS = 40;

/**
 * How deeply one record may nest before deident refuses to read it.
 *
 * This is deident's own bound, and it exists because until now there was none.
 * The reader relied on `JSON.parse` and `JSON.stringify` running out of stack,
 * which is not a limit anybody chose: it is a V8 implementation detail that
 * moves with the platform, the Node version and the thread's stack size. Same
 * input, same Node 22, one record nested 6,000 levels: win32/arm64 refuses it,
 * macos-latest parses it and keeps it. A guarantee that differs by operating
 * system is not one, and the permissive side is the dangerous side, because the
 * record is then retained and every walker downstream of the reader is
 * recursive.
 *
 * The runtime's own numbers, measured on Node 22.23.1 win32/arm64, for scale.
 * `JSON.parse` is iterative now and survives 200,000, so the reader's first
 * RangeError guard had stopped catching anything at all; `JSON.stringify` gives
 * up at 2,107; `substituteRecord` at 2,245. Three unrelated numbers within 6%
 * of each other were the whole of what stood between a deep record and a crash
 * partway through an export, and nobody had chosen their order.
 *
 * The value is a bug detector, not a budget. Measured over the live corpus on
 * this machine, 3,850 session files and 341,320 records across every harness
 * present: the deepest record nests 12, and 99.97% nest 9 or fewer. 100 is
 * eight times the deepest thing real logs contain, and more than an order of
 * magnitude below the tightest runtime limit above, so what refuses a deep
 * record is always this number and never the stack.
 *
 * Raising it towards those runtime limits reinstates exactly the bug it was
 * added for. Lowering it costs a false refusal, which is loud, exit 3, names
 * the file and the line, and has a remedy that works.
 */
export const MAX_RECORD_DEPTH = 100;

/** How many example occurrences a refusal or a review row prints. */
export const EXAMPLES_PER_REPORT = 5;

/**
 * Characters of one prose chunk written to the candidates file.
 *
 * This replaces a 400-character cap that dropped 76.2% of the prose and
 * counted none of it. Removing the cap outright was measured over a copy of
 * the whole depth-0 corpus (216 files, 934 MB, one namespace shift, unclassified
 * workspaces skipped): the candidates file goes from 2,957,659 to 13,026,553
 * bytes, against the 3.5 MB docs/design-rationale.md budgets for the stage. So
 * a cap stays.
 *
 * The value is above ordinary prose by a wide margin, measured rather than
 * guessed. Over the twelve largest sessions, 17,466 post-retention prose
 * chunks: p50 62 characters, p90 236, p95 404, p99 1,562, longest 10,045. So
 * what 20,000 reaches is the tail, not a turn anybody typed: the pathological
 * chunk BRIEF measured at 938,529 characters is a pasted document or a dumped
 * log, and its first 20,000 characters are as much of it as a reader needs to
 * name what is in it.
 *
 * It is NOT true that it fires on nothing. That was inferred from the slice
 * above and the whole corpus disagrees: shipped, the same run writes
 * 11,684,461 bytes and reports 1,336,271 characters omitted, 10.3% of the
 * uncapped prose. Every one of those characters is counted and stated, in the
 * file, in the report and in --json. A silent cap is what made the old one a
 * disclosure; a stated one is a trade the reader can see.
 *
 * Most of the growth is the dedupe change, not the cap, and that half is not
 * restorable: the old key was a chunk's first 80 characters and it discarded
 * 1,590 chunks (10,443,749 characters) that were not identical to the chunk
 * that claimed the key. No cap value brings this file near 915 KB without
 * reinstating exactly that silent loss.
 */
export const CANDIDATE_CHUNK_CHARS = 20_000;

/**
 * How much prose one run puts in front of a reader before deferring the rest.
 *
 * The cap above bounds one CHUNK. This one bounds the FILE, and it exists
 * because the whole safety gate is a human or an agent reading that file in one
 * pass, and nothing was checking that the pass was possible. rememberShown runs
 * on every session in the batch before the refusal is thrown, keyed on having
 * been SHOWN, so a reader who got through 200 KB of the measured 915 KB had all
 * 205 sessions recorded as read and the next export printed
 * `205/205 sessions read ok`. That is not a silent failure, it is a positive
 * false claim.
 *
 * A calibration knob, not a constant to guess once and freeze: the right value
 * is the reader's context window, which this tool cannot see. 120,000
 * characters is roughly 30k tokens, which against the measured 915 KB and 250k
 * tokens leaves the reader room to work. `--batch-chars` overrides it.
 */
export const CANDIDATE_BATCH_CHARS = 120_000;

/**
 * Content that must not leave even when the session around it may.
 *
 * privacy-tiers 4 assumed the unit of decision is a session. It is not. This
 * machine's harness injects the owner's memory index, dictation hint list and
 * personal-data files into unrelated sessions as attachments and tool results,
 * so a per-session decision has to throw away an hour of clean engineering to
 * remove four lines it never asked for. Measured on the 2026-08-22 export:
 * dropping every session that carried one of these took the archive from 35
 * sessions to 17, and not one of those sessions was ABOUT the private matter.
 *
 * So the block is dropped and the session stays. Matched against a file path
 * or a filename, wherever one is named: a tool_use parameter, or an
 * attachment. It used to be matched against a tool result's own text too,
 * which is now moot, since no tool result text reaches the export at all.
 */
/**
 * The vocabulary a denial marker is allowed to speak.
 *
 * Every reason below is a fixed label, because a marker is read by the
 * RECIPIENT and the alternative is the matched substring: the withheld value
 * re-emitted in the clear, beside the count of the bytes just withheld.
 * Measured on the archives shipped on 2026-08-26, 243 markers in one and 110
 * in the other did exactly that, and no gate can catch it, because the
 * residual scan knows entity SPELLINGS and a deny token is deliberately not an
 * entity.
 *
 * A label says what CLASS of thing went, which is what lets a recipient ask
 * for it back when the removal was wrong. It never says what the thing was.
 *
 * Deliberately generic here for a second reason: the deny tokens themselves
 * are `private`, `payroll`, `identity`, and a person may add their own, one of
 * which was a real name. review.md says which token matched because review.md
 * is local; the marker inside the archive is not.
 */
export const DENIED_PATH_REASON = 'a deny-listed directory';

/**
 * Every per-person rule from denied.json collapses to this one label.
 *
 * A pattern someone writes into their own deny file is the case most likely to
 * BE a person's name, so it is the last one that may be quoted back. There is
 * no per-rule label, because the rule text is the thing being withheld.
 */
export const USER_DENY_REASON = 'a rule you configured';

// ONLY patterns that are true of the AGENT, not of one person. The first
// draft of this list carried the author's own dictation app, his immigration
// folder and a directory named after a real human. In a shared repository
// that is a disclosure, and for every other user it is dead weight. Anything
// machine-specific belongs in DENIED_USER_FILENAME beside the salt, where it
// is per-person by construction and is never committed.
export const DENIED_CONTENT = Object.freeze([
  // The index file the harness writes. This one really is the agent's.
  { re: /(^|[^a-z])MEMORY[.]md/i, reason: 'an agent memory file' },
  // The second pattern is NOT a Claude Code universal, and the line above it
  // used to say it was. It is one user's memory-index taxonomy. Kept because
  // it is a filename test rather than a person's name, so it discloses nothing
  // and costs nothing when it does not match, but a second user whose memory
  // files are named otherwise gets none of this and has to say so in
  // DENIED_USER_FILENAME. The limits block prints that at the moment of
  // export, because a limit stated in a source comment is not a disclosure.
  { re: /(reference|feedback|project|user)_[a-z0-9_]+[.]md/i, reason: 'an agent memory file' },
  // A dotted directory whose own name says it is private.
  { re: /[.][a-z0-9-]{2,24}-private[/\\]/i, reason: DENIED_PATH_REASON },
  // Filenames that are a credential or an identity record by convention.
  { re: /(credentials|profile)[.]json/i, reason: 'a secret or identity file' },
  // A private key body. Not a value to substitute: half a key is still a key,
  // and the whole block goes as a count. The measured route was tool output,
  // which is gone by construction now; this stays for the two routes that are
  // left, a PEM named or pasted into a tool_use parameter and one arriving as
  // an attachment. The header used to be what the reason line shipped, on the
  // grounds that it names no secret. It names the FILE, which is the half a
  // recipient does not need and the half the marker was leaking everywhere
  // else, so the label says the class and stops there.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: 'a cryptographic key' },
]);

/** Per-person additions, read from beside the salt. Never in the repository. */
export const DENIED_USER_FILENAME = 'denied.json';

/**
 * A deny-listed directory named ANYWHERE in a value, not only as the cwd.
 *
 * BRIEF §4.11 says per-directory opt-in, never opt-out, and privacy-tiers §4
 * claims three levels of granularity make the deny-list sufficient. All three
 * test where the agent WAS, never what it TOUCHED, so a Read, an Edit or a
 * directory listing of a deny-listed path from an allowed cwd was invisible to
 * every one of them. Measured on a real export: files under
 * `…ops-handover\\private\\` were named 17, 36 and 5 times
 * (`vendor-search\\SCORECARD.md`, `VENDOR-BRIEF.md`,
 * `calc.mjs`), the parent got a WORKSPACE pseudonym and the subpath
 * below it did not, and a `[chat]…txt` from the archive of private messages was named
 * by a directory listing run from an included directory.
 *
 * The token has to sit inside a path SEGMENT: a separator, then segment
 * characters (no spaces, no quotes), then the token. That is what keeps it off
 * the sentence "at /home and private things".
 */
// Generic only. Per-person tokens arrive from beside the salt; see
// policy/userdeny.mjs and the segment test in records.mjs, which is what
// applies them.
const DENY_PATH_TOKENS = ['private', 'identity', 'payroll'];

/**
 * The token, and the one thing that must not be immediately before it.
 *
 * Both patterns below allow up to 60 segment characters ahead of the token, so
 * `Identity` inside `UpdateIdentity` was a match and a PowerShell property name
 * in a tool_use `command` parameter read as a deny-listed directory. Measured
 * on the archive shipped 2026-08-27: one such hit, in
 * `$($_.UpdateIdentity.RevisionNumber)`, where the separator that completed the
 * match was the backslash of a JSON `\"` escape.
 *
 * A path segment never runs an ordinary word straight into the token: the
 * character before it is a separator, a dot, a dash or an underscore. A
 * CamelCase identifier always does. So the test is one letter.
 * `.identity-private/` and `ops-handover\private\` still match; `UpdateIdentity`
 * and `HeroIdentity.tsx` do not. The `i` flag covers both cases of the class.
 *
 * The second alternative is not a refinement, it is the reason the first one
 * cannot ship alone. Tightening a deny pattern is the dangerous direction, so
 * the loss was measured rather than reasoned, and the letter test on its own
 * dropped a REAL deny-listed path: grep output pasted into a tool parameter
 * arrives as `…control.\nprivate/cpa-search/OUTREACH-DRAFTS.md:135:`, where the
 * escape's own `n` is the letter before the token. `\` then one letter is an
 * escape, never a word, so the token is still a segment head there.
 *
 * Measured over the live corpus, 3,783 files, every DECODED string value of
 * every record, which is the surface `deniedReason` sees rather than the raw
 * JSON: 43,543 matches before, 43,448 after, 95 lost across 15 distinct
 * shapes, and every one of them is a word glued to the token rather than a
 * path segment: `sessionIdentity` (69), `leprivate`, `cloudidentity`,
 * `apspayroll`, `www.surepayroll`, `WorkforceIdentity`, `MovePayroll`,
 * `loadPrivateRules`, `isPrivate`.
 *
 * One of the fifteen is a path and is stated rather than hidden:
 * `\raykuprojectsops-handoverprivate`, twice, a real deny-listed path whose
 * separators were already gone before deident saw it. The same path spelled
 * with its separators still matches, and a rule that admitted this one would
 * have to admit every word ending in a letter.
 */
const DENY_TOKEN =
  '(?:(?<![a-z])|(?<=\\\\[a-z]))(?:' + DENY_PATH_TOKENS.join('|') + ')';

export const DENIED_PATH_RE = new RegExp(
  '[\\\\/][^\\\\/\\s"' + String.fromCharCode(39) + '`]{0,60}?' + DENY_TOKEN,
  'i',
);

/**
 * The same as DENIED_PATH_RE, for a path that BEGINS with the segment.
 *
 * DENIED_PATH_RE requires a separator BEFORE the token, so a relative path
 * quoted as `private/vendor-search/COST-COMPARISON.md:17:` matched nothing,
 * measured, that shape survived a real export inside grep output. Requiring a
 * separator AFTER the segment instead is what keeps this off the ordinary
 * English sentence "a private repo": there the next character is a space.
 */
export const DENIED_PATH_HEAD_RE = new RegExp(
  '(?:^|[\\s"' + String.fromCharCode(39) + '`(=])[^\\\\/\\s"' + String.fromCharCode(39) + '`]{0,60}?' +
    DENY_TOKEN +
    '[^\\\\/\\s"' + String.fromCharCode(39) + '`]{0,60}?[\\\\/]',
  'i',
);

/**
 * One path-shaped token inside ordinary prose.
 *
 * Prose is not a file listing: withholding a whole assistant turn because it
 * mentions a path would throw away the scoring evidence the export exists for.
 * The path itself is what must not ship, so the path itself is what goes.
 * Measured on a real export, in assistant prose rather than tool output:
 * `…/private/vendor-search/SCORECARD.md` and
 * `WORKSPACE_n/private/WORKSPACE_m/VENDOR-BRIEF.md`.
 */
export const PATH_TOKEN_RE = /[^\s"'`,;()\[\]{}<>]*[\\\\/][^\s"'`,;()\[\]{}<>]*/g;

/** What replaces one withheld path token. Short, and it names no directory. */
export const DENIED_PATH_MARKER = '[path withheld by deident]';

/** What replaces a denied block. Counted, never silent. */
export const DENIED_MARKER = (bytes, why) =>
  `[${bytes} bytes withheld by deident: ${why}]`;

/**
 * Harness-injected spans inside an otherwise authored message.
 *
 * None of this was typed by the user or written by the model: the harness
 * splices it in at send time, and it is where the memory index, the recalled
 * memories and local command output ride into a session that has nothing to
 * do with them. Removing it loses no authored content.
 */
/**
 * Codex's own injected wrappers, kept apart from INJECTED_SPANS on the rule the
 * codex schema states: nothing is derived from, mapped onto, or named after
 * another agent's vocabulary. Claude Code's `<system-reminder>` is not this and
 * this is not it.
 *
 * These arrive as WHOLE `input_text` blocks rather than spans embedded in a
 * person's sentence, so they are matched by prefix and the block is dropped,
 * which is safer than running a regex over prose. Measured on a real rollout:
 * without this the candidates file opens on `<permissions instructions>` and
 * `<app-context>`, vendor boilerplate the reader is then asked to scan for
 * third-party names it cannot contain.
 */
// Censused rather than guessed, over 704 rollout files, by counting every
// block-opening marker in a `message` payload. Bytes are what each costs the
// candidates file, which is the reader's attention:
//
//   <skills_instructions>       801   15.75 MB
//   <permissions instructions>  675    1.51 MB
//   <app-context>               305    1.43 MB
//   # AGENTS.md instructions    115    1.75 MB
//   <subagent_notification>     442    1.05 MB
//   <codex_internal_context>    205    1.05 MB
//   <collaboration_mode>        431    0.98 MB
//   <environment_context>     1,247    0.84 MB
//   <recommended_plugins>       306    0.64 MB
//   <heartbeat>                 231    0.64 MB
//   <model_switch>               22    0.39 MB
//   <plugins_instructions>      340    0.34 MB
//   <apps_instructions>         341    0.22 MB
//
// TWO MARKERS ARE DELIBERATELY ABSENT, and their absence is the point: `##
// Memory` (199, 3.30 MB) and `<proposed_plan>` (73, 0.56 MB) may be authored --
// the first can be a person's own memory file, the second is the agent's
// written plan, which this schema keeps under `Plan` elsewhere. Dropping
// something a person wrote is worse than leaving boilerplate in, so an
// ambiguous marker stays.
export const CODEX_INJECTED_PREFIXES = Object.freeze([
  '<environment_context>',
  '<user_instructions>',
  '<INSTRUCTIONS>',
  '<permissions instructions>',
  '<app-context>',
  '<skills_instructions>',
  '<collaboration_mode>',
  '<recommended_plugins>',
  '<plugins_instructions>',
  '<apps_instructions>',
  '<subagent_notification>',
  '<codex_internal_context',
  '<heartbeat>',
  '<model_switch>',
  '# AGENTS.md instructions for',
]);

export const INJECTED_SPANS = Object.freeze([
  /<system-reminder>[^]*?<[/]system-reminder>/g,
  /<local-command-stdout>[^]*?<[/]local-command-stdout>/g,
  /<local-command-stderr>[^]*?<[/]local-command-stderr>/g,
]);

/**
 * Prose whose subject is a live credential, withheld as a whole block.
 *
 * String-level substitution needs the exact literal, and a reviewer looking at
 * a recovery kit or a vault map cannot promise to have enumerated every way it
 * is written across a long session. On 2026-08-22 that gap is what forced two
 * sessions out whole: "truncated in the quotes, so complete string removal
 * cannot be guaranteed".
 *
 * A block is coarser than a string and that is the point. Losing a paragraph
 * is cheap; a key that leaves cannot be recalled, and it does not care who was
 * holding it.
 */
// One label for all seven: the block goes because its SUBJECT is a live
// credential, and naming which of the seven shapes matched would put the
// credential's own wording back in the marker.
export const DENIED_TEXT = Object.freeze([
  { re: /1Password[- ]?Emergency[- ]?Kit/i, reason: 'a credential' },
  { re: /Emergency Kit/i, reason: 'a credential' },
  { re: /Secret Key[ ]*[:：]/i, reason: 'a credential' },
  { re: /master password/i, reason: 'a credential' },
  { re: /(recovery|backup) codes?[ ]*[:：]/i, reason: 'a credential' },
  { re: /備份碼|復原碼/, reason: 'a credential' },
  { re: /X-Amz-Security-Token/i, reason: 'a credential' },
]);
