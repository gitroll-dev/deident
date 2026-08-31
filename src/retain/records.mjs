// The retention table: PLAN §3 as code.
//
// BRIEF §4.4: enumerate every record type and decide each one DELIBERATELY;
// do not whitelist by guessing. An unknown type is therefore a refusal, not a
// silent drop, a new Claude Code version adding a record type is precisely
// the case §4.4 was written about, and the failure mode it warns of is user
// text being discarded without anybody noticing.
//
// Counts in the comments were measured over the full depth-0 corpus.

import { RefusalError } from '../cli/errors.mjs';
import { loadSchema, schemaOverlayPath } from './schema.mjs';
import { userDenyTokens, userDenyPatterns } from '../policy/userdeny.mjs';
import { retainToolUseResult, distillToolResult, lineCount } from './toolresult.mjs';
import {
  KEEP_THINKING_BLOCKS,
  TIMESTAMP_QUANTUM_MS,
  CODE_VALUED_TOOL_PARAMS,
  DENIED_CONTENT,
  DENIED_PATH_RE,
  DENIED_PATH_HEAD_RE,
  DENIED_PATH_REASON,
  PATH_TOKEN_RE,
  DENIED_PATH_MARKER,
  DENIED_MARKER,
  USER_DENY_REASON,
  DENIED_TEXT,
  INJECTED_SPANS,
  CODEX_INJECTED_PREFIXES,
} from './constants.mjs';

// PLAN §3.1. DROP-AFTER-USE types are consumed by cwdtrack at step 4 and
// dropped here at step 7; the ordering is load-bearing (PLAN §2).
// The retention VOCABULARY -- which record types, attachment types, system
// subtypes and content blocks exist, and what was decided about each -- now
// lives in schemas/<agent>/*.json as versioned data. src/retain/schema.mjs
// explains why, and states the fail-closed guarantee this deliberately does
// not touch: a name in no schema file and no overlay is still refused.
//
// The DECISIONS stay here. What "keep" or "drop-after-use" actually does to a
// record is behaviour, and behaviour belongs in code.
//
// The prose that used to sit above each literal, explaining WHY a type was
// dropped, moved into the schema file's `rationale` block so the reason
// travels with the decision instead of with the code that reads it.
// THE AGENT IS CHOSEN AT RUNTIME, NOT AT IMPORT TIME.
//
// This used to be `loadSchema('claude-code', ...)` at module scope, so
// `--agent codex` selected a reader and then judged its records against Claude
// Code's vocabulary. Every Codex record type came back UNKNOWN, an export
// refused, and the only way past was `--skip-unknown-types`, which drops them.
// `schemas/codex/2026-08.json` has said `event_msg: keep` the whole time and was
// never read.
//
// What it cost, measured downstream: two donors' exports reached a research
// corpus with ZERO shell records, because every shell call in Codex lives inside
// `event_msg` / `response_item`. Their verification could not be scored at all.
// That is exactly the harm `pipeline.mjs` warns about two hundred lines below --
// "a silent drop is how the highest-value user gets quietly deleted" -- produced
// by this file rather than caught by it.
let SCHEMA = loadSchema('claude-code', schemaOverlayPath());
const namesWith = (obj, decision) =>
  Object.entries(obj).filter(([, d]) => d === decision).map(([name]) => name);

let TOP_LEVEL = SCHEMA.recordTypes;

/**
 * Point the retention decisions at one agent's vocabulary. Call once, before any
 * record is retained; `pipeline.mjs` does it as soon as the corpus resolves.
 */
export function useAgentSchema(agent) {
  SCHEMA = loadSchema(agent, schemaOverlayPath());
  TOP_LEVEL = SCHEMA.recordTypes;
  ATTACHMENT_KEEP = Object.freeze(namesWith(SCHEMA.attachmentTypes ?? {}, 'keep'));
  ATTACHMENT_DROP = Object.freeze(namesWith(SCHEMA.attachmentTypes ?? {}, 'drop'));
  SYSTEM_KEEP = Object.freeze(namesWith(SCHEMA.systemSubtypes ?? {}, 'keep'));
  SYSTEM_DROP = Object.freeze(namesWith(SCHEMA.systemSubtypes ?? {}, 'drop'));
  BLOCK_DECISIONS = SCHEMA.contentBlocks;
  RETENTION_TABLE = buildTable();
  return SCHEMA;
}

// PLAN §3.2. Only three of the 26 carry user text.
let ATTACHMENT_KEEP = Object.freeze(namesWith(SCHEMA.attachmentTypes ?? {}, 'keep'));
let ATTACHMENT_DROP = Object.freeze(namesWith(SCHEMA.attachmentTypes ?? {}, 'drop'));

// PLAN §3.1 row 9: keep compact_boundary only. away_summary is prose naming
// third parties who never consented (§F2) and is dropped even though it is
// user-adjacent.
let SYSTEM_KEEP = Object.freeze(namesWith(SCHEMA.systemSubtypes ?? {}, 'keep'));
let SYSTEM_DROP = Object.freeze(namesWith(SCHEMA.systemSubtypes ?? {}, 'drop'));

// `shape-only` is a third decision beside keep and drop: the block survives and
// its payload does not. Calling it `keep` would put a reviewed decision in this
// table that no longer describes what happens. See retainBlock's tool_result
// case for the measurement.
//
// `args-only` is a fourth, and it is DECLARATIVE TODAY. It exists for a harness
// that merges a call with its result into one record, and every name carrying it
// is Codex's. Nothing routes a Codex record here: retainByType has no case for
// `response_item` and refuses it by name, and the export refuses earlier still at
// the I1 round-trip. So the decision is recorded for whoever builds that path,
// and this comment is here so nobody reads the schema and concludes a Codex
// export currently ships tool arguments. It ships nothing; it does not run.
let BLOCK_DECISIONS = SCHEMA.contentBlocks;

/**
 * The prose half of the two tables above: which fields of a RETAINED record
 * hold text a reader must be shown.
 *
 * `extractProseBySession` in pipeline.mjs used to answer this question a
 * second time, by naming two record types, two block types and a generic
 * scrape of an attachment's string values. That second list went stale the
 * moment a `queued_command`'s `prompt` stopped being a raw string and became a
 * retained block array: the scrape found no string under it, the prompt
 * vanished from deident-candidates.txt, and the archive shipped it anyway,
 * with the export exiting 0 and every check green. 506 of the 527 prompts in
 * the corpus it was measured on had exactly the shape that regressed.
 *
 * That class is the worst one this tool has: the candidates file is what a
 * human reads, and the semantic pass is the only producer that can catch a
 * name nothing else recognises. A name that is retained but never put in front
 * of the reader is un-declarable BY CONSTRUCTION. It is also the fourth time
 * two lists have answered one question here, so there is one list, and the
 * extractor reads it rather than restating it.
 *
 * Keyed by FIELD NAME rather than by record type, because a field name is what
 * survives retention: `retainTurn` and `retainAttachment` emit the SAME block
 * array under different keys, and `retainContent` is already polymorphic over
 * the array and string forms. So is this table.
 *
 *   'prose'  a reader must see it. An array is walked as retained blocks; a
 *            string is shown as it stands.
 *   'skip'   an identifier, a stamp, a role, a tool name, or the one gap
 *            docs/limits.md declares. Not descended into either.
 *
 * An UNDECLARED field falls to 'prose', because between showing the reader a
 * uuid and hiding a sentence from them, only one of the two is the bug this
 * table exists for. F204 then fails on the undeclared field, so the fail-open
 * default buys safety without buying silence.
 */
