// The credential gap, closed by something that maintains a detector list.
//
// docs/limits.md states it plainly: "a credential with no listed vendor prefix
// and no label beside it is not detected". The shipped list is hand-written and
// prefix-anchored, so it finds `sk-ant-…` and `ghp_…` and misses a Mailgun key
// or a Postgres URL with the password in it. Measured against this module's own
// canaries, both of those are found here and neither is found by the shipped
// patterns.
//
// Two properties make this usable as a GATE rather than a report:
//
//   No network. `--no-verification` is passed unconditionally and is not
//   configurable, so no candidate secret is ever sent to a vendor to be checked.
//   That is what keeps BRIEF §2's "no network calls, ever" true. Verification is
//   the whole reason trufflehog would otherwise talk to the internet.
//
//   No false positives to cry wolf with. Measured on the archive shipped
//   2026-08-27, 41 entries and 4.5 MB: zero findings, 7.4 seconds. The shapes
//   that would have been the risk are deident's OWN output, and none of them
//   trip it: a pseudonym like `PERSON_15490515`, a rewritten uuid, and an md5
//   were all planted together and none was flagged. §F7 says a check that cries
//   wolf is the first one switched off, so this was measured before it was
//   allowed to refuse.
//
// Optional, and LOUDLY optional. If the binary is absent the export runs exactly
// as it did before, and the limits block says the scan did not run. A gate whose
// absence is silent is worse than no gate: "0 secrets" then reads as "scanned
// and clean" to the person deciding whether to send the file.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The binary, if it is anywhere the operator would have put it. */
export const SCANNER = 'trufflehog';

/**
 * Run the scan over the entries that are about to ship.
 *
 * Takes the entries rather than a path so the subject is the same bytes every
 * other check sees, and writes them to a temp directory because the scanner
 * takes a filesystem. The directory is removed in a finally.
 *
 * @returns {{ran: boolean, why: string|null, findings: Array, seconds: number}}
 */
export function scanForSecrets(entries, options = {}) {
  const bin = options.bin ?? SCANNER;
  const run = options.run ?? defaultRun;

  let dir = null;
  const started = Date.now();
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deident-scan-'));
    for (const e of entries) {
      // Entry names carry slashes; flatten rather than recreate the tree, since
      // the scanner reads bytes and the name is reported back for attribution.
      fs.writeFileSync(path.join(dir, e.name.replace(/[\\/]/g, '_')), e.data, 'utf8');
    }
    const out = run(bin, dir);
    if (out === null) {
      return { ran: false, why: `${bin} is not on PATH`, findings: [], seconds: 0 };
    }
    const findings = [];
    for (const line of out.split('\n')) {
      if (line.trim().length === 0) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (!j.DetectorName) continue;
      findings.push(
        Object.freeze({
          detector: j.DetectorName,
          entry: String(j.SourceMetadata?.Data?.Filesystem?.file ?? '').split(/[\\/]/).pop() ?? '',
          // BRIEF §4.7: a refusal that prints the raw string leaks the very
          // thing it is guarding. Enough to find it, never enough to use it.
          excerpt: `${String(j.Raw ?? '').slice(0, 12)}…`,
        }),
      );
    }
    return { ran: true, why: null, findings: Object.freeze(findings), seconds: (Date.now() - started) / 1000 };
  } catch (err) {
    // A scanner that fell over is NOT a clean scan, and must not be reported as
    // one. It is reported as not having run, with the reason.
    return { ran: false, why: `${bin} failed: ${String(err.message ?? err).slice(0, 120)}`, findings: [], seconds: 0 };
  } finally {
    if (dir !== null) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // The archive is already written; a leftover temp directory is not a
        // reason to fail the export, and it holds only bytes that shipped.
      }
    }
  }
}

function defaultRun(bin, dir) {
  try {
    return execFileSync(
      bin,
      // --no-verification is not optional and not configurable: it is what
      // keeps the no-network promise. --no-update stops it phoning home for a
      // release check, which is the other place it would reach the internet.
      ['filesystem', dir, '--no-verification', '--no-update', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // trufflehog exits non-zero on findings under some flag combinations, and
    // its stdout is still the answer.
    if (typeof err.stdout === 'string' && err.stdout.length > 0) return err.stdout;
    throw err;
  }
}

/** The line the limits block prints, whether or not the scan ran. */
export function secretScanLine(result) {
  if (!result.ran) {
    return `secret scan did NOT run: ${result.why}. The credential row above means "none of the shapes deident knows", and nothing more.`;
  }
  const n = result.findings.length;
  return `secret scan: ${SCANNER} over the shipped entries, ${n} finding${n === 1 ? '' : 's'}`;
}
