#!/usr/bin/env node
//
// Merge a branch's test/selftest.mjs into the current one, at the granularity
// the file actually has.
//
//   node tools/merge-fixtures.mjs <branch>
//
// WHY THIS EXISTS. Two branches that both add fixtures append them at the same
// anchor, and git aligns their trailing `  }],` lines. A line-level union then
// splices one fixture's body into another's and produces a file that will not
// parse. That happened four times in one day, and each time the hand-fix went
// wrong in a new way, so the fixes are written down here instead of relearned.
//
// FOUR THINGS IT KNOWS, each one learned from a specific failure:
//
//   1. A FIXTURE IS THE UNIT, not a line. Blocks are cut whole, from `['Fn',`
//      to the matching `  }],`.
//
//   2. WHICH SIDE IS THE BASE MATTERS. A branch that changes a LAYOUT edits many
//      existing fixtures and adds few; a branch that adds a COMMAND mostly adds.
//      Taking the wrong side whole silently drops the other's edits and the
//      suite fails on paths that moved. So both sides' edit counts are counted
//      and the busier one becomes the base.
//
//   3. THE HELPER SECTION IS NOT A FIXTURE. Everything above `const FIXTURES = [`
//      is invisible to a fixture-granular pass. A branch that changes what an
//      export REQUIRES adds a helper there for its fixtures to call; dropping it
//      failed every fixture that ran a real export, eight re-applied and five
//      still red. It is three-way merged with git's own merge-file.
//
//   4. WHAT IT WILL NOT DO. If both sides changed the same fixture, it names it
//      and leaves it. If both changed the helper section in ways merge-file
//      cannot reconcile, it says so and leaves the markers. Guessing there is
//      how an assertion quietly stops asserting.
//
// It does not commit, does not resolve src/, and does not run the suite. Run
// `node deident.js --selftest` yourself afterwards: this is the mechanical half,
// and a fixture that only fails where two branches MEET is the half a person
// still has to think about.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BRANCH = process.argv[2];
if (!BRANCH) {
  console.error('usage: node tools/merge-fixtures.mjs <branch>');
  process.exit(2);
}

// The repository this script lives in, so it works from any checkout rather
// than from the one it was written in.
const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SUITE = path.join(REPO, 'test', 'selftest.mjs');
const g = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 128e6 });