export const PROSE_FIELDS = Object.freeze({
  text: 'prose', // a `text` block, `last-prompt`, `queue-operation`
  thinking: 'prose',
  content: 'prose', // `message.content` blocks, and a pasted file's body
  prompt: 'prose', // a `queued_command`
  snippet: 'prose', // an `edited_text_file`
  filename: 'prose', // third-party names live in the paths a person types

  type: 'skip',
  subtype: 'skip',
  uuid: 'skip',
  parentUuid: 'skip',
  sessionId: 'skip',
  id: 'skip',
  tool_use_id: 'skip',
  timestamp: 'skip',
  cwd: 'skip',
  role: 'skip',
  model: 'skip',
  mode: 'skip',
  operation: 'skip',
  name: 'skip', // the tool NAME, `Edit`, not what it touched
  redacted: 'skip', // the placeholder BLOCK_DECISIONS emits in place of a body
  result_form: 'skip',
  // A tool's parameters are the one free text in the archive no reader is ever
  // shown. docs/limits.md states that gap with its measurement rather than
  // leaving it to be discovered, so it is DECLARED here, not omitted here.
  input: 'skip',

  // The four fields a scoring consumer reads, kept by PR #8. F204 caught every
  // one of them arriving undeclared, which is what that fixture is for: an
  // undeclared field falls to 'prose', so without these the reader would be
  // shown a token count and an enum as if they were sentences.
  //
  // All four are counts or enums and none is written by a person. `entrypoint`
  // is a launch mode, filtered to the interactive ones before it is emitted;
  // `usage` is token counts; `isCompactSummary` is a boolean; `toolStats` is
  // the added/removed line counts §4.1 reconstructs from structuredPatch.
  entrypoint: 'skip',
  usage: 'skip',
  isCompactSummary: 'skip',
  toolStats: 'skip',
});

export function newRetentionContext(rewriteUuid) {
  return {
    rewriteUuid,
    seenModes: new Set(),
    seenPrompts: new Set(),
    stats: {
      kept: 0,
      dropped: 0,
      userMessages: 0,
      assistantMessages: 0,
      images: 0,
      documents: 0,
      codeLinesCounted: 0,
      codeParamsDropped: 0,
      // Was `toolResultBytesOmitted`, which counted the middle of a truncated
      // result. Nothing is truncated now, so the honest counter is how many
      // results there were and how much they weighed.
      toolResults: 0,
      toolResultBytesDropped: 0,
      toolParamBytes: 0,
      // Calls, not bytes. `toolParamBytes` is already counted below and cannot
      // answer this: a run of parameterless calls weighs nothing, and a single
      // Write weighs more than a hundred Bash invocations. What a recipient
      // needs to know before building on an archive is whether it records any
      // DOING at all, and that is a count.
      toolUses: 0,
      // Of those, how many still carry the parameters that say WHAT the call
      // touched. `toolUses > 0` is not the same as a readable tool channel, and
      // a neighbouring project spent an evening on exactly that distinction: a
      // stripped export reported 125,034 calls of which 125,043 had lost their
      // command, so testing "are there calls" called the broken half healthy.
      // deident can produce that archive itself -- opencode's `tool` part is
      // shape-only and keeps every name with no arguments at all -- so the two
      // are counted apart and the archive manifest reports both.
      toolUsesWithArgs: 0,
      dedupedPrompts: 0,
      injectedBytesDropped: 0,
      deniedBlocks: 0,
      deniedBytes: 0,
      deniedPaths: 0,
    },
  };
}

/**
 * @returns {{keep: boolean, record: object|null}}
 * @throws {RefusalError} on an unknown type, sub-type or content block (I7)
 */
export function retainRecord(rec, ctx, where) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    throw unknown('a record that is not a JSON object', where, 'a non-object record');
  }

  // A harness whose records carry no top-level `type` is decided by its own
  // branch, not by this lookup: opencode puts the role on `info`, so asking
  // TOP_LEVEL about `undefined` refuses a healthy record and names a type that
  // does not exist. Routed before the lookup rather than inside it, so the
  // lookup keeps meaning exactly one thing.
  if (rec.type === undefined && rec.info !== null && typeof rec.info === 'object') {
    const out = retainOpencodeRecord(rec, ctx, where);
    if (out === null) return DROPPED;
    ctx.stats.kept += 1;
    return { keep: true, record: out };
  }

  const decision = TOP_LEVEL[rec.type];
  if (decision === undefined) throw unknown(`top-level record type "${rec.type}"`, where, `type ${rec.type}`, rec);
  if (decision !== 'keep') {
    ctx.stats.dropped += 1;
    return DROPPED;
  }

  const out = retainByType(rec, ctx, where);
  if (out === null) {
    ctx.stats.dropped += 1;
    return DROPPED;
  }
  ctx.stats.kept += 1;
  return { keep: true, record: out };
}

const DROPPED = Object.freeze({ keep: false, record: null });

/**
 * The fields of an opencode message's `info` that are kept.
 *
 * Named without the harness in it, and that is not a style choice: F244 forbids
 * every harness's env-var prefix anywhere under src/, comments included, and it
 * is deliberately total rather than clever. The first draft of THIS comment
 * named the string it was explaining and failed the check. It lives beside
 * retainOpencodeRecord, which is the only caller, so the context is there.
 *
 * An allowlist, not a denylist, so a field opencode adds later is dropped until
 * somebody decides it rather than shipped because nobody noticed. Measured over
 * 617 real sessions, `info` carries eighteen names; these are the ones that are
 * a fixed vocabulary or a number.
 *
 * `path` is NOT here and is the reason this is an allowlist: it is an object of
 * absolute directories on every one of the 15,091 assistant messages, and it
 * would have shipped silently under any "keep the envelope" rule.
 */
const MESSAGE_INFO_KEEP = Object.freeze(['role', 'modelID', 'providerID', 'mode', 'agent', 'variant', 'finish', 'model']);

/**
 * One opencode record, in opencode's own shape.
 *
 * Two shapes, told apart by what they carry rather than by a name: the file's
 * envelope, which the reader puts first and which states the session's one
 * directory, and a message, which is `{info, parts}` with the role on `info`.
 */
function retainOpencodeRecord(rec, ctx, where) {
  const info = rec.info;
  const role = typeof info.role === 'string' ? info.role : null;

  // The envelope. Its decision is recorded under `session` in the schema
  // rather than assumed here, so dropping it is a reviewed choice like every
  // other type and shows up in `deident types`.
  if (role === null) {
    const decision = TOP_LEVEL.session;
    if (decision === undefined) throw unknown('the opencode session envelope', where, 'session', rec);
    ctx.stats.dropped += 1;
    return null;
  }

  const decision = TOP_LEVEL[role];
  if (decision === undefined) throw unknown(`opencode message role "${role}"`, where, `role ${role}`, info);
  if (decision !== 'keep') {
    ctx.stats.dropped += 1;
    return null;
  }

  const parts = Array.isArray(rec.parts) ? retainOpencodeParts(rec.parts, ctx, where) : [];
  if (parts.length === 0) return null;

  const kept = {};
  for (const f of MESSAGE_INFO_KEEP) if (info[f] !== undefined) kept[f] = info[f];
  if (typeof info.id === 'string') kept.id = ctx.rewriteUuid(info.id);
  if (typeof info.sessionID === 'string') kept.sessionID = ctx.rewriteUuid(info.sessionID);
  if (typeof info.parentID === 'string') kept.parentID = ctx.rewriteUuid(info.parentID);
  const usage = retainUsage(info.tokens);
  if (usage !== null) kept.tokens = usage;

  if (role === 'user') ctx.stats.userMessages += 1;
  else ctx.stats.assistantMessages += 1;

  return prune({ info: kept, parts });
}

