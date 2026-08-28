# deident

A CLI that reads your AI-coding-agent session logs, removes the identities, and
produces a zip you can hand to someone else. Node 20.15+ or 22.2+, standard library
only, **no npm dependencies and no network calls**: it reads local files, writes
local files, and nothing about your logs leaves the machine unless you send it.
Slice 1, depth-0 Claude Code sessions by default, MIT licensed.

**Which harness.** `--agent` selects the reader: `claude-code`, `codex`, `cursor`, `opencode`, `gemini-cli`.
`claude-code` is the default and the only one with a default location, because
only its layout was read on a real installation. Every other reader takes
`--root` and nothing else, so deident never names a directory it guessed.
`cursor` and `gemini-cli` record no working directory anywhere in
their logs, and deident admits material one directory at a time, so those can be read
and listed but not exported.
Nothing is translated between harnesses: every record leaves in its own
harness's shape with the identities replaced.

**Your half of it, and the export refuses without it.** deident infers your
username, your paths, your git identity and your git remotes from this machine.
It cannot infer that a string is your name, your birth date, your phone number or
a document number, because nothing on the machine says so. Those go in
`~/.deident-private/known-values.json`, the export refuses until you either write
it or say `--declare-nothing` once, and the manifest records which you chose. The
gate exists because the alternative already happened: an archive whose checks were
all green shipped 21 identity fields in plaintext for want of that file
([the form](#run-it), [the story](docs/limits.md#deident-cannot-infer-the-list-of-your-own-literal-values)).

**And when it is written, check the file itself.** `deident verify <zip>` reads
the finished archive and reports what is STILL in it, which is the question "did
it work" actually asks and the only one the export cannot answer about itself.
Both leaks this tool has had were found that way, by a person opening the shipped
bytes and looking for something they already held.

**The promise.** Every byte in the archive is either a value from a vocabulary this
tool defines in its own source, or a line of prose a person read on screen. The one
exception is your tool call parameters: 12.2% and 16.3% of the archive on the two
corpora measured so far, and the export prints the figure for yours.

**The cost, plainly.** A consumer whose scoring reads tool result CONTENT gets
less than it did. Results leave as shape alone, so a pipeline that greps result
bodies for build failures loses that input. Scoring that reads SHAPE is unaffected.

## What deident does NOT protect against

A tool that only lists its strengths gets over-trusted, and the first surprise
destroys it permanently. Each line links to its measurement in
[`docs/limits.md`](docs/limits.md); a live version prints at the moment of export.

- [The residue check proves less than its label.](docs/limits.md#the-residue-check-proves-less-than-its-label) It searches only for entities it already knows about. On a 90-file sample of the development corpus there were 230 distinct email addresses, 228 of them not the user's. Emails have a regex and are swept automatically. **Names do not have a regex.** That is what the semantic pass is for, and why it is mandatory.
- [The parameters of your tool calls are read by nobody.](docs/limits.md#the-parameters-of-your-tool-calls-are-read-by-nobody) The candidates file is built from prose, so the path you read and the brief you gave a subagent go in front of no reader, and a name appearing only there cannot be declared.
- [A name touching a letter or a digit is left alone](docs/limits.md#a-name-touching-a-letter-or-a-digit-is-left-alone), and so is [a spelling whose case change alters its length](docs/limits.md#case-insensitive-matching-is-withheld-from-a-few-spellings). [Document numbers need an English or Chinese label.](docs/limits.md#identity-document-numbers-are-found-by-their-label-in-english-and-chinese-only)
- [Credentials and phone numbers are matched by shape and by label, never by entropy](docs/limits.md#credentials-and-phone-numbers-are-matched-by-shape-and-only-by-shape), and [one with neither is not detected at all](docs/limits.md#a-credential-with-no-listed-prefix-and-no-label-beside-it-is-not-detected) **by the hand-written list**. Put `trufflehog` on your PATH and the export scans the finished archive with it and refuses on a hit: hundreds of maintained detectors, `--no-verification` so no candidate ever leaves the machine, 7s on a 41-entry archive. Without it the export runs exactly as before and prints, every time, that the scan did not run.
- [Device fingerprint survives](docs/limits.md#device-fingerprint-survives) (model mix, harness version sequence, localhost ports), and [documents you pasted into a prompt are prose](docs/limits.md#verbatim-documents-you-pasted-into-your-own-messages-are-not-detected).
- [The agent-memory deny-list knows one person's naming convention](docs/limits.md#the-agent-memory-deny-list-matches-filenames-and-knows-one-naming-convention), not a Claude Code universal, and now gates only tool parameters and attachments, since nothing a tool read ships as text.
- [Export scores are unverified against raw-log scores](docs/limits.md#four-of-six-upstream-scoring-axes-depend-on-rules-that-are-not-published), [subagent transcripts are not exported](docs/limits.md#subagent-and-workflow-transcripts-are-not-exported), and [`review.md` holds raw identity on purpose](docs/limits.md#reviewmd-is-full-of-raw-identity-on-purpose).
- [deident cannot infer the list of your own literal values](docs/limits.md#deident-cannot-infer-the-list-of-your-own-literal-values) (declare them, below), and [it cannot run the one check that matters on itself](docs/limits.md#the-check-deident-cannot-run-on-itself): both real leaks were found by a person who compared the finished archive against something they already held. That last step is yours.

## Install

You do not have to: `node <repo>/deident.js` is the whole tool. Installing adds
the skill that teaches an agent to drive it. The repository is its own marketplace
and one checkout serves both harnesses, so one `git pull` updates both:

```
claude plugin marketplace add https://github.com/gitroll-dev/deident
claude plugin install deident@deident
claude plugin details deident            # -> Skills (1)  deident
codex plugin marketplace add https://github.com/gitroll-dev/deident
codex plugin add deident@deident
codex debug prompt-input | grep deident  # -> deident:deident: <description>
```

The third command in each block is the verification, not a formality: a file on disk
proves nothing, so it prints the harness's own parse. The skill appears only in a
session started **after** the install; `AGENTS.md` points any other agent at it.

## Run it

Ask. `export my session logs`, or `幫我導出 session log`: any wording, any
language. The skill drives the flow and stops to ask what it cannot decide: which
workspaces may leave, which sessions to drop, and the prose to read.

Or drive it yourself, from any directory, installed or not. Only the last line here
writes an archive, and a bare `deident` prints usage and exits 0. Every flag and exit
code is in [`docs/flags.md`](docs/flags.md); `--help` prints the short form.

```
node deident.js scan              # survey, then tier each workspace in review.md.
                                  # One you do not touch stays out.
node deident.js triage            # optional, cheap: drop whole sessions on sight
node deident.js export --preview  # writes deident-candidates.txt, the prose to read
node deident.js export --entities deident-entities.json
node deident.js verify <the zip>   # what is STILL in it. Read-only.
```

**Your first export will refuse, and that is the design.** `scan` proposes `exclude`
for every workspace, git remote or not, and one matching `private`, `identity`,
`payroll` or a token in `~/.deident-private/denied.json` also needs `--include-denied
<exact-name>`. What it buys is a bound: whatever the tool misses can only be missed
inside a directory you typed by hand ([why](docs/design-rationale.md#opt-in-never-opt-out)).

**Declare what deident cannot infer**, in `~/.deident-private/known-values.json`.
A bare string is enough: `{"values": ["1974-11-03", {"kind": "person", "value":
"Nora Lund"}]}`. The export refuses until that file exists or you answer
`--declare-nothing` once; the reason is at the top of this page and is not
repeated here.

## The four-stage funnel

Each stage costs more than the one before and hands the next a shorter list, so
nothing expensive ever reads a session that was never going to be exported.

| Stage | Reads | Writes |
|---|---|---|
| `scan` | one pass, no reader | `review.md`: a census and a proposed tier per workspace |
| `triage` | 23 KB, the head of each session only | `deident-triage.txt`: one first prompt per still-kept session |
| `export --preview` | about 3.5 MB, roughly 900k tokens | `deident-candidates.txt` and a `.diff`, both outside `send/` |
| `export --entities` | the same again | `send/`, holding the zip and nothing else, plus `export-map.txt` and `WHAT-TO-SEND.txt` |

Measured 2026-08-24 on a 205-session corpus. Triage is optional and a verdict may
only ever **drop** a session; `export` runs every check before writing anything, and
any failure means nothing is written; `review`, the fifth entry point, renders
`review.md` with `--html` and starts no local server. A per-chunk limit of 20,000
characters cut 1,336,271 characters there, 10.3% of the prose, and **that number is
printed** ([the arithmetic](docs/design-rationale.md#what-the-stages-cost)).

**The last checks read the file, not the strings behind it.** Every other check
runs over a copy assembled in memory beside the entries, so the deflate path, the
entry naming and the rename from `.part` are outside all of them. After the zip is
written deident re-opens it and runs them over what came back: the
known-entity residue scan and a credential scan, both of which delete the archive on
a finding, and an **output deny sweep** that re-runs every deny rule, the
injected-span patterns and your own `denied.json` over the shipped bytes, entry names
included. The sweep reports and does not refuse. On the archive shipped 2026-08-27 it
finds 7 hits, every one a memory FILENAME sitting in prose that never opened the
file, which is the deny-list limit
[above](#what-deident-does-not-protect-against) rather than a leak: that list gates
tool parameters and attachments, and refusing on prose would refuse every export this
machine makes. A hit on any other list is one no other gate caught, and the rows name
which list and which entry. deident's own `[N bytes withheld by deident: …]` markers
are excluded from the count.

At stage 3 you, or an agent, answer `deident-candidates.txt` with
`deident-entities.json`, a list of `{kind, spellings, confidence}` whose format lives
in that file's own header so it cannot fall behind the code. The pass is remembered
per session: a second run reads only what is new or changed, a changed session
refuses by name, and `export --full` re-reads everything ([why it is
mandatory](docs/design-rationale.md#the-semantic-pass-is-mandatory)).

### What you may send, and what stays on your machine

The archive is the only thing that may leave, so it is the only thing in
`<out>/send/`. Everything else deident writes stays at the top level of `<out>`,
outside it, and `<out>/WHAT-TO-SEND.txt` lists every file with which side it is
on. **Send the contents of `send/` and nothing else.**

```
<out>/
  send/
    deident-export-<date>.zip     the archive. This, and only this
  WHAT-TO-SEND.txt                the label: every file, and whether it may leave
  review.md                       real paths and workspace names
  deident-triage.txt              each session's first prompt, raw
  deident-candidates.txt          prose the semantic pass has not seen yet
  export-map.txt                  real session ids against archive entries
  deident-preview-<date>.diff     the spellings deident refused to substitute, raw
```

`send/` is an allowlist rather than a rule to remember: a new artifact is written
outside it and is un-sendable by default. Beside those, in
`~/.deident-private/`: `known-values.json` (what you declared as your own),
`occurrences.json`, the most re-identifying thing deident writes, which pairs
every pseudonym with its real text and so backs `review --entity PERSON_11`, the
only way to tell a name replaced 991 times from an ordinary word, and the salt,
never written into any output, the only thing between a pseudonym and the name
behind it ([and what reversal cannot
do](docs/design-rationale.md#reversal-and-the-salt)). Everything named here
except the zip is **local only, never shared, never committed.**

## What is in the zip

One `.jsonl` per session under `sessions/<pseudonym>/<rewritten-uuid>.jsonl`. The
entry name is de-identified too: the raw one carries your username and the real
uuid where no JSON body does.

**Kept**: user prose, agent prose, thinking blocks, tool names, tool call
parameters, `is_error`, `result_bytes`, otherwise-unseen prompts from
`queue-operation` and `last-prompt`, timestamps quantised to the minute.
**Dropped**: every byte of tool result text, all code content, all images, all
pasted documents, account and organisation uuids, session titles, harness
bookkeeping, hook output, the local skill/agent/MCP inventories.

A tool result leaves as shape and nothing else:

```json
{"type":"tool_result","tool_use_id":"<rewritten>","is_error":true,"result_bytes":48213}
```

The tool NAME is on the `tool_use` block this id pairs with, and uuid rewriting is
deterministic, so that join still resolves. Code is replaced by a **count**:
`code_added_lines`, from `structuredPatch`, `null` when unknown and never `0`, since
over 511 measured edits a net figure undercounts true added by 57.5% and 24.1% of
edits have added > 0 with net == 0 (BRIEF §4.2).

## Development

`node deident.js --selftest` runs 260 fixtures on plain `node:assert`, no framework,
in `test/selftest.mjs`; each catches a specific bug, named in the fixture. Section
numbers in the source refer to `BRIEF.md` and `PLAN.md`. Never commit a session log,
an export, a preview diff or the salt; `.gitignore` covers all of them.
