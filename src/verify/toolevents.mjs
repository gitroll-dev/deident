// Whether the archive records any DOING, said before it leaves the machine.
//
// WHY THIS IS A GATE AND NOT A STATISTIC. An archive with no tool calls is a
// chat transcript: it records what a person said and nothing about what they
// did. Downstream that is indistinguishable from a corpus whose reader did not
// understand the harness, because both arrive as the same zero, and by then the
// raw logs are on somebody else's machine and the question cannot be settled.
// Measured over a seven-donor intake elsewhere, three corpora read as zero and
// only one was actually missing anything; the other two were a reader counting
// one harness's vocabulary against another's. This machine is the last place
// the difference is cheap.
//
// WHY IT REPORTS RATHER THAN REFUSES. Zero is a legitimate export.
// docs/privacy-tiers.md defines `count-only` as "No text, no tool calls, no
// paths", so an export whose included workspaces are all count-only has exactly
// this shape and is correct. Refusing would make that tier unusable, and §F7
// holds: the check that refuses a correct export is the check that gets
// bypassed. It hands the reading to the person and names both possibilities.

/**
 * The note for an export that carries no tool calls, or null when it carries
 * some.
 *
 * `sessions` is asked for so an empty run says nothing: a preview or a run that
 * retained nothing has its own refusal, and a second line about tool calls
 * there is noise on top of a message that already explains itself.
 *
 * @param {number} toolUses  tool_use blocks retained across the whole archive
 * @param {number} sessions  sessions the archive actually contains
 * @returns {{warning: string, lines: string[]}|null}
 */
export function toolUseNote(toolUses, sessions) {
  if (sessions <= 0) return null;
  if (toolUses > 0) return null;
  return Object.freeze({
    warning:
      'this archive records no tool calls, so nothing in it says what was DONE, only what was said',
    lines: Object.freeze([
      'This archive records NO tool calls across all sessions.',
      'Expected if every included workspace is count-only. Otherwise the logs',
      'were collected by something that dropped them, and re-zipping will not',
      'bring them back: the collection has to change and be run again.',
    ]),
  });
}