/** The parts of one opencode message, by the decision each part type carries. */
function retainOpencodeParts(parts, ctx, where) {
  const out = [];
  for (const part of parts) {
    if (part === null || typeof part !== 'object') continue;
    const name = part.type;
    if (typeof name !== 'string') throw unknown('an opencode part with no type', where, 'part', part);
    const decision = BLOCK_DECISIONS[name];
    if (decision === undefined) throw unknown(`opencode part type "${name}"`, where, `part ${name}`, part);
    if (decision === 'drop') continue;
    if (decision === 'keep') {
      out.push(part);
      continue;
    }
    if (decision === 'shape-only') {
      // The tool NAME survives, as it does on every other harness: "an Edit
      // happened" is scoring evidence and carries no path. `state` holds the
      // call's input AND its output, 22,354 of each measured, and both go.
      const bytes = payloadBytes(part.state);
      // BOTH counters, and the second is the one that was missing. `tool` is
      // one part carrying a call and its result, so it is a tool USE as well as
      // a tool result, and counting only the result made a 40-session archive
      // report "no tool calls" while shipping the name of every one of them.
      // The warning that said so is three commits old and was itself written
      // against two harnesses' shapes; this is the same defect one level in.
      ctx.stats.toolUses += 1;
      ctx.stats.toolResults += 1;
      ctx.stats.toolResultBytesDropped += bytes;
      out.push(prune({
        type: name,
        tool: typeof part.tool === 'string' ? part.tool : null,
        callID: typeof part.callID === 'string' ? ctx.rewriteUuid(part.callID) : null,
        status: typeof part.state?.status === 'string' ? part.state.status : null,
        result_bytes: bytes,
      }));
      continue;
    }
    throw unknown(`opencode part type "${name}" carries the decision "${decision}", which this reader does not apply`, where, `part ${name}`, part);
  }
  return out;
}



/**
 * The field that holds a call's ARGUMENTS, for the payloads Codex merged.
 *
 * `args-only` exists because Codex writes a call and its result into one
 * record, so neither `keep` nor `shape-only` says what the ruling asked for.
 * Which field is the call half is per-payload knowledge and lives here, beside
 * the code that acts on it, rather than in the schema, which decides POLICY and
 * should not also carry mechanics.
 *
 * F269 asserts every `args-only` name in every schema has an entry here, so the
 * two cannot drift: a decision with no field to act on would silently emit an
 * empty record and every check would stay green.
 */
const ARGS_FIELD = Object.freeze({
  // {server, tool, arguments}. The read-back channel reads `arguments` and has
  // never read `result`, which is 3,989 MB against 17.98 MB on the corpus that
  // forced this decision.
  mcp_tool_call_end: ['invocation'],
  // The command line and how it ended. `aggregated_output` is the 6.1 MB half
  // and is what this decision drops.
  exec_command_end: ['command', 'cwd', 'exit_code'],
  // The same three shapes in Codex's `item_completed` style, which is a
  // different spelling of the same merge and not a mapping onto the names
  // above: each is decided in the schema under its own name.
  CommandExecution: ['command', 'cwd', 'exit_code', 'parsed_cmd'],
  McpToolCall: ['server', 'tool', 'arguments'],
  Extension: ['kind', 'query'],
});

/**
 * Which of Codex's OWN payload names is a turn, and whose.
 *
 * NOT an alias table. Nothing is renamed and no record changes shape: a Codex
 * record leaves as a Codex record, and these two sets exist only so the
 * manifest's turn counters have something to count on this harness, the same
 * way `rec.type === 'user'` serves them on Claude Code. The codex schema's own
 * note is the rule being respected here -- "nothing here is derived from,
 * mapped onto, or named after another agent's vocabulary" -- and a reader who
 * wants the two harnesses unified is the one who gets to decide that.
 */
const CODEX_HUMAN = Object.freeze(new Set(['user_message']));
const CODEX_MACHINE = Object.freeze(new Set(['agent_message', 'task_complete']));

/** The manifest's two turn counters, for a payload that carries a turn. */
function countTurn(name, role, ctx) {
  if (CODEX_HUMAN.has(name) || (name === 'message' && role === 'user')) {
    ctx.stats.userMessages += 1;
    return;
  }
  if (CODEX_MACHINE.has(name) || name === 'message') ctx.stats.assistantMessages += 1;
}

/**
 * A Codex `message` payload without the blocks that are injected instruction
 * text. Nobody wrote them, so nothing authored is lost, and leaving them in
 * puts vendor boilerplate at the top of the file a person is asked to read.
 */
function withoutCodexWrappers(payload, ctx) {
  if (!Array.isArray(payload.content)) return payload;
  const kept = payload.content.filter((b) => {
    const t = b !== null && typeof b === 'object' && typeof b.text === 'string' ? b.text.trim() : null;
    if (t === null) return true;
    const injected = CODEX_INJECTED_PREFIXES.some((w) => t.startsWith(w));
    if (injected) ctx.stats.injectedBytesDropped += Buffer.byteLength(b.text, 'utf8');
    return !injected;
  });
  return kept.length === payload.content.length ? payload : { ...payload, content: kept };
}

/** Bytes a payload weighs, for the shape-only counter. */
function payloadBytes(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8');
  } catch {
    return 0;
  }
}

/**
 * One Codex line, retained in Codex's own shape.
 *
 * Nothing is translated: the record leaves as `{timestamp, type, payload}` with
 * the identities replaced, which is what the README promises for every harness.
 * The decision comes from the same `BLOCK_DECISIONS` table Claude Code's blocks
 * use, because the codex schema puts its payload vocabulary there.
 */
function retainCodexLine(rec, ctx, where) {
  const payload = rec.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw unknown(`a ${rec.type} whose payload is not an object`, where, `${rec.type} payload`, rec);
  }

  // `compacted` carries no payload.type of its own: it is a container whose
  // `replacement_history` holds records, and the schema's rationale says a
  // reader must descend into it or ship unredacted user text.
  if (rec.type === 'compacted') {
    // `replacement_history` holds PAYLOADS, not lines: measured on a real
    // rollout, its entries are `{type, id, role, content, ...}` with no
    // timestamp and no envelope. Handing them to retainRecord asked the
    // top-level table about a payload name and refused a healthy file by the
    // wrong table's name, which is worse than refusing: it sends the reader to
    // look for a record type that does not exist.
    const history = Array.isArray(payload.replacement_history) ? payload.replacement_history : [];
    const kept = [];
    for (const inner of history) {
      const out = retainCodexPayload(inner, ctx, where);
      if (out !== null) kept.push(out);
    }
    return prune({
      timestamp: quantise(rec.timestamp),
      type: rec.type,
      payload: { replacement_history: kept },
    });
  }

  const kept = retainCodexPayload(payload, ctx, where);
  if (kept === null) return null;
  return prune({ timestamp: quantise(rec.timestamp), type: rec.type, payload: kept });
}

/**
 * One Codex payload, by the decision its own schema records for it.
 *
 * Shared by the line reader and by `compacted`, which nests payloads rather
 * than lines. One implementation because two would disagree, and the one that
 * ships prose nobody reviewed would be the quiet one.
 */
