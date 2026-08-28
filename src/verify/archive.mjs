// What is IN the archive, asked of the finished file.
//
// Every other check in this tool answers "did the substitution I performed come
// out right". That is a question about the pipeline, and it is answerable only
// by the pipeline, which is why all six gates were green on two archives that
// leaked. Both leaks were found the same way: somebody opened the shipped bytes
// and looked for something they already held.
//
// A teammate did exactly that, saw his own details, and concluded the tool does
// nothing. Opening the file and looking is the only honest verification there
// is, and until now it required writing a throwaway script. The scripts that
// found both leaks lived in a temp directory on one machine.
//
// So this reads the zip and reports what is still in it. It shares no code with
// the export path on purpose: a checker that reuses the substituter's own index
// agrees with the substituter by construction, and that agreement is what the
// residue gate already provides. Here the needles come from the operator's own
// files and from shapes, never from the entity table the export built.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readZipFile } from '../output/zip.mjs';
import { loadKnownValues } from '../policy/knownvalues.mjs';

/** Machine output leaves shapes behind that prose does not. */
const SHAPES = Object.freeze([
  ['zero-width characters', /[​-‏﻿]/g],
  ['backslash-u escapes', /\\u[0-9a-fA-F]{4}/g],
  ['percent-encoded bytes', /%[0-9a-fA-F]{2}/g],
  ['base64 runs of 40 or more', /[A-Za-z0-9+/]{40,}={0,2}/g],
]);

/**
 * Service identifiers with a shape.
 *
 * README's limits name this class already: "ids from a service deident does not
 * sweep: a board, document or channel id". It is disclosed rather than swept,
 * and disclosure is not the same as the operator knowing it is in THIS file.
 * Measured on the archive shipped 2026-08-27: 10 Notion page ids survived.
 */
const SERVICE_IDS = Object.freeze([
  ['Notion page id', /app\.notion\.com\/p\/[A-Za-z0-9-]{20,}/g],
  ['Google Docs id', /docs\.google\.com\/[a-z]+\/d\/[A-Za-z0-9_-]{20,}/g],
  ['Google Drive file id', /drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{20,}/g],
  ['Google Classroom id', /classroom\.google\.com\/[a-z]\/[A-Za-z0-9_-]{10,}/g],
  ['Google Classroom invite code', /[?&]cjc=[A-Za-z0-9]+/g],
  ['Google Meet code', /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/g],
  ['Slack archive link', /slack\.com\/archives\/[A-Z0-9]{6,}/g],
  ['Figma file id', /figma\.com\/(?:file|design)\/[A-Za-z0-9]{10,}/g],
  ['Linear issue link', /linear\.app\/[A-Za-z0-9-]+\/issue\/[A-Z]+-\d+/g],
]);

/**
 * Read the archive and answer four questions about the bytes in it.
 *
 * @param {string} zipPath
 * @param {object} opts  {saltDir, extraNeedles}
 */
export function verifyArchive(zipPath, opts = {}) {
  const entries = readZipFile(zipPath);
  // Entry NAMES are part of what ships: F38 exists because a uuid rode out in
  // one, so they are searched alongside the bodies.
  const all = entries.map((e) => `${e.name}\n${e.data}`).join('\n');

  return Object.freeze({
    entries: entries.length,
    bytes: all.length,
    declared: declaredValues(all, opts.saltDir),
    machineName: machineNames(all),
    serviceIds: countAll(all, SERVICE_IDS),
    shapes: countAll(all, SHAPES),
    extra: countLiterals(all, opts.extraNeedles ?? []),
  });
}

/**
 * The operator's own declared values, searched for exhaustively.
 *
 * This is the check that found the 21-field leak, and it is the one the
 * substituter cannot perform on itself: these values reach the entity table
 * only because a person typed them into a file, so a bug that loses the file
 * loses the check too unless the check re-reads it from disk.
 */
function declaredValues(all, saltDir) {
  const dir = saltDir ?? path.join(os.homedir(), '.deident-private');
  let known;
  try {
    known = loadKnownValues(dir);
  } catch {
    return { available: false, why: 'known-values.json could not be read', total: 0, hits: [] };
  }
  // loadKnownValues returns the ARRAY, already validated and frozen: each
  // element is {value, kind}. It returns an empty array when the file is
  // absent, which is the case this whole command exists for.
  const values = Array.isArray(known) ? known : [];
  if (values.length === 0) {
    return { available: false, why: 'nothing is declared in known-values.json', total: 0, hits: [] };
  }
  const hits = [];
  for (const v of values) {
    const needle = v?.value;
    if (typeof needle !== 'string' || needle.length === 0) continue;
    const n = all.split(needle).length - 1;
    // The value itself is NEVER printed. It is the operator's own and they have
    // it; what they do not have is the count, and printing it back would put a
    // declared identity in a terminal, a log and possibly a pasted issue.
    if (n > 0) hits.push({ kind: v.kind, chars: needle.length, count: n });
  }
  return { available: true, why: null, total: values.length, hits: Object.freeze(hits) };
}

/**
 * Forms of the OS account name that a word boundary cannot catch.
 *
 * The substituter declines a match that abuts a letter or a digit, which is
 * §4.5 and is deliberate. `soph` inside `sophie-branch` is left alone by that
 * rule and is still the account name, so it is counted here rather than
 * assumed away.
 */
function machineNames(all) {
  const user = path.basename(os.homedir());
  if (typeof user !== 'string' || user.length < 3) return { user: null, glued: [] };
  const re = new RegExp(`[A-Za-z0-9_.-]*${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Za-z0-9_.-]*`, 'gi');
  return { user, glued: Object.freeze([...new Set(all.match(re) ?? [])].slice(0, 12)) };
}

function countAll(all, table) {
  const out = [];
  for (const [label, re] of table) {
    const m = all.match(re) ?? [];
    if (m.length > 0) out.push({ label, count: m.length, example: String(m[0]).slice(0, 60) });
  }
  return Object.freeze(out);
}

function countLiterals(all, needles) {
  const out = [];
  for (const n of needles) {
    if (typeof n !== 'string' || n.length === 0) continue;
    const c = all.split(n).length - 1;
    if (c > 0) out.push({ needle: n, count: c });
  }
  return Object.freeze(out);
}
