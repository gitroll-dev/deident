// Resolve the session-storage root from the environment and hand enumeration to
// the agent that knows the layout. BRIEF §4.9: never parse a slug. BRIEF §4.10:
// Claude Code is depth-0 only, a recursive glob ships 2.2x the payload with zero
// extra human turns; see src/corpus/agents.mjs for what the other readers walk
// and why none of them has a default path.

import path from 'node:path';
import os from 'node:os';
import { RefusalError } from '../cli/errors.mjs';
import { probeCaseFolding, setCaseFolding } from './cwdtrack.mjs';
import { selectAgent, rootRequiredRefusal, AGENT_IDS, noCwdAgents } from './agents.mjs';

/**
 * Resolve `<root>/projects`. Order: explicit --root, then CLAUDE_CONFIG_DIR
 * (official), then ~/.claude. CLAUDE_CODE_PROJECT_DIR_NAME is read only to
 * report which subdirectory a live session would be writing into; it never
 * becomes a parse target (§4.9).
 */
/**
 * The home directory, or null. NEVER throws.
 *
 * `os.homedir()` throws `uv_os_homedir returned ENOENT` when HOME and
 * USERPROFILE are both empty, and it was called unguarded from resolveRoot and
 * from defaultSaltDir, so `HOME= USERPROFILE= deident scan` printed
 * `internal error … This is a bug in deident, not a problem with your data`
 * and told the user to file an issue about their own environment. It is an
 * environment, it has a remedy, and the remedy is a flag.
 */
export function homeDir(env = process.env) {
  for (const name of ['HOME', 'USERPROFILE']) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  // Present but blank is a deliberate "no home", and it is exactly the state
  // that makes os.homedir() throw. Absent from the object is not: fall back.
  if (env && ('HOME' in env || 'USERPROFILE' in env)) return null;
  try {
    const home = os.homedir();
    return typeof home === 'string' && home.trim() !== '' ? home : null;
  } catch {
    return null;
  }
}

/** The refusal for "there is no home directory and you did not name a path". */
export function noHomeRefusal(what, flag) {
  return new RefusalError(`no home directory, so deident cannot find ${what}`, {
    why: [
      'HOME and USERPROFILE are both empty or unset, so there is no default path.',
      'This is the environment deident was started in, not a problem with your data.',
    ],
    remedies: [
      { label: 'Name the path', command: `deident scan ${flag} <path>` },
      // Was `HOME=<path>`, which is a bash assignment and a PowerShell parse
      // error ("the term 'HOME=/tmp/x' is not recognized as the name of a
      // cmdlet"). PowerShell is the default shell on the machines this ships
      // to, and cli-ux §8 makes the remedy the contract for getting unstuck,
      // so a remedy that cannot be run is worse than none: the person believes
      // they typed the fix and it did not work. Shell-neutral prose rather
      // than a platform test, because the string has to be correct to READ
      // everywhere, and the flag above is the answer that needs no shell at
      // all. If a dual-form remedy is ever wanted here, F111 will flag the
      // PowerShell half's `$env:` and the rule is what needs revisiting.
      { label: 'Or set HOME first', command: 'set HOME to a real directory in your shell, then run deident again' },
    ],
  });
}

export function resolveRoot(env, override = null, agent = selectAgent(null)) {
  // Every harness but Claude Code has no default and no environment variable
  // to fall back on, because neither was read on a real installation of it.
  // `--root` or nothing (agents.mjs states why at length).
  if (!agent.hasDefaultRoot) {
    const named = nonBlank(override);
    if (named === null) throw rootRequiredRefusal(agent);
    const dir = path.resolve(named);
    return Object.freeze({
      configDir: dir,
      sessionsDir: path.resolve(agent.sessionsDir(dir)),
      currentProjectDirName: null,
      source: '--root',
    });
  }

  // `??` does not treat '' as absent, and `path.resolve('')` is the current
  // directory, so a shell profile that exports CLAUDE_CONFIG_DIR
  // unconditionally would silently point deident at the cwd, and scan whatever
  // `projects/` happens to sit there. An empty or whitespace-only value is not
  // a setting; it falls through to the default.
  const fromEnv = nonBlank(env.CLAUDE_CONFIG_DIR);
  const home = homeDir(env);
  if (nonBlank(override) === null && fromEnv === null && home === null) {
    throw noHomeRefusal('your session storage', '--root');
  }
  const configDir = nonBlank(override) ?? fromEnv ?? path.join(home, '.claude');
  return Object.freeze({
    configDir: path.resolve(configDir),
    sessionsDir: path.resolve(agent.sessionsDir(configDir)),
    // The name it has always had. `sessionsDir` is the same directory for
    // Claude Code and is what the enumeration now reads, so the two cannot
    // drift; this one stays because it is what the refusals and the fixtures
    // print, and a renamed field in a refusal is a refusal nobody recognises.
    projectsDir: path.resolve(configDir, 'projects'),
    currentProjectDirName: nonBlank(env.CLAUDE_CODE_PROJECT_DIR_NAME),
    source: nonBlank(override) ? '--root' : fromEnv ? 'CLAUDE_CONFIG_DIR' : 'the default ~/.claude',
  });
}