function retainCodexPayload(payload, ctx, where) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw unknown('a Codex payload that is not an object', where, 'codex payload', payload);
  }
  const name = payload.type;
  if (typeof name !== 'string') {
    throw unknown('a Codex payload with no type', where, 'codex payload', payload);
  }
  const decision = BLOCK_DECISIONS[name];
  if (decision === undefined) throw unknown(`payload type "${name}"`, where, `payload ${name}`, payload);
  if (decision === 'drop') {
    ctx.stats.dropped += 1;
    return null;
  }

  // A container, like response_item one level up. Keeping the wrapper without
  // descending would carry the item whole and silently override the decision
  // its own name carries -- which for CommandExecution is 4.17 MB of stdout.
  if (name === 'item_completed') {
    const item = payload.item;
    if (item === undefined || item === null) return prune({ type: name });
    const inner = retainCodexPayload(item, ctx, where);
    return inner === null ? null : prune({ type: name, item: inner });
  }

  let out;
  if (decision === 'keep') {
    out = name === 'message' ? withoutCodexWrappers(payload, ctx) : payload;
  } else if (decision === 'shape-only') {
    const bytes = payloadBytes(payload);
    ctx.stats.toolResults += 1;
    ctx.stats.toolResultBytesDropped += bytes;
    out = prune({
      type: name,
      call_id: typeof payload.call_id === 'string' ? ctx.rewriteUuid(payload.call_id) : null,
      result_bytes: bytes,
    });
  } else if (decision === 'args-only') {
    const fields = ARGS_FIELD[name];
    if (fields === undefined) {
      throw unknown(`payload type "${name}" is args-only and no field is named for it`, where, `payload ${name}`, payload);
    }
    const args = {};
    for (const f of fields) if (payload[f] !== undefined) args[f] = payload[f];
    ctx.stats.toolResultBytesDropped += Math.max(0, payloadBytes(payload) - payloadBytes(args));
    ctx.stats.toolUses += 1;
    if (Object.keys(args).length > 0) ctx.stats.toolUsesWithArgs += 1;
    out = prune({
      type: name,
      call_id: typeof payload.call_id === 'string' ? ctx.rewriteUuid(payload.call_id) : null,
      ...args,
    });
  } else {
    // drop-counted has no Codex payload today; refusing beats guessing which
    // placeholder a reader would expect.
    throw unknown(`payload type "${name}" carries the decision "${decision}", which this reader does not apply`, where, `payload ${name}`, payload);
  }

  countTurn(name, payload.role, ctx);
  return out;
}



function retainByType(rec, ctx, where) {
  switch (rec.type) {
    case 'user':
    case 'assistant':
      return retainTurn(rec, ctx, where);
    case 'attachment':
      return retainAttachment(rec, ctx, where);
    case 'last-prompt':
      return retainPrompt(rec, ctx, 'last-prompt', rec.lastPrompt);
    case 'queue-operation':
      return retainPrompt(rec, ctx, 'queue-operation', rec.content, { operation: rec.operation ?? null });
    case 'mode':
      return retainMode(rec, ctx, where);
    case 'system':
      return retainSystem(rec, ctx, where);
    // Codex writes `{timestamp, type, payload}` and puts the real record in a
    // second type-tagged union inside `payload`. The line type says only which
    // union; contentBlocks decides what is in it, exactly as the codex schema's
    // own note describes. `compacted` is here because it NESTS records in
    // `replacement_history` and keeping the line without descending would ship
    // user prose no pass had read.
    case 'response_item':
    case 'event_msg':
    case 'compacted':
      return retainCodexLine(rec, ctx, where);

    default:
      throw unknown(`top-level record type "${rec.type}"`, where, null, rec);
  }
}

// ------------------------------------------------------------------- turns

/**
 * The eight interactive surface names, and nothing else.
 *
 * A consumer drops a whole session when `entrypoint` is present and not one of
 * these, and KEEPS it when the field is absent -- so passing an unknown value
 * through is the one option that can silently delete a session's worth of
 * scoring, while dropping the field is the safe direction. An allowlist rather
 * than a passthrough because the field is a free string in the input and this
 * table is what makes it non-identifying: eight fixed words, no user content.
 */
const INTERACTIVE_ENTRYPOINTS = Object.freeze([
  'cli', 'claude-desktop', 'claude-desktop-3p', 'claude-vscode',
  'claude_in_slack', 'remote_desktop', 'remote_mobile', 'ssh-remote',
]);

function retainEntrypoint(value) {
  return typeof value === 'string' && INTERACTIVE_ENTRYPOINTS.includes(value) ? value : null;
}

/**
 * Per-turn token counts: four non-negative integers, or nothing.
 *
 * BRIEF §3 keeps code and prose out; a token count is neither. `usage` also
 * carries `service_tier`, `server_tool_use` and whatever ships next, so this
 * is a whitelist of four names rather than a copy of the object -- the same
 * rule the top-level record follows, for the same reason.
 *
 * All-or-nothing on purpose: a consumer that reads three of the four and
 * defaults the fourth to 0 would report a wrong total as if it were measured,
 * which is §4.3's dangerous-zero failure in a different field. Absent is
 * honest, 0 is a claim.
 */
function retainUsage(usage) {
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : undefined);
  const input = int(usage.input_tokens);
  const output = int(usage.output_tokens);
  if (input === undefined || output === undefined) return null;
  // The cache pair is genuinely optional upstream; absent means zero, but a
  // PRESENT-and-malformed value is a broken record, not a zero.
  const create = usage.cache_creation_input_tokens === undefined ? 0 : int(usage.cache_creation_input_tokens);
  const read = usage.cache_read_input_tokens === undefined ? 0 : int(usage.cache_read_input_tokens);
  if (create === undefined || read === undefined) return null;
  return Object.freeze({
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: create,
    cache_read_input_tokens: read,
  });
}

function retainTurn(rec, ctx, where) {
  const msg = rec.message;
  const content = retainMessageContent(msg, ctx, where);

  // A turn whose every block was dropped carries nothing. Keep it only when it
  // still has content or a distilled result, an empty shell is noise that the
  // residual scan then has to walk.
  const distilled = 'toolUseResult' in rec ? retainToolUseResult(rec.toolUseResult) : null;
  if (content.length === 0 && distilled === null) return null;

  if (distilled !== null) {
    const d = distillToolResult(rec.toolUseResult);
    if (typeof d.code_added_lines === 'number') ctx.stats.codeLinesCounted += d.code_added_lines;
  }
  if (rec.type === 'user') ctx.stats.userMessages += 1;
  else ctx.stats.assistantMessages += 1;

  return prune({
    type: rec.type,
    uuid: ctx.rewriteUuid(rec.uuid),
    parentUuid: rec.parentUuid ? ctx.rewriteUuid(rec.parentUuid) : null,
    sessionId: ctx.rewriteUuid(rec.sessionId),
    timestamp: quantise(rec.timestamp),
    cwd: rec.cwd ?? null,
    isSidechain: rec.isSidechain === true ? true : null,
    isMeta: rec.isMeta === true ? true : null,
    // Three scoring fields, admitted deliberately and narrowly. Each is a
    // fixed vocabulary or an integer, so none can carry identity, and each is
    // read by a consumer that silently degrades without it rather than saying
    // so. See retainEntrypoint / retainUsage for what is NOT copied.
    entrypoint: retainEntrypoint(rec.entrypoint),
    isCompactSummary: rec.isCompactSummary === true ? true : null,
    message: {
      role: msg?.role ?? null,
      model: msg?.model ?? null,
      // Spread rather than `usage: retainUsage(...)`: prune() is shallow and
      // only reaches the outer object, so a null here would ship as
      // `"usage": null` on every turn that has none -- a key that says
      // "measured, and the answer is nothing" about a measurement that was
      // never taken. F216 caught exactly that.
      ...(retainUsage(msg?.usage) === null ? {} : { usage: retainUsage(msg?.usage) }),
      content,
    },
    toolUseResult: distilled,
  });
}

/**
 * `message.content` is a block array OR a plain string, and the string form was
 * silently dropped.
 *
 * Measured over all 225 depth-0 sessions: 3,323 `user` records carry
 * `message.content` as a string, 2,871,417 characters of user-typed prompt
 * text, none of them carrying a `toolUseResult`, so all 3,323 fell through to
 * `records.length === 0` and were counted as "dropped" beside `permission-mode`
 * and `ai-title`. 207 of the 225 files were affected, and two exported no user
 * prose at all.
 *
 * I7 does not fire on this, because the record type and the block types are all
 * known: it is the CONTAINER SHAPE that was unhandled, and an unhandled shape
 * fell through to a silent drop rather than a refusal. That is the one outcome
 * BRIEF §4.4's retention design forbids, so a third shape raises the same
 * refusal an unknown record type does.
 */
