# What ships now, and what waits

Two consumers, and only the first one is real today.

**Now.** The 2026-08-19 Mid Sync-up action item: the team exports recent session
logs, filters anything private, and hands the result to Nora Lund to re-run the
team's AI fluency scoring. Seven people, internal, once. There is no receiving
endpoint and no platform pipeline to attach to yet.

**Later.** Ticket 110 and 114: replace EntireIO with an upload tool that carries
a redaction mechanism, for Fellowship apprentices from September and eventually
for enterprise users. 110 blocks 114.

The rule used to split them: **anything whose absence makes the first run unsafe
or impossible ships now; anything whose consumer does not exist yet waits.** A
third category is called out separately below, because it is neither.

---

## Ships now

| Piece | Why it cannot wait |
|---|---|
| Corpus root resolution, depth-0 enumeration | Nothing works without it. |
| Per-line `cwd` resolution, including `relocated` / `worktree-state` | The slug records only the launch directory. Without this the filter evaluates the wrong directory, and a session that walked into `\private` exports it. |
| Workspace tiers from readable signals, deny-list, per-line `cwd` gate | The safety mechanism. Without proposals the user faces 29 questions and answers none. |
| Longest-match single-pass substitution, lookaround boundaries, escaping variants | The product. |
| Salted pseudonyms, no plaintext map, `--namespace` | Not optional: 23 lines in the live corpus already match `PERSON_n`, put there by the sessions that built this tool. An abort-only implementation cannot export the corpus of the people building it. |
| `structuredPatch` distilled to a true added-line count | A wrong `0` manufactures an "abandoned" session downstream and no existing test catches it. |
| Retention table over all 19 record types, unknown type refuses | A silent drop loses user turns that are scored. |
| Verification gates, abort before any write | The trust story is these plus the residual scan, and nothing else. |
| Residual scan labelled `known-entity residue` | The label is the security control. A bare "safe" claims more than the mechanism delivers. |
| `review.md` as report and config | The audit record. Someone other than the uploader has to be able to read what was decided. |
| Candidate confirmation for low-confidence names | Replaces the mandatory-LLM constraint. Nobody gets stuck without an agent, and every candidate is seen by a person or a model. |
| Deterministic zip, `.part` then rename | A half-written export is worse than none. |
| `--selftest` with a fixture per fixed bug | The regression floor. |
| Ledger **recording** of what was exported | Record now or the first incremental run is impossible. Reading it is next, writing it is today. |

## Waits, with the trigger that starts it

| Piece | Trigger |
|---|---|
| Browser review GUI | The first uploader who is not on the team. |
| `deident push`, auth, resumable chunked upload | A receiving endpoint exists. Blocked on Nora's pipeline shape, not on us. |
| The receiving endpoint itself | The platform decides what it wants to ingest. |
| `count-only` and `open` tiers | Someone declines to share content but wants to be counted. Slice 1 runs on `exclude` and `redact` alone. |
| Incremental **logic** (new / changed / already sent) | The second export. Cheap once the ledger has entries. |
| Semantic session grouping | The user asks for it, or Nora reports the granularity is actually broken with an example. Until then `unresolved` is the honest value. |
| Any non-Claude-Code adapter | Somebody on the team produces a real log in that format to test against. Vendor docs alone are not enough to write a parser. |
| The subagent and workflow tree | Nora asks for orchestration evidence and says the parent session's `Agent` / `Workflow` records are insufficient. It is 931 MB of machine-to-machine traffic with no human turns. |

## Neither: things that are not ours to fix

Recorded so they are not silently inherited.

- **The OVR null-axis inflation.** `verdict.ts` averages over axes that have a
  reading and skips nulls, so on the shipped demo record a prose-only user scores
  68 against an equally skilled harness user's 63, and a Mid-level user at 58
  becomes Senior at 64 if trouble detection is suppressed. Not caused here, but
  this tool is the first thing that will feed it a large prose-only corpus.
- **The `ai-log-expertise` and `ai-log-csv-quality` prompts.** Four of six axes
  and both hero tiles depend on rules that exist in neither repo. Every
  threshold that is still a threshold stays a named constant in one file, and
  the posture is: preserve evidence over shrinking bytes, wherever the evidence
  is something a person could read.

  Tool results are the one place that posture was overruled, deliberately, and
  the reason is that they were never evidence anybody read: no reader and no
  semantic pass ever saw them, so a miss inside them was invisible rather than
  merely undetected. They leave as shape now. `is_error` survives verbatim,
  which is the part a scoring axis most plausibly depends on; a consumer that
  read an axis off result TEXT is worse off, and docs/limits.md says so.
- **Comparability across uploaders.** Different people withhold different
  amounts. The manifest states per-uploader tier counts so a recipient can see
  it; deciding what to do about it is the platform's call.

---

## Settled

**Delivery is a file, not an upload.** Seven manual transfers once cost less than
an endpoint nobody owns, and the endpoint's shape depends on a pipeline that is
not designed yet. `push` and the receiver stay on the roadmap.

**The review page uses the machine's own fonts.** The audit rounds removed the
web font to make the self-contained claim unarguable. Embedding a face as a data
URI would restore the intended typography at a few hundred KB and was declined.

**The individual decides, always. There is no organisation policy file.**
A Fellowship participant sets their own tiers exactly as a teammate does; a
programme cannot pre-decide for them, and nor can an employer. This is the
"privacy by design" claim taken literally rather than as a slogan, and it removes
a roadmap item rather than adding one.

Two consequences follow, and neither is optional:

- **Comparability across uploaders can never be fixed by policy.** If everyone
  chooses for themselves, corpora differ in ways no rule can normalise. The
  manifest's per-uploader tier counts therefore stop being a nicety and become
  the only thing standing between a privacy choice and a recipient reading it as
  a skill gap. Ship them, and make them legible.
- **`count-only` gets more important, not less.** It is the one tier that lets
  someone withhold content without shrinking their own denominators. Under a
  policy regime it was a convenience; under free choice it is the main defence
  against the conservative person scoring worse for being conservative.

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