/**
 * A string value, or null when it is absent OR blank.
 *
 * Exported because `??` is wrong for every environment variable this tool
 * reads and the rule had been written out here and then not propagated: the
 * MCP seeder in entities/seed.mjs used `??`, so an unconditionally-exported
 * empty CLAUDE_CONFIG_DIR made `path.join('', 'settings.json')` a relative
 * path read against the cwd.
 */
export function nonBlank(v) {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Enumerate the session files of one harness. WHICH files those are is the
 * agent's answer, not this function's: Claude Code walks `<root>/projects/<dir>`
 * at depth 0 and nothing deeper (§4.10), every other reader walks the root the
 * operator named. See agents.mjs for why only one of them has a default.
 *
 * @param {string|null} agentName  the value of --agent, or null for Claude Code
 * @returns {Readonly<{root, agent, workspaceDirs: object[], files: object[], bytes: number}>}
 */
export function resolveCorpus(env, override = null, agentName = null) {
  const agent = selectAgent(agentName);
  const root = resolveRoot(env, override, agent);

  let enumerated;
  try {
    enumerated = agent.enumerate(root.sessionsDir);
  } catch (err) {
    if (err instanceof RefusalError) throw err;
    throw new RefusalError(`no session storage at ${root.sessionsDir}`, {
      why: [
        err.code === 'ENOENT'
          ? 'That directory does not exist, so there is nothing to export.'
          : `The directory could not be read (${err.code}).`,
        `The root was resolved from ${root.source}, reading ${agent.label} sessions.`,
        '',
        // The skill installs in more than one harness, so somebody arrives here
        // with the wrong harness selected. This used to say Codex and Cursor
        // "are not read yet, so no value of --root reaches them", which is no
        // longer true of any of them. What is true is which layout each reader
        // walks, and that --agent is what chooses between them.
        `With --agent ${agent.id}, deident only reads: ${agent.layout}`,
        ...otherAgentLines(agent),
      ],
      remedies: [
        ...(agent.hasDefaultRoot
          ? [
              { label: 'Point at a Claude Code root', command: 'deident scan --root <path to .claude>' },
              { label: 'Or name it in the environment', command: 'deident scan   # honours CLAUDE_CONFIG_DIR' },
            ]
          : [{ label: `Point at your ${agent.label} sessions`, command: `deident scan --agent ${agent.id} --root <path>` }]),
        ...(AGENT_IDS.length > 1
          ? [{ label: 'Or name another harness', command: `deident scan --agent <${AGENT_IDS.join('|')}> --root <path>` }]
          : []),
      ],
    });
  }

  // Ask the filesystem whether it folds case, once, before any cwd is
  // normalised. Guessing from process.platform is wrong on Linux and on a
  // case-sensitive macOS volume, and guessing WRONG merges two real
  // directories into one workspace row carrying one tier. A probe that cannot
  // answer leaves the per-platform default in place rather than inventing one.
  const folds = probeCaseFolding(root.sessionsDir);
  if (folds !== null) setCaseFolding(folds);

  const { workspaceDirs, files, bytes } = enumerated;

  return Object.freeze({
    root,
    agent,
    workspaceDirs: Object.freeze(workspaceDirs),
    files: Object.freeze(files),
    bytes,
  });
}

/**
 * What ELSE deident can be pointed at, for the refusal above.
 *
 * Empty while deident reads one harness, and F106 is the reason the line above
 * says "only reads" on its own: a refusal that offers --root again, having just
 * failed on --root, without stating its scope, turns a scope limit into a dead
 * end.
 */
function otherAgentLines(agent) {
  const others = AGENT_IDS.filter((name) => name !== agent.id);
  if (others.length === 0) return [];
  const stateless = noCwdAgents();
  const lines = [
    '',
    `deident also reads: ${others.join(', ')}.`,
    'Each is selected with --agent and, except for claude-code, each needs',
    '--root: there is no installation of them on the machine deident was',
    'built on, so it has no default location to offer and does not guess one.',
  ];
  // Naming the ones that read but cannot export, here, where somebody is
  // already looking for which harness to reach for. Finding out after a scan
  // that the harness they chose can never be tiered is a worse place to learn it.
  if (stateless.length > 0) {
    lines.push(
      '',
      `Reading is not exporting: ${stateless.join(' and ')} state no working`,
      'directory anywhere in their logs, so their sessions can be listed and',
      'parsed but never admitted, because the admission is per directory.',
    );
  }
  return lines;
}

/** "2026-05-02 → 2026-08-22" over file mtimes, or null when there are none. */
export function corpusDateRange(files) {
  if (files.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of files) {
    if (f.mtimeMs < lo) lo = f.mtimeMs;
    if (f.mtimeMs > hi) hi = f.mtimeMs;
  }
  const d = (ms) => new Date(ms).toISOString().slice(0, 10);
  return `${d(lo)} → ${d(hi)}`;
}