function retainMessageContent(msg, ctx, where) {
  const content = msg === null || typeof msg !== 'object' ? undefined : msg.content;
  return retainContent(content, ctx, where, 'message.content');
}

/**
 * The one dispatch. `message.content` is not the only field in the corpus that
 * holds this shape: a `queued_command` attachment's `prompt` holds the same
 * block array, and it used to be copied into the output verbatim, so
 * BLOCK_DECISIONS never saw it. Measured on a shipped archive: 13 base64
 * images, 2.7 MB, reached the recipient in full through that second path while
 * the identical blocks on the message path were replaced with a placeholder.
 *
 * That is the `document` bug again: two lists answering one question, one of
 * them maintained. There is one list now, and every caller reaches it here.
 */
function retainContent(content, ctx, where, what) {
  if (content === undefined || content === null) return [];
  if (Array.isArray(content)) return retainBlocks(content, ctx, where);
  if (typeof content === 'string') {
    return content.length === 0 ? [] : retainBlocks([{ type: 'text', text: content }], ctx, where);
  }
  throw unknown(`a ${what} that is neither an array nor a string (${typeof content})`, where);
}

function retainBlocks(blocks, ctx, where) {
  const out = [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    const decision = BLOCK_DECISIONS[block.type];
    if (decision === undefined) throw unknown(`content block type "${block.type}"`, where, `block ${block.type}`, block);
    if (decision === 'drop') continue;
    if (decision === 'drop-counted') {
      if (block.type === 'image') ctx.stats.images += 1;
      else ctx.stats.documents += 1;
      out.push({ type: block.type, redacted: 'replaced with a placeholder' });
      continue;
    }
    // `shape-only` and `keep` both route here; the difference is what
    // retainBlock emits, not whether it runs.
    //
    // It no longer takes `where`. That parameter existed so the one path that
    // could refuse (an unreviewed block nested inside a tool_result) could name
    // the file and line. Nothing under here refuses now, and a parameter
    // threaded through for a caller that is gone is the next thing to be
    // mistaken for a live one.
    const kept = retainBlock(block, ctx);
    if (kept !== null) out.push(kept);
  }
  return out;
}

function retainBlock(block, ctx) {
  switch (block.type) {
    case 'text': {
      if (typeof block.text !== 'string' || block.text.length === 0) return null;
      const { text } = stripAuthored(block.text, ctx);
      return text.length === 0 ? null : { type: 'text', text };
    }

    case 'thinking': {
      if (!KEEP_THINKING_BLOCKS) return null;
      if (typeof block.thinking !== 'string' || block.thinking.length === 0) return null;
      // Agent reasoning quotes the same paths prose does.
      return { type: 'thinking', thinking: stripDeniedPaths(block.thinking, ctx) };
    }

    case 'tool_use': {
      // What the tool was ASKED to touch. `Read`, `Edit`, `Write` and
      // `SendUserFile` all carry the path as a parameter, and every one of
      // them ran from an ordinary cwd while naming a deny-listed file. The
      // tool NAME survives, because "an Edit happened" is scoring evidence and
      // carries no path.
      // Counted before the deny check, because a denied call still happened and
      // its NAME still ships: the block below keeps `name` and redacts only the
      // parameters, for the reason stated right above. Counting after would
      // make an archive of nothing but denied calls look like an archive with
      // no tool use in it, which is the opposite of true.
      ctx.stats.toolUses += 1;
      // Counted only when the parameters actually leave. A denied call keeps
      // its NAME and loses its input, which is the readable-versus-present
      // distinction this pair exists for.
      const why = deniedToolUse(block.input);
      if (why === null && block.input !== null && typeof block.input === 'object'
        && Object.keys(block.input).length > 0) ctx.stats.toolUsesWithArgs += 1;
      if (why !== null) {
        ctx.stats.deniedBlocks += 1;
        const bytes = Buffer.byteLength(JSON.stringify(block.input ?? null), 'utf8');
        ctx.stats.deniedBytes += bytes;
        return {
          type: 'tool_use',
          id: ctx.rewriteUuid(block.id),
          name: block.name ?? null,
          input: { redacted: DENIED_MARKER(bytes, why) },
        };
      }
      const input = stripCodeParams(block.input, ctx);
      // Measured on the archive built from the live corpus after the
      // tool_result cut: parameters are 1.48 MB of a 9.08 MB archive, 16.3%,
      // and they are the ONLY free text in it that no reader is ever shown.
      // The remainder line quotes this figure, so it is counted rather than
      // estimated: without it that line can only report the whole non-prose
      // share, 70.4% of the archive, most of which is record scaffolding and
      // minted identifiers that cannot hold a name at all.
      ctx.stats.toolParamBytes += Buffer.byteLength(JSON.stringify(input ?? null), 'utf8');
      return {
        type: 'tool_use',
        id: ctx.rewriteUuid(block.id),
        name: block.name ?? null,
        input,
      };
    }

    // Shape without content, and this is the whole contract: which tool,
    // whether it failed, how much came back.
    //
    // Twenty holes were reproduced against the shipped code on 2026-08-25.
    // Sorted by where the BYTES came from rather than by which module missed
    // them, seventeen of the twenty were in machine output: percent-encoded
    // CJK, HTML character references, Python bytes-repr, base64, zero-width
    // characters, a gcloud token, the secret half of an AWS credential pair,
    // cloud account identifiers. A human does not type base64 of a colleague's
    // name into a prompt. A program emits it, and the only route program
    // output takes into the archive is a tool_result.
    //
    // And nobody reads this surface. Measured over 250 of the 4,228 files in
    // the live corpus: tool_result is 47.2% of the three content surfaces by
    // bytes, against 30.5% prose and 22.3% tool_use parameters. tier1.mjs
    // builds the candidates file from prose blocks alone, so no reader and no
    // semantic pass ever saw a byte of it, and every miss in it was therefore
    // invisible rather than merely undetected.
    //
    // The cut is not reversible and does not need to be: cutting when the
    // recipient needed it, they come back and ask; not cutting when there was
    // a leak, the bytes have left.
    case 'tool_result': {
      const bytes = toolResultBytes(block.content);
      ctx.stats.toolResults += 1;
      ctx.stats.toolResultBytesDropped += bytes;
      return prune({
        type: 'tool_result',
        // The tool NAME is not on this block and is not copied onto it. It is
        // on the tool_use block this id pairs with, the rewrite is
        // deterministic, and makeUuidRewriter exists to keep exactly that
        // pairing resolvable. A second copy would be a second thing to keep
        // in step.
        tool_use_id: ctx.rewriteUuid(block.tool_use_id),
        // BRIEF §6 open question 1: is_error is what failure_signal is most
        // likely counted from, and suppressing it would silently RAISE OVR.
        // It was preserved verbatim through truncation before and is
        // preserved verbatim through deletion now.
        is_error: block.is_error === true ? true : null,
        result_bytes: bytes,
      });
    }

    default:
      return null;
  }
}

/**
 * The first denied path named by any string in a tool's parameters, or null.
 * Keys as well as values: a file-history map is keyed by absolute filename.
 */
function deniedToolUse(input) {
  if (input === null || typeof input !== 'object') return deniedReason(input);
  for (const [k, v] of Object.entries(input)) {
    const why = deniedReason(k) ?? (typeof v === 'string' ? deniedReason(v) : deniedToolUse(v));
    if (why !== null) return why;
  }
  return null;
}

