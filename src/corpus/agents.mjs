// Which harness wrote these logs. One module per agent, answering exactly two
// questions -- given a root, which files are sessions; given a file, what are
// its records and what is its cwd -- so nothing downstream has to know which
// agent is in play.
//
// NO AGENT HAS A DEFAULT PATH EXCEPT CLAUDE CODE, AND THAT IS THE POINT.
//
// Claude Code's default is known because it was read on a real installation of
// it. There is no Codex, Cursor, opencode or Gemini CLI installed on this
// machine, so a hardcoded dot-directory under the home folder would be a guess
// wearing the clothes of a fact, and the first person whose install differs
// gets a refusal naming a directory that was never theirs. `--root` already
// carries the operator's own knowledge of where their logs are, and it is the
// only way in.
//
// F244 asserts that by scanning src/ for those directory names, and it does not
// know a comment from a line of code, deliberately: the check stays total, and
// the cost is that this file cannot spell out the paths it is refusing to use.
//
// Nothing here maps one harness onto another. There is no shared record
// vocabulary and no normalised output shape: deident emits every record in its
// own harness's shape with identities replaced, and the downstream consumer
// decides what to make of it.

import { RefusalError } from '../cli/errors.mjs';
import * as claudeCode from './agents/claude-code.mjs';
import * as codex from './agents/codex.mjs';
import * as cursor from './agents/cursor.mjs';
import * as opencode from './agents/opencode.mjs';
import * as geminiCli from './agents/gemini-cli.mjs';

export const DEFAULT_AGENT = 'claude-code';

const AGENTS = Object.freeze({
  [claudeCode.id]: claudeCode,
  [codex.id]: codex,
  [cursor.id]: cursor,
  [opencode.id]: opencode,
  [geminiCli.id]: geminiCli,
});

export const AGENT_IDS = Object.freeze(Object.keys(AGENTS));

/**
 * @param {string|null} name  the value of --agent, or null for the default
 * @returns {object} the agent module
 */
export function selectAgent(name) {
  const wanted = name === null || name === undefined ? DEFAULT_AGENT : name;
  const agent = AGENTS[wanted];
  if (agent === undefined) {
    throw new RefusalError(`unknown agent "${wanted}"`, {
      why: [`deident reads: ${AGENT_IDS.join(', ')}.`],
      remedies: [{ label: 'Name one of them', command: `deident scan --agent ${AGENT_IDS.join('|')} --root <path>` }],
    });
  }
  return agent;
}

/**
 * The refusal for an agent whose logs never state a working directory.
 *
 * deident's entry gate is default-deny by WORKSPACE, and a workspace is a
 * directory a person worked in. With no cwd on any record every session of the
 * corpus collapses into the single `<no-cwd>` row, and one typed word against
 * that row would admit the whole harness in one go. That is the gate defeated,
 * not the gate answered, so the run stops here instead.
 *
 * The other route -- reading a directory out of a tool ARGUMENT, or off a
 * project hash -- is inventing a cwd to get past the gate, and it tiers a
 * session on a path that merely appeared in it. Not done.
 */
export function noCwdRefusal(agent) {
  return new RefusalError(`${agent.label} sessions do not record a working directory`, {
    why: [
      'deident admits material one workspace at a time, and a workspace is the',
      'directory a session worked in. Nothing in this format states one, so every',
      'session would land in a single "<no-cwd>" row and one typed word would',
      'admit the whole corpus at once.',
      '',
      'There is no flag that supplies it: the value does not exist in the logs,',
      'so deident would have to invent it, and a tier decided on an invented',
      'directory is not a decision the operator made.',
      '',
      `deident can read ${agent.label} files; it cannot tier them.`,
    ],
    remedies: [
      { label: 'List the record shapes without exporting', command: `deident types --agent ${agent.id} --root <path>` },
      { label: 'Or export a harness that states a cwd', command: 'deident export --agent codex --root <path>' },
    ],
    detail: { agent: agent.id },
  });
}

/**
 * The refusal for an agent deident can READ but has no retention branch for.
 *
 * Raised at the same early point as the cwd refusal and for the same reason: a
 * person should learn in the first second, not after a scan, a review and a
 * semantic pass, and not from a message about a record type that is a symptom.
 *
 * Before this existed, the answer was whatever the retention table happened to
 * say when a foreign record reached it. For Codex that was a refusal naming
 * `event_msg`, which is a real type and not the problem. For opencode it is
 * worse: its record types are `user` and `assistant`, the same names Claude
 * Code uses, so its records are judged by another harness's vocabulary and the
 * failure has no name at all.
 */
export function noRetentionRefusal(agent) {
  return new RefusalError(`deident can read ${agent.label} sessions but cannot export them yet`, {
    why: [
      `Every record type in an export needs a reviewed decision, and ${agent.label} has`,
      'a reader and a schema but no code that applies them to its own record shape.',
      '',
      'This is stated here rather than discovered three stages later. Running the',
      'export anyway would stop at whatever the retention table said about a record',
      'it was never written for, which names a symptom and not this.',
      '',
      `deident can scan, list and count ${agent.label} sessions today.`,
    ],
    remedies: [
      { label: 'List the record shapes it would have to decide', command: `deident types --agent ${agent.id} --root <path>` },
      { label: 'Ask for the path to be built', command: 'file an issue against deident' },
    ],
    detail: { agent: agent.id },
  });
}

/** The agents deident can read but not export, by id. */
export function noRetentionAgents() {
  return AGENT_IDS.filter((name) => AGENTS[name].retains !== true);
}

/** The refusal for an agent that has no default path and was given no --root. */
export function rootRequiredRefusal(agent) {
  return new RefusalError(`--root is required for ${agent.label}`, {
    why: [
      `deident has no default location for ${agent.label} sessions, and does not guess one.`,
      'Claude Code has a default because its layout was read on a real installation;',
      `no ${agent.label} installation has been read, so any path here would be a guess`,
      'that refuses at the wrong directory for the first person whose install differs.',
      '',
      `deident will read ${agent.layout}.`,
    ],
    remedies: [
      { label: 'Name the directory', command: `deident scan --agent ${agent.id} --root <path to your sessions>` },
    ],
    detail: { agent: agent.id },
  });
}

/** The agents whose logs state no working directory, by id. */
export function noCwdAgents() {
  return AGENT_IDS.filter((name) => AGENTS[name].cwdSource === null);
}
