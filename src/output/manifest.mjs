// The one file in the archive that is not a session, and why it is there.
//
// WHAT IT FIXES. An archive held nothing but `sessions/`, so a recipient could
// not tell a complete export from a gutted one. Every count deident produces --
// what it read, what it kept, what it refused to decide and therefore dropped --
// was printed to the donor's terminal and written to `WHAT-TO-SEND.txt`, and
// both stay on the donor's machine. The information existed and did not cross.
//
// Measured the day this was written: a donor's export carried 2,478
// `patch_apply_end` records and ZERO `item_completed`, while his raw logs held
// 172 of the latter. The shell channel he was scored on was inside them. He had
// passed `--skip-unknown-types` on a deident that did not yet read that shape,
// the export finished green, and the count of what went was on his screen and
// nowhere else. Two people then spent an evening reconstructing from the
// surviving records what one line in the archive would have said.
//
// WHY IT IS SAFE TO SHIP, since everything else deident writes beside the zip
// is deliberately un-sendable. This carries record TYPE NAMES and integers. A
// type name is the harness's vocabulary, not the person's text: `item_completed`
// says nothing about who wrote it or what they wrote. `review.md` stays behind
// because it holds real paths; `export-map.txt` because it holds real session
// ids; this holds neither, and the alternative is the recipient guessing.
//
// WHAT IT DELIBERATELY DOES NOT CARRY: any count that varies with content, any
// path, any id, any spelling. If a future field cannot be named without naming
// something of the person's, it does not belong here.

/** The archive entry this is written to. */
export const MANIFEST_ENTRY = 'deident-manifest.json';

/**
 * @param {object} manifest  the run's own manifest, as buildManifest made it
 * @param {object} agent     the harness module that read the corpus
 * @param {string} version   deident's version
 * @returns {{name: string, body: string}}
 */
export function archiveManifest(manifest, agent, version) {
  const s = manifest ?? {};
  const undecided = (s.unknownTypes ?? []).map((u) => ({ type: u.type, records: u.count }));
  const body = {
    tool: 'deident',
    version,
    harness: agent?.id ?? null,
    sessions: s.sessions ?? null,
    workspaces: s.workspaces ?? null,
    userMessages: s.userMessages ?? null,
    // TWO numbers, not one, and the pair is the point.
    //
    // "Are there tool calls" is not "is the tool channel readable". A
    // neighbouring project spent an evening on that distinction: a stripped
    // export reported 125,034 calls of which 125,043 had lost their command, so
    // a `> 0` test called the broken half healthy. deident can produce that
    // archive itself -- opencode's `tool` part is shape-only and keeps every
    // name with no arguments -- so a recipient gets both and can tell.
    toolCalls: s.toolUses ?? null,
    toolCallsWithArguments: s.toolUsesWithArgs ?? null,
    // The line this file exists for. Empty means every record type in the
    // corpus had a reviewed decision; non-empty means these types were seen and
    // dropped without one, and the count is how many records went with them.
    undecidedTypesDropped: undecided,
    // Stated even when the list is empty, because "we checked and there were
    // none" and "nobody checked" are different facts and an absent key reads as
    // the second.
    undecidedTypesChecked: true,
  };
  return { name: MANIFEST_ENTRY, body: `${JSON.stringify(body, null, 2)}\n` };
}