/** BRIEF §3: code content is never exported, only counted. */
function stripCodeParams(input, ctx) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input ?? null;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (CODE_VALUED_TOOL_PARAMS.includes(k)) {
      ctx.stats.codeParamsDropped += 1;
      out[k] = { redacted: 'code removed', lines: countLines(v), bytes: byteLength(v) };
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * ONE definition of a line, shared with toolresult.mjs.
 *
 * This used to be `split(NL).length` with no trailing-newline adjustment while
 * `lineCount` subtracted one and documented why, so the stripped Write
 * parameter reported one more line than `code_added_lines` for the same file:
 * 907 of 908 pairs in the corpus disagreed by exactly 1, one JSONL line apart
 * in the same export. A reader who picks the tool_use figure inflates every
 * Write by a line.
 */
function countLines(v) {
  if (typeof v === 'string') return lineCount(v);
  if (Array.isArray(v)) return v.reduce((a, x) => a + countLines(x?.new_string ?? x?.newString ?? ''), 0);
  return null;
}

function byteLength(v) {
  return typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : null;
}

/**
 * The one stripping order every kept string goes through.
 *
 * Injections first, because a `<system-reminder>` is nobody's text and taking
 * it out can empty the string outright. Then the deny-listed PATHS inside
 * prose, removed one token at a time rather than by withholding the turn: an
 * assistant paragraph naming `…/private/vendor-search/SCORECARD.md` is scoring
 * evidence with one token in it that must not ship. Then the whole-block
 * denial, which is coarser on purpose.
 *
 * There were three copies of this order and one of them, retainPrompt's, was
 * missing the first step entirely. One order, one place, so the next copy
 * cannot lose a step quietly.
 *
 * @returns {{text: string, denied: boolean}} the stripped text or a
 *   DENIED_MARKER, and '' when nothing authored is left
 */
function stripAuthored(raw, ctx) {
  const text = stripDeniedPaths(stripInjected(raw, ctx), ctx);
  if (text.length === 0) return { text: '', denied: false };
  const why = deniedTextReason(text);
  if (why === null) return { text, denied: false };
  const bytes = Buffer.byteLength(text, 'utf8');
  ctx.stats.deniedBlocks += 1;
  ctx.stats.deniedBytes += bytes;
  return { text: DENIED_MARKER(bytes, why), denied: true };
}

/** The LABEL of the first DENIED_TEXT pattern this prose trips, or null. */
export function deniedTextReason(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  // Same lists as deniedReason at the sibling below. These two diverged and this
  // one gated user and assistant PROSE with the shipped patterns only, so a
  // per-person pattern withheld a tool result and not the sentence beside it.
  //
  // A label, never `m[0]`: the return value of this function IS the reason a
  // DENIED_MARKER ships, so a match returned here is the withheld value handed
  // straight to the recipient. See DENIED_PATH_REASON's comment, which reached
  // that conclusion for the path half of the same question.
  for (const { re, reason } of DENIED_TEXT) {
    re.lastIndex = 0;
    if (re.test(text)) return reason;
  }
  return userDenyReason(text);
}

/** Per-person rules, kept apart because they all collapse to one label. */
function userDenyReason(text) {
  for (const re of userDenyPatterns()) {
    re.lastIndex = 0;
    if (re.test(text)) return USER_DENY_REASON;
  }
  return null;
}

/**
 * Is this token a path with a deny-listed SEGMENT?
 *
 * Segment-wise rather than DENIED_PATH_RE's leading-separator test, because
 * the caller already knows the token is a path: `private/vendor-search/x.md` has
 * no leading separator and is exactly the form that appears in prose.
 */
export function deniedPathToken(token) {
  for (const segment of token.split(/[\\\/]+/)) {
    if (segment !== '' && matchesDenySegment(segment)) return true;
  }
  return false;
}

function matchesDenySegment(segment) {
  const lower = segment.toLowerCase();
  return [...DENY_SEGMENT_TOKENS, ...userDenyTokens()].some((t) => lower.includes(t));
}

// Generic only. Per-person tokens arrive from beside the salt (userdeny.mjs).
const DENY_SEGMENT_TOKENS = Object.freeze(['private', 'identity', 'payroll']);

/** Replace every deny-listed path token in prose, counting what went. */
function stripDeniedPaths(text, ctx) {
  if (!/[\\\/]/.test(text)) return text;
  PATH_TOKEN_RE.lastIndex = 0;
  return text.replace(PATH_TOKEN_RE, (token) => {
    if (!deniedPathToken(token)) return token;
    ctx.stats.deniedPaths += 1;
    ctx.stats.deniedBytes += Buffer.byteLength(token, 'utf8');
    return DENIED_PATH_MARKER;
  });
}

/** The LABEL of the first deny pattern this text trips, shipped first, or null. */
export function deniedReason(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  for (const { re, reason } of DENIED_CONTENT) {
    re.lastIndex = 0;
    if (re.test(text)) return reason;
  }
  const mine = userDenyReason(text);
  if (mine !== null) return mine;
  // The deny-list applied to the cwd only, so a Read, an Edit or a directory
  // listing of a deny-listed path from an ALLOWED directory was invisible to
  // all three levels of privacy-tiers §4. The reason is generic on purpose:
  // one of the deny tokens is a person's name and this string ships.
  if (DENIED_PATH_RE.test(text) || DENIED_PATH_HEAD_RE.test(text)) return DENIED_PATH_REASON;
  return null;
}

/**
 * Remove the harness's own injected spans from authored text.
 *
 * These carry the owner's memory index and local command output into sessions
 * that never mentioned either, and nobody wrote them, so nothing authored is
 * lost. Counted so the manifest can say how much went.
 */
function stripInjected(text, ctx) {
  let out = text;
  for (const re of INJECTED_SPANS) {
    re.lastIndex = 0;
    out = out.replace(re, '');
  }
  if (out.length !== text.length) {
    ctx.stats.injectedBytesDropped += Buffer.byteLength(text, 'utf8') - Buffer.byteLength(out, 'utf8');
  }
  return out.trim();
}

/**
 * Bytes of text a tool returned, which is all that is kept of it.
 *
 * The payload the model read, not the JSON envelope around it: a consumer
 * comparing a 40 KB Read against a 200 B one is comparing what came back, and
 * counting the wrapper would make two identical results differ by their block
 * shape.
 *
 * Every shape is measured rather than refused, and that is a deliberate
 * relaxation of I7. The old path flattened this text in order to KEEP it, so
 * an unhandled nested block type was a silent drop of user text and a refusal
 * was the right answer; three types reached that refusal in production
 * (tool_reference, a nested document, an embedded PDF) and each one blocked a
 * whole export. Nothing is kept now, so an unrecognised shape can only change
 * a byte count. Refusing an export over that is docs/limits.md's cry-wolf
 * failure, and I7 still holds where it earns its keep: at the top level, and
 * on block types, where the text really would be kept.
 */
function toolResultBytes(content) {
  if (content === null || content === undefined) return 0;
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (!Array.isArray(content)) return Buffer.byteLength(JSON.stringify(content), 'utf8');
  let bytes = 0;
  for (const b of content) {
    if (typeof b === 'string') bytes += Buffer.byteLength(b, 'utf8');
    else if (b !== null && typeof b === 'object' && typeof b.text === 'string') {
      bytes += Buffer.byteLength(b.text, 'utf8');
    } else if (b !== null && b !== undefined) {
      // An image, a document, a tool_reference, or whatever ships next. Its
      // size is the only thing about it that can be stated honestly.
      bytes += Buffer.byteLength(JSON.stringify(b), 'utf8');
    }
  }
  return bytes;
}

// ------------------------------------------------------------- attachments

function retainAttachment(rec, ctx, where) {
  const att = rec.attachment;
  const subtype = att && typeof att === 'object' ? att.type : undefined;
  if (subtype === undefined) throw unknown('an attachment with no sub-type', where);
  if (ATTACHMENT_DROP.includes(subtype)) return null;
  if (!ATTACHMENT_KEEP.includes(subtype)) {
    throw unknown(`attachment sub-type "${subtype}"`, where, `attachment ${subtype}`, att);
  }

  // An attachment names the file it came from, so the denial is exact here.
  //
  // `deniedReason` returns null for anything that is not a string, so this
  // gate USED to skip a payload silently the moment it arrived as a block
  // array rather than as text: a base64 image body, a credential and a harness
  // injection all walked past a check that was looking at `undefined`.
  // `attachmentText` is what makes the gate see a real string either way.
  const named = att.filename ?? att.file?.filePath ?? null;
  const raw = att.snippet ?? att.content ?? att.file?.content;
  const payload = attachmentText(raw);
  const why = deniedReason(named) ?? deniedReason(payload);
  if (why !== null) {
    ctx.stats.deniedBlocks += 1;
    ctx.stats.deniedBytes += Buffer.byteLength(payload, 'utf8');
    return null;
  }

  // Every arm reaches the ONE dispatch.
  //
  // `prompt` was routed through `retainContent` and these two were not, so a
  // pasted document and an edited file's snippet were copied into the output
  // verbatim: BLOCK_DECISIONS never saw them, `image` was never counted, the
  // `document` placeholder was never emitted, `stripInjected` never ran and
  // `deniedTextReason` never ran. Reproduced end to end through the real CLI:
  // exit 0, every check green, and a manifest printing `0 images` and `0
  // harness injections` over an archive holding a base64 image body, a
  // credential and a `<system-reminder>` span. It fires 58 times in this
  // author's own live corpus.
  //
  // README promises "Dropped: all images, all pasted documents, all code
  // content" and docs/limits.md promises injected spans are stripped whatever
  // they are called. Those are promises to a stranger, so this was not a
  // disclosed limit.
  //
  // The container is unwrapped here rather than inside `retainContent`: the
  // dispatch takes the block array or the string, never the box one arrives
  // in.
  //
  // Which box, measured over all 3,567 session files on this machine rather
  // than guessed: every one of the 58 `file` attachments is
  // `att.content.file.content`, a string, beside a `filePath` and a line
  // count. `att.file.content` does not occur at all and is kept only because
  // `att.file.filePath` above it does. `edited_text_file` is a plain string
  // 322 times out of 322, and `queued_command` is a string 486 times against
  // 21 block arrays. So the block-array form is real, the string form is the
  // common one, and the wrapper is the shape that actually ships a pasted
  // file. Every arm unwraps, because an arm that does not is how this bug
  // arrives the fifth time; a fourth shape refuses by name.
  //
  // An empty block list is the same nothing an absent payload was, and the
  // all-null test below is what drops the record. Keep it reachable.
  const body =
    subtype === 'queued_command'
      ? { prompt: nullIfEmpty(retainContent(unwrap(att.prompt), ctx, where, 'queued_command prompt')) }
      : subtype === 'edited_text_file'
        ? {
            filename: att.filename ?? null,
            snippet: nullIfEmpty(retainContent(unwrap(att.snippet), ctx, where, 'edited_text_file snippet')),
          }
        : {
            filename: named,
            content: nullIfEmpty(retainContent(unwrap(raw), ctx, where, 'file attachment content')),
          };

  if (Object.values(body).every((v) => v === null)) return null;

  return prune({
    type: 'attachment',
    uuid: ctx.rewriteUuid(rec.uuid),
    sessionId: ctx.rewriteUuid(rec.sessionId),
    timestamp: quantise(rec.timestamp),
    cwd: rec.cwd ?? null,
    attachment: { type: subtype, ...body },
  });
}

const nullIfEmpty = (blocks) => (blocks.length === 0 ? null : blocks);

/**
 * The block array or string inside the box a pasted file arrives in.
 *
 * One level, and only when the box is not itself a payload: a string has no
 * `.file`, and neither does a block array, so both fall through untouched and
 * a shape that is none of the three reaches `retainContent` to be refused by
 * name rather than unwrapped on a guess.
 */
function unwrap(value) {
  if (value === null || typeof value !== 'object') return value;
  const inner = value.file?.content;
  if (inner !== undefined) return inner;

  // The fourth shape, and it is not a text file. A pasted PDF arrives as
  // `{type:'pdf', file:{filePath, base64, originalSize}}`: same box as the
  // string form above, but the payload is a base64 body and there is no
  // `.content` at all, so the line above returned the box and retainContent
  // refused it by name -- "a file attachment content that is neither an array
  // nor a string (object)". Measured: one 206 KB PDF, 274,964 base64
  // characters, and the export stopped on it.
  //
  // Refusing is the wrong answer because deident already HAS a reviewed
  // decision for this exact payload: `document: 'drop-counted'`, which is what
  // README means by "Dropped: all pasted documents". The bytes are a document
  // whichever box they arrive in. So the box is converted to the block the
  // dispatch already knows, and F207's counted-not-shipped guarantee covers it
  // without a second code path to keep in step.
  //
  // A box with neither `.content` nor `.base64` still refuses: a shape nobody
  // has looked at is not a shape to guess at.
  const base64 = value.file?.base64;
  if (typeof base64 === 'string') {
    const kind = typeof value.type === 'string' ? value.type : 'document';
    return [{
      type: 'document',
      source: { type: 'base64', media_type: kind === 'pdf' ? 'application/pdf' : 'application/octet-stream', data: base64 },
    }];
  }
  return value;
}

/**
 * An attachment payload as one string for the deny gate to read.
 *
 * Every string leaf joined, rather than JSON.stringify: a Windows path inside
 * a block would arrive at DENIED_PATH_RE with its separators doubled, and the
 * byte count the manifest reports would be the count of the JSON envelope
 * rather than of the text that was withheld.
 */
function attachmentText(value) {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return '';
  const parts = [];
  const walk = (v) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(value);
  return parts.join(String.fromCharCode(10));
}

// ------------------------------------------- prompts carried outside message

/**
 * BRIEF §4.4 and PLAN C2/C3. `queue-operation` carries user text that appears
 * nowhere else 70.3% of the time; `last-prompt` 32.2% of the time. Both are
 * kept, and deduped against each other within a session (C3) so the overlap
 * does not double-count the Framing axis.
 */
function retainPrompt(rec, ctx, kind, rawPrompt, extra = {}) {
  if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) return null;
  // These carry user prose, so they carry everything prose carries, and they
  // were the one keep-path with no denial check at all. Measured on a real
  // export: `private/payroll-ledger/backfill-payload…` and
  // `.gitignore:8:/private/` survived here after every other route had been
  // closed. The path goes and the prompt stays: §C3 keeps this class precisely
  // because it carries text found nowhere else.
  //
  // What they also carry is the harness's own injections, which this path
  // stripped on the message side and shipped whole here, with
  // injectedBytesDropped reading 0 for every one of them.
  const { text, denied } = stripAuthored(rawPrompt, ctx);
  // A prompt that was nothing but an injection is nothing anybody authored.
  if (text.length === 0) return null;
  if (denied) {
    return prune({
      type: kind,
      uuid: rec.uuid ? ctx.rewriteUuid(rec.uuid) : null,
      sessionId: ctx.rewriteUuid(rec.sessionId),
      timestamp: quantise(rec.timestamp),
      cwd: rec.cwd ?? null,
      text,
      ...extra,
    });
  }
  // Keyed on the WHOLE text, not a 120-character prefix.
  //
  // PLAN C2/C3 justify this dedupe by the overlap between `last-prompt` and
  // `queue-operation`, where the texts are IDENTICAL. A prefix key is strictly
  // weaker than that justification requires, and the difference is not
  // theoretical: measured over all 225 sessions, 108 of 2,759 distinct prompts
  // (77,734 characters) were destroyed because they shared a boilerplate
  // opening, inter-session relay messages that all begin with the same fixed
  // envelope. That is the C3 evidence class being thrown away by the very step
  // meant to protect it.
  const key = text;
  if (ctx.seenPrompts.has(key)) {
    ctx.stats.dedupedPrompts += 1;
    return null;
  }
  ctx.seenPrompts.add(key);
  return prune({
    type: kind,
    uuid: rec.uuid ? ctx.rewriteUuid(rec.uuid) : null,
    sessionId: ctx.rewriteUuid(rec.sessionId),
    timestamp: quantise(rec.timestamp),
    cwd: rec.cwd ?? null,
    text,
    ...extra,
  });
}

