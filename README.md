# deident

A CLI that reads your AI-coding-agent session logs, removes the identities, and
produces a zip you can hand to someone else. Node 20.15+ or 22.2+, standard
library only, **no npm dependencies and no network calls**: local files in, local
files out, and nothing leaves the machine unless you send it. Sessions are read
from `<root>/projects/*/*.jsonl`, depth 0 only. MIT.

**Your first export will refuse, twice, and both are the design.** `scan` proposes
`exclude` for every workspace until you say otherwise, and the export will not run
until you have declared what deident cannot infer from this machine: your name,
your birth date, a document number. It infers your username, paths, git identity
and git remotes; nothing on the machine says a given string is your passport
number. Those go in `~/.deident-private/known-values.json`, or you answer
`--declare-nothing` once and the manifest records that you did. The gate exists
because the alternative already happened: an archive whose checks were all green
shipped 21 identity fields in plaintext for want of that file
([the story](docs/limits.md#deident-cannot-infer-the-list-of-your-own-literal-values)).

**Then check the file itself.** `deident verify <zip>` reads the finished archive
and reports what is STILL in it, which is what "did it work" actually asks and the
only question the export cannot answer about itself. Both leaks this tool has had
were found that way, by a person opening the shipped bytes and looking for
something they already held.

**The promise, and its one exception.** Every byte in the archive is either a
value from a vocabulary this tool defines in its own source, or a line of prose a
person read on screen. The exception is your tool call parameters, 12.2% and 16.3%
of the archive on the two corpora measured so far; the export prints the figure
for yours. What a tool call RETURNED is cut to shape alone on the Claude Code
path, so a pipeline that greps result bodies for build failures loses that input
([what one consumer measured that to be worth](docs/limits.md#the-parameters-of-your-tool-calls-are-read-by-nobody)).

**Which harness.** `--agent` selects the reader: `claude-code` (the default, and
the only one with a default location), `codex`, `cursor`, `opencode`,
`gemini-cli`. Every other reader takes `--root` and nothing else, so deident never
names a directory it guessed, and nothing is translated between harnesses: every
record leaves in its own harness's shape with the identities replaced.

**`claude-code`, `codex` and `opencode` export; `cursor` and `gemini-cli` are
read, listed and counted but not exported**, because their logs record no
working directory anywhere and deident admits material one directory at a time.
An export refuses on that in its first second rather than three stages later,
and the same is true of any harness that gains a reader before it gains a
retention branch: each one declares which it has, and the suite checks the claim
against the code.

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

## The four stages, and what each costs

Each stage costs more than the one before and hands the next a shorter list, so
nothing expensive ever reads a session that was never going to be exported.

| Stage | Reads | Writes |
|---|---|---|
| `scan` | one pass, no reader | `review.md`: a census and a proposed tier per workspace |
| `triage` | 23 KB, the head of each session only | one first prompt per still-kept session |
| `export --preview` | about 3.5 MB, roughly 900k tokens | the prose to read, outside `send/` |
| `export --entities` | the same again | `send/`, holding the zip and nothing else |

`export` runs every check before writing anything, and any failure means nothing
is written. The last checks re-open the finished zip and run over what came back,
because every other check runs over a copy assembled in memory and the deflate
path, the entry naming and the rename from `.part` are outside all of them
([the stages in full](docs/scope.md#the-four-stage-funnel)).

## What may leave, and what is in it

**Send the contents of `send/` and nothing else.** The archive is the only thing
that may leave, so it is the only thing in there; everything else deident writes
stays at the top level of `<out>`, and `WHAT-TO-SEND.txt` lists every file with
which side it is on. That makes `send/` an allowlist rather than a rule to
remember: a new artifact is written outside it and is un-sendable by default.

The zip holds one `.jsonl` per session, each record in its own harness's shape
with the identities replaced. Prose, tool names and tool call parameters are
kept; every byte of tool result text, all code content, images and pasted
documents are not ([the full list, and what a tool result leaves as](docs/scope.md#what-is-in-the-zip)).


## Development

`node deident.js --selftest` runs 265 fixtures on plain `node:assert`, no framework,
in `test/selftest.mjs`; each catches a specific bug, named in the fixture. Section
numbers in the source refer to `BRIEF.md` and `PLAN.md`. Never commit a session log,
an export, a preview diff or the salt; `.gitignore` covers all of them.