const MARK = 'const FIXTURES = [';
const idsOf = (s) => [...s.matchAll(/\['(F\d+[a-z]?)',/g)].map((m) => m[1]);
const cut = (src, id) => {
  const at = src.indexOf(`['${id}',`);
  if (at === -1) return null;
  const ls = src.lastIndexOf('\n', at) + 1;
  const term = '\n  }],\n';
  const e = src.indexOf(term, at);
  return e === -1 ? null : src.slice(ls, e + term.length);
};

const base = g('merge-base', 'HEAD', BRANCH).trim();
const B = g('show', `${base}:test/selftest.mjs`);
const OURS = g('show', 'HEAD:test/selftest.mjs');
const THEIRS = g('show', `${BRANCH}:test/selftest.mjs`);

const baseIds = idsOf(B);
const editCount = (side) =>
  baseIds.filter((id) => {
    const b = cut(B, id);
    const s = cut(side, id);
    return b !== null && s !== null && b !== s;
  }).length;
const addedIn = (side) => idsOf(side).filter((id) => !baseIds.includes(id));

const oursEdits = editCount(OURS);
const theirsEdits = editCount(THEIRS);
const takeTheirs = theirsEdits > oursEdits;
const keep = takeTheirs ? THEIRS : OURS;
const move = takeTheirs ? OURS : THEIRS;
console.log(`edits: HEAD ${oursEdits}, ${BRANCH} ${theirsEdits}  ->  base is ${takeTheirs ? BRANCH : 'HEAD'}`);

let out = keep;

// The helper section, three-way merged. Nine separate added runs is what made
// hand-splicing this a bad idea.
{
  const head = (x) => x.slice(0, x.indexOf(MARK));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-fixtures-'));
  const w = (n, s) => {
    const p = path.join(dir, n);
    fs.writeFileSync(p, s);
    return p;
  };
  const po = w('ours', head(out));
  const pb = w('base', head(B));
  const pt = w('theirs', head(move));
  try {
    execFileSync('git', ['merge-file', '-L', 'kept', '-L', 'base', '-L', 'moved', po, pb, pt], { stdio: 'pipe' });
  } catch {
    // Non-zero is the conflict count, not a failure to run.
  }
  const merged = fs.readFileSync(po, 'utf8');
  const marks = (merged.match(/^<<<<<<< /gm) ?? []).length;
  out = merged + out.slice(out.indexOf(MARK));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(
    marks === 0
      ? '  helper section merged cleanly'
      : `  helper section has ${marks} conflict${marks === 1 ? '' : 's'} LEFT IN THE FILE: resolve by hand`,
  );
}

// The moved side's NEW fixtures, renumbered above everything already present.
let next = Math.max(...idsOf(out).map((x) => Number(x.slice(1))).filter(Number.isFinite)) + 1;
const renamed = [];
let blocks = '';
for (const id of addedIn(move)) {
  const block = cut(move, id);
  if (block === null) continue;
  const to = `F${next}`;
  next += 1;
  renamed.push(`${id}->${to}`);
  blocks += '\n' + block.replace(`['${id}',`, `['${to}',`);
}

// The moved side's edits to EXISTING fixtures, where the kept side left them
// alone. Both touching one is a real conflict, named rather than guessed at.
let applied = 0;
const clash = [];
for (const id of baseIds) {
  const b = cut(B, id);
  const m = cut(move, id);
  const k = cut(out, id);
  if (b === null || m === null || k === null || m === b) continue;
  if (k !== b) {
    clash.push(id);
    continue;
  }
  out = out.replace(k, m);
  applied += 1;
}

const anchor = '\n];\n\nexport function selftest()';
if (!out.includes(anchor)) throw new Error('tail anchor missing: has the FIXTURES array moved?');
out = out.replace(anchor, blocks + anchor);

// Imports from the moved side that name a binding the kept side does not
// already have.
//
// Matching whole LINES is not enough, in both directions. Two `output/zip.mjs`
// lines where one is a superset of the other differ as strings and must not
// both survive; and an import the kept side DELETED differs from nothing at all
// and must not come back. The second is the dangerous one: running this against
// an already-merged branch re-added `checkAddedLines`, which had been deleted
// that morning, and nothing about the line said it was stale.
//
// So the test is per binding, and a line is taken only if it introduces one.
const alreadyBound = new Set();
for (const l of out.split('\n')) {
  const m = l.startsWith('import ') ? l.match(/^import \{([^}]*)\} from/) : null;
  if (m) for (const nm of m[1].split(',').map((x) => x.trim()).filter(Boolean)) alreadyBound.add(nm);
}
// And "not already bound" is still not the test. A binding the kept side
// DELETED is also not bound, so that rule re-added `checkAddedLines` on a
// branch where it had been deleted that morning. The question an import has to
// answer is whether anything in the merged file USES it, so that is what is
// asked: a name nothing references is not carried over, whether it is new or a
// revenant.
const body = out.slice(out.indexOf(MARK));
const need = move.split('\n').filter((l) => {
  if (!l.startsWith('import ')) return false;
  const m = l.match(/^import \{([^}]*)\} from/);
  if (!m) return !out.includes(l);
  const names = m[1].split(',').map((x) => x.trim()).filter(Boolean);
  const wanted = names.filter((nm) => !alreadyBound.has(nm) && new RegExp(`\\b${nm}\\b`).test(body));
  return wanted.length > 0;
});
if (need.length > 0) {
  const li = out.lastIndexOf('\nimport ');
  const at = out.indexOf('\n', li + 1);
  out = out.slice(0, at + 1) + need.join('\n') + '\n' + out.slice(at + 1);
}
const lines = out.split('\n');
const bound = new Set();
const drop = [];
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].startsWith('import ') ? lines[i].match(/^import \{([^}]*)\} from/) : null;
  if (!m) continue;
  const names = m[1].split(',').map((x) => x.trim()).filter(Boolean);
  if (names.every((nm) => bound.has(nm))) {
    drop.push(i);
    continue;
  }
  for (const nm of names) bound.add(nm);
}
for (const i of drop.reverse()) lines.splice(i, 1);
out = lines.join('\n');

fs.writeFileSync(SUITE, out);

const ids = idsOf(out);
const dup = [...new Set(ids.filter((v, i, a) => a.indexOf(v) !== i))];

// F199 asserts the README count, so it is set here rather than left to fail.
const rp = path.join(REPO, 'README.md');
fs.writeFileSync(
  rp,
  g('show', `${takeTheirs ? BRANCH : 'HEAD'}:README.md`).replace(/\d+ fixtures/, `${ids.length} fixtures`),
);

console.log(`  moved: ${renamed.join(' ') || 'none'}`);
console.log(`  existing fixtures re-applied: ${applied}`);
if (clash.length > 0) console.log(`  BOTH SIDES CHANGED, look at these: ${clash.join(' ')}`);
console.log(`  imports +${need.length} -${drop.length}`);
console.log(`  fixtures ${ids.length}${dup.length ? `, DUPLICATES ${dup.join(' ')}` : ''}`);
console.log('\nNow run: node deident.js --selftest');