/**
 * The last deliberate fail-open in this table, and a high-frequency one:
 * 7,400 `mode` records in the live corpus.
 *
 * This read `typeof rec.mode === 'string' ? rec.mode : JSON.stringify(...)`,
 * so a non-string skipped every guarantee in this file at once. Constructed
 * against the shipped code, a `mode` holding an object came out as one string
 * carrying a deny-listed path, a memory filename, an intact
 * `<system-reminder>` span and a credential shape, with deniedBlocks 0,
 * deniedBytes 0, deniedPaths 0, injectedBytesDropped 0, and no refusal.
 *
 * Every mode in this corpus is a string, and that is a fact about one harness,
 * not a guarantee: retainContent already refuses on a container that is
 * neither array nor string, for the same reason (BRIEF §4.4).
 */
function retainMode(rec, ctx, where) {
  if (typeof rec.mode !== 'string') {
    throw unknown(`a mode record whose mode is not a string (${typeof rec.mode})`, where, 'a non-string mode');
  }
  const { text: value } = stripAuthored(rec.mode, ctx);
  if (value.length === 0) return null;
  if (ctx.seenModes.has(value)) return null;
  ctx.seenModes.add(value);
  return prune({ type: 'mode', sessionId: ctx.rewriteUuid(rec.sessionId), mode: value });
}

function retainSystem(rec, ctx, where) {
  const subtype = rec.subtype ?? null;
  if (subtype === null) throw unknown('a system record with no subtype', where);
  if (SYSTEM_DROP.includes(subtype)) return null;
  if (!SYSTEM_KEEP.includes(subtype)) throw unknown(`system subtype "${subtype}"`, where, `system ${subtype}`, rec);
  return prune({
    type: 'system',
    subtype,
    uuid: rec.uuid ? ctx.rewriteUuid(rec.uuid) : null,
    sessionId: ctx.rewriteUuid(rec.sessionId),
    timestamp: quantise(rec.timestamp),
  });
}

// ------------------------------------------------------------------ shared

const UUID_IN_TEXT = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * Rewrite every UUID inside retained STRINGS, not only in uuid-shaped fields.
 *
 * §F5: account UUIDs match no detector, not path-shaped, not name-shaped, not
 * high-entropy-secret-shaped, so the residual scan is seeded with "any UUID
 * that is not a known message or session uuid". Measured on this corpus, ~10k
 * UUIDs appear inside tool output and prose (agent ids, scratchpad paths,
 * session references). If those are left alone, I5 can never pass and the gate
 * is permanently red, which is the §F7 failure mode again.
 *
 * Rewriting them deterministically costs nothing: a UUID carries no scoring
 * value, correlation between occurrences survives, and every UUID in the
 * output is then one deident minted, which is exactly what makes I5 a real
 * check rather than a wish.
 */
export function rewriteUuidsInRecord(value, rewriteUuid) {
  if (typeof value === 'string') {
    if (!value.includes('-')) return value;
    UUID_IN_TEXT.lastIndex = 0;
    return value.replace(UUID_IN_TEXT, (u) => rewriteUuid(u) ?? u);
  }
  if (Array.isArray(value)) return value.map((v) => rewriteUuidsInRecord(v, rewriteUuid));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[rewriteUuidsInRecord(k, rewriteUuid)] = rewriteUuidsInRecord(v, rewriteUuid);
    }
    return out;
  }
  return value;
}

/** §F4: millisecond stamps fingerprint the device. Quantise to the minute. */
export function quantise(timestamp) {
  if (typeof timestamp !== 'string') return null;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return null;
  return new Date(Math.floor(ms / TIMESTAMP_QUANTUM_MS) * TIMESTAMP_QUANTUM_MS)
    .toISOString()
    .replace(/\.000Z$/, 'Z');
}

/** Drop null-valued keys so the export does not carry empty scaffolding. */
function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The FIELD NAMES of the record that could not be decided, and nothing else.
 *
 * Deciding a new type means knowing whether it carries user text, and the
 * names of its fields answer that: `content` and `text` mean it might,
 * `totalCostUSD` and `accountUuid` mean it does not. Without them the person
 * hitting this refusal has to send their session log to whoever maintains the
 * tool, which is the one thing this tool exists to avoid.
 *
 * Twelve types refused in one colleague's corpus and three of them existed
 * here, so three could be decided from real records and nine could not. That
 * asymmetry is what this prints its way out of.
 *
 * Names only, never values. A field name is structure; a value is the content
 * the refusal is protecting. The list is what goes in an issue.
 */
function fieldNames(shape) {
  if (shape === null || typeof shape !== 'object') return [];
  const keys = Object.keys(shape);
  if (keys.length === 0) return [];
  return [`  its fields, names only: ${keys.join(', ')}`, ''];
}

function unknown(what, where, kind = null, shape = null) {
  return new RefusalError(`deident has never seen ${what}`, {
    why: [
      where ? `  ${where.file}  line ${where.line}` : '',
      '',
      ...fieldNames(shape),
      'deident refuses to guess whether a record it has never seen carries user',
      'text. Every type in the export has an explicit, reviewed decision, and a',
      'silent drop is how the highest-value user turns get lost (BRIEF §4.4).',
    ].filter((l) => l !== ''),
    remedies: [
      { label: 'Unblock this export now', command: 'deident export --skip-unknown-types' },
      { label: 'Then report the type and its fields', command: 'file an issue against deident' },
      { label: 'Or export an older copy of the logs', command: 'deident export --root <older copy>' },
    ],
    // `unknown` names the class the escape hatch counts. Claude Code ships a
    // new record type every few weeks (§F4 records 2.1.215 -> 2.1.238 inside
    // one corpus), so refusal stays the default without being terminal: one
    // such line in one session of one teammate used to block that person's
    // whole export, with "export older logs" as the only remedy offered.
    detail: { ...(where ?? {}), unknown: kind ?? what },
  });
}

/**
 * The decisions as data, for the reports that show them.
 *
 * A `let` with a live binding rather than a frozen const, because the table is
 * rebuilt when `useAgentSchema` points the retention at a different harness. As
 * a frozen const it captured Claude Code's vocabulary at import time and kept it
 * whatever `--agent` said, which is what made every Codex record read UNKNOWN.
 */
export let RETENTION_TABLE = buildTable();

function buildTable() {
  return Object.freeze({
    topLevel: TOP_LEVEL,
    attachmentKeep: ATTACHMENT_KEEP,
    attachmentDrop: ATTACHMENT_DROP,
    systemKeep: SYSTEM_KEEP,
    systemDrop: SYSTEM_DROP,
    blocks: BLOCK_DECISIONS,
    proseFields: PROSE_FIELDS,
  });
}
