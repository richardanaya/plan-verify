/**
 * Minimal edits for lint findings.
 * A conflict prefers a narrower WHEN or IF, then dropping one always-true
 * SHALL, then a new guard, then dropping one requirement in the set.
 * A vacuous requirement is rewritten so its trigger can be true, or removed.
 * A completeness gap gets one new requirement built from declared names.
 * Each edit is checked on its own, and the whole set is checked together.
 */

import { firstUnsatDrivers, independentGroups, satisfiable } from "./decide.ts";
import { parseProperty, parseSpec } from "./ears.ts";
import { findVacuous, lintSpec, type Conflict, type LintReport, type Vacuous } from "./lint.ts";
import { type Repair } from "./repair.ts";
import { isDriver, requirementMentions, type Requirement, type Spec, type SymbolDecl, type Term } from "./spec.ts";
import { bestGap, conflictKeysMatched, conflictingSets } from "./solver.ts";
import { termsEqual } from "./term.ts";
import { formatInt } from "./text.ts";

export interface Proposal {
  id: string;
  kind: string;
  before: string;
  after: string;
  cleared: string[];
  because: string[];
  note: string;
}

export type PlanResult =
  | { kind: "plan"; proposals: Proposal[]; edited: string; applicable: boolean }
  | { kind: "error"; message: string };

interface Edit {
  op: string;
  id: string;
  sentence: string;
  conflictKey: string;
  vacuousId: string;
  gapName: string;
  proposal: Proposal;
}

export function repairedPath(specPath: string): string {
  const suffix = ".ears.md";
  if (specPath.length >= suffix.length && specPath.slice(specPath.length - suffix.length) === suffix) {
    return specPath.slice(0, specPath.length - suffix.length) + ".repaired.ears.md";
  }
  return specPath + ".repaired.ears.md";
}

export function planRepairs(spec: Spec, source: string): PlanResult {
  const outcome = lintSpec(spec);
  if (outcome.kind === "error") return { kind: "error", message: outcome.message };
  const report = outcome.report;
  const originalKeys = conflictKeyList(spec, report);
  const originalVacuous = vacuousIds(report.vacuous);
  const small = spec.requirements.length <= 12;
  const edits: Edit[] = [];
  let text = source;
  let current = spec;
  let unresolved = 0;
  for (let i = 0; i < report.conflicts.length; i++) {
    const conflict = report.conflicts[i];
    if (!conflict.minimal) continue;
    const chosen = chooseConflict(spec, source, report, conflict, originalKeys, originalVacuous, small);
    if (chosen === null) {
      unresolved++;
      continue;
    }
    edits.push(chosen);
    text = applyText(text, chosen);
    const next = applySpec(current, chosen);
    if (next === null) continue;
    current = next;
  }
  for (let i = 0; i < report.vacuous.length; i++) {
    const item = report.vacuous[i];
    const chosen = chooseVacuous(spec, source, report, item, originalKeys, originalVacuous, small);
    if (chosen === null) {
      unresolved++;
      continue;
    }
    edits.push(chosen);
    text = applyText(text, chosen);
    const next = applySpec(current, chosen);
    if (next === null) continue;
    current = next;
  }
  let conflictsOk = true;
  if (!small && (report.conflicts.length > 0 || report.vacuous.length > 0)) {
    conflictsOk = unresolved === 0 && conflictsHold(spec, current);
  }
  const covered = coverGaps(spec, source, report, current, originalKeys, originalVacuous, small);
  const gapEdits = covered.edits;
  for (let i = 0; i < gapEdits.length; i++) {
    edits.push(gapEdits[i]);
    text = applyText(text, gapEdits[i]);
    const next = applySpec(current, gapEdits[i]);
    if (next === null) continue;
    current = next;
  }
  const proposals: Proposal[] = [];
  for (let i = 0; i < edits.length; i++) proposals.push(edits[i].proposal);
  const applicable =
    edits.length === 0
      ? hardFindings(report) === 0
      : setHolds(spec, text, current, edits, originalVacuous, small, conflictsOk, covered.pending);
  return { kind: "plan", proposals: proposals, edited: text, applicable: applicable };
}

export function formatRepairText(specPath: string, proposals: Proposal[], wrote: string, note: string): string {
  const lines: string[] = [];
  lines.push("spec: " + specPath);
  lines.push("proposals: " + formatInt(proposals.length));
  if (wrote.length > 0) lines.push("wrote: " + wrote);
  if (note.length > 0) lines.push(note);
  for (let i = 0; i < proposals.length; i++) {
    const item = proposals[i];
    lines.push("");
    lines.push("proposal " + item.kind + " " + item.id);
    if (item.note.length > 0) lines.push(item.note);
    lines.push("clears " + joinWords(item.cleared));
    for (let b = 0; b < item.because.length; b++) lines.push("Blocked by " + item.because[b] + ".");
    lines.push("before:");
    lines.push(item.before.length > 0 ? item.before : "none");
    lines.push("after:");
    lines.push(item.after.length > 0 ? item.after : "dropped");
  }
  return lines.join("\n");
}

export function formatRepairJson(specPath: string, proposals: Proposal[], wrote: string): string {
  const rows = [];
  for (let i = 0; i < proposals.length; i++) {
    const item = proposals[i];
    rows.push({
      id: item.id,
      kind: item.kind,
      before: item.before,
      after: item.after,
      cleared: item.cleared,
      because: item.because,
    });
  }
  return JSON.stringify(
    {
      ok: proposals.length === 0,
      spec: specPath,
      wrote: wrote,
      proposals: rows,
    },
    null,
    2,
  );
}

function chooseConflict(
  spec: Spec,
  source: string,
  report: LintReport,
  conflict: Conflict,
  originalKeys: string[],
  originalVacuous: string[],
  small: boolean,
): Edit | null {
  const ordered = orderedRepairs(spec, conflict);
  const key = normIds(conflict.ids);
  for (let i = 0; i < ordered.length; i++) {
    const repair = ordered[i];
    const edit = conflictEdit(spec, conflict, repair, key);
    if (edit === null) continue;
    if (!loneOk(spec, source, report, edit, originalKeys, originalVacuous, small)) continue;
    return edit;
  }
  return null;
}

function orderedRepairs(spec: Spec, conflict: Conflict): Repair[] {
  const narrow: Repair[] = [];
  const dropAlways: Repair[] = [];
  const guard: Repair[] = [];
  const dropOther: Repair[] = [];
  for (let i = 0; i < conflict.repairs.length; i++) {
    const repair = conflict.repairs[i];
    const req = requirementById(spec, repair.id);
    if (req === null) continue;
    if (repair.kind === "strengthen" && req.antecedent !== null) narrow.push(repair);
    else if (repair.kind === "drop" && req.antecedent === null) dropAlways.push(repair);
    else if (repair.kind === "strengthen") guard.push(repair);
    else dropOther.push(repair);
  }
  sortByLength(narrow);
  sortByIndex(spec, dropAlways);
  sortByLength(guard);
  sortByIndex(spec, dropOther);
  const out: Repair[] = [];
  for (let i = 0; i < narrow.length; i++) out.push(narrow[i]);
  for (let i = 0; i < dropAlways.length; i++) out.push(dropAlways[i]);
  for (let i = 0; i < guard.length; i++) out.push(guard[i]);
  for (let i = 0; i < dropOther.length; i++) out.push(dropOther[i]);
  return out;
}

function sortByLength(repairs: Repair[]): void {
  for (let i = 1; i < repairs.length; i++) {
    const item = repairs[i];
    let j = i;
    while (j > 0 && repairs[j - 1].sentence.length > item.sentence.length) {
      repairs[j] = repairs[j - 1];
      j--;
    }
    repairs[j] = item;
  }
}

function sortByIndex(spec: Spec, repairs: Repair[]): void {
  for (let i = 1; i < repairs.length; i++) {
    const item = repairs[i];
    let j = i;
    while (j > 0 && requirementIndex(spec, repairs[j - 1].id) < requirementIndex(spec, item.id)) {
      repairs[j] = repairs[j - 1];
      j--;
    }
    repairs[j] = item;
  }
}

function conflictEdit(spec: Spec, conflict: Conflict, repair: Repair, key: string): Edit | null {
  const req = requirementById(spec, repair.id);
  if (req === null) return null;
  const cleared: string[] = [];
  for (let i = 0; i < conflict.ids.length; i++) cleared.push(conflict.ids[i]);
  const because: string[] = [];
  if (repair.kind === "drop") {
    return editOf("drop", req.id, "", "conflict", joinIds(conflict.ids), req.sentence, "", cleared, because, "Drop " + req.id + ".", key, "", "");
  }
  let note = "Narrow " + req.id + ".";
  if (req.antecedent === null) note = "Guard " + req.id + ".";
  return editOf(
    "replace",
    req.id,
    repair.sentence,
    "conflict",
    joinIds(conflict.ids),
    req.sentence,
    repair.sentence,
    cleared,
    because,
    note,
    key,
    "",
    "",
  );
}

function chooseVacuous(
  spec: Spec,
  source: string,
  report: LintReport,
  item: Vacuous,
  originalKeys: string[],
  originalVacuous: string[],
  small: boolean,
): Edit | null {
  const req = requirementById(spec, item.id);
  if (req === null) return null;
  const candidates = vacuousCandidates(spec, req, item.because);
  for (let i = 0; i < candidates.length; i++) {
    if (!loneOk(spec, source, report, candidates[i], originalKeys, originalVacuous, small)) continue;
    return candidates[i];
  }
  return null;
}

function vacuousCandidates(spec: Spec, req: Requirement, because: string[]): Edit[] {
  const found: Edit[] = [];
  const response = responseOf(req.sentence);
  if (req.antecedent !== null && response.length > 0) {
    const clamped = clampTerm(spec, req.antecedent);
    if (clamped !== null) pushRewrite(spec, req, because, renderTerm(spec, clamped), found);
    const kids: Term[] = [];
    andKids(req.antecedent, kids);
    if (kids.length > 1) {
      for (let skip = kids.length - 1; skip >= 0; skip--) {
        const rest: Term[] = [];
        for (let k = 0; k < kids.length; k++) {
          if (k !== skip) rest.push(kids[k]);
        }
        pushRewrite(spec, req, because, renderTerm(spec, andTerms(rest)), found);
      }
    }
    const flipped = negateLit(req.antecedent);
    if (flipped !== null) pushRewrite(spec, req, because, renderTerm(spec, flipped), found);
  }
  const cleared: string[] = [];
  cleared.push(req.id);
  found.push(
    editOf("drop", req.id, "", "vacuous", req.id, req.sentence, "", cleared, because, "Drop " + req.id + ".", "", req.id, ""),
  );
  return found;
}

function pushRewrite(spec: Spec, req: Requirement, because: string[], cond: string, found: Edit[]): void {
  if (cond.length === 0) return;
  const response = responseOf(req.sentence);
  if (response.length === 0) return;
  const sentence = "When " + cond + ", " + response + ".";
  if (sentence === req.sentence) return;
  const built = parseOne(spec, req.id, sentence, req.line);
  if (built === null) return;
  const cleared: string[] = [];
  cleared.push(req.id);
  found.push(
    editOf(
      "replace",
      req.id,
      built.sentence,
      "vacuous",
      req.id,
      req.sentence,
      built.sentence,
      cleared,
      because,
      "Rewrite " + req.id + ".",
      "",
      req.id,
      "",
    ),
  );
}

function coverGaps(
  original: Spec,
  source: string,
  report: LintReport,
  current: Spec,
  originalKeys: string[],
  originalVacuous: string[],
  small: boolean,
): GapCover {
  const found: Edit[] = [];
  let pending = 0;
  let spec = current;
  const names = openGaps(spec);
  let next = nextRequirementNumber(original);
  for (let n = 0; n < names.length; n++) {
    const name = names[n];
    const index = symbolIndex(spec, name);
    if (index < 0) continue;
    next++;
    const id = "R" + formatInt(next);
    const edit = spec.symbols[index].role === "event" ? coverEvent(spec, index, id) : coverOutput(spec, index, id);
    if (edit === null) {
      next--;
      pending++;
      continue;
    }
    if (!loneOk(original, source, report, edit, originalKeys, originalVacuous, small)) {
      next--;
      pending++;
      continue;
    }
    if (spec.symbols[index].role === "event" && !gapClosed(spec, edit)) {
      next--;
      pending++;
      continue;
    }
    found.push(edit);
    const patched = applySpec(spec, edit);
    if (patched !== null) spec = patched;
  }
  return { edits: found, pending: pending };
}

interface GapCover {
  edits: Edit[];
  pending: number;
}

function coverOutput(spec: Spec, index: number, id: string): Edit | null {
  const antecedents: Term[] = [];
  let mentioned = false;
  for (let r = 0; r < spec.requirements.length; r++) {
    if (!requirementMentions(spec.requirements[r], index)) continue;
    mentioned = true;
    const antecedent = spec.requirements[r].antecedent;
    if (antecedent === null) return null;
    antecedents.push(antecedent);
  }
  const system = systemName(spec, index);
  const responses = responseChoices(spec, index);
  if (!mentioned) return firstResponse(spec, index, id, system, "", responses);
  if (antecedents.length === 0) return null;
  const hole: Term = { kind: "not", term: orTerms(antecedents) };
  const cubes = dnf(hole);
  if (cubes === null) return null;
  const tight = tightenCubes(spec, cubes);
  if (tight === null) return null;
  if (tight.length === 0) return null;
  const cond = renderCubes(spec, tight);
  if (cond.length === 0 && !cubeTrue(tight)) return null;
  return firstResponse(spec, index, id, system, cubeTrue(tight) ? "" : cond, responses);
}

function coverEvent(spec: Spec, index: number, id: string): Edit | null {
  const sym = spec.symbols[index];
  const phrase = sym.phrase.length > 0 ? sym.phrase : sym.name;
  for (let r = 0; r < spec.requirements.length; r++) {
    const req = spec.requirements[r];
    const response = responseOf(req.sentence);
    const cond = guardText(req.sentence);
    if (response.length === 0) continue;
    let sentence = "";
    if (sym.unwanted) {
      if (cond.length === 0) sentence = "If " + phrase + ", then " + response + ".";
      else sentence = "If " + phrase + " and " + cond + ", then " + response + ".";
    } else if (cond.length === 0) sentence = "When " + phrase + ", " + response + ".";
    else sentence = "When " + phrase + " and " + cond + ", " + response + ".";
    const built = parseOne(spec, id, sentence, 0);
    if (built === null) continue;
    if (!additionSafe(spec, built)) continue;
    return addedEdit(id, built.sentence, sym.name);
  }
  return null;
}

function firstResponse(spec: Spec, index: number, id: string, system: string, cond: string, responses: string[]): Edit | null {
  const sym = spec.symbols[index];
  for (let i = 0; i < responses.length; i++) {
    const sentence = cond.length === 0 ? "The " + system + " shall " + responses[i] + "." : "When " + cond + ", the " + system + " shall " + responses[i] + ".";
    const built = parseOne(spec, id, sentence, 0);
    if (built === null) continue;
    if (!additionSafe(spec, built)) continue;
    const patched = withReq(spec, built);
    if (bestGap(patched, index) !== null) continue;
    return addedEdit(id, built.sentence, sym.name);
  }
  return null;
}

function addedEdit(id: string, sentence: string, gapName: string): Edit {
  const cleared: string[] = [];
  cleared.push(gapName);
  const because: string[] = [];
  return editOf("add", id, sentence, "gap", gapName, "", sentence, cleared, because, "Add " + id + ".", "", "", gapName);
}

function loneOk(
  spec: Spec,
  source: string,
  report: LintReport,
  edit: Edit,
  originalKeys: string[],
  originalVacuous: string[],
  small: boolean,
): boolean {
  if (small) {
    const text = applyText(source, edit);
    const parsed = parseSpec(text);
    if (!parsed.ok) return false;
    return reportOk(report, lintReport(parsed.spec), edit);
  }
  const patched = applySpec(spec, edit);
  if (patched === null) return false;
  return fastOk(spec, patched, edit, originalKeys, originalVacuous);
}

function conflictsHold(original: Spec, current: Spec): boolean {
  const scan = keyScan(original, current);
  if (scan === null) return false;
  return scan.keys.length === 0;
}

function targetCleared(spec: Spec, edit: Edit): boolean {
  const ids: string[] = [];
  let start = 0;
  for (let i = 0; i <= edit.conflictKey.length; i++) {
    if (i === edit.conflictKey.length || edit.conflictKey.charCodeAt(i) === 44) {
      if (i > start) ids.push(edit.conflictKey.slice(start, i));
      start = i + 1;
    }
  }
  const holds: Requirement[] = [];
  for (let i = 0; i < ids.length; i++) {
    const req = requirementById(spec, ids[i]);
    if (req === null) continue;
    holds.push(req);
  }
  if (holds.length === 0) return true;
  return firstUnsatDrivers(spec, holds) === null;
}

function setHolds(
  spec: Spec,
  text: string,
  current: Spec,
  edits: Edit[],
  originalVacuous: string[],
  small: boolean,
  conflictsOk: boolean,
  pending: number,
): boolean {
  const parsed = parseSpec(text);
  if (!parsed.ok) return false;
  if (!sameSentences(parsed.spec, current)) return false;
  if (small) {
    const next = lintReport(parsed.spec);
    if (next === null) return false;
    if (hardFindings(next) !== 0) return false;
    for (let i = 0; i < edits.length; i++) {
      if (!targetsGone(next, edits[i])) return false;
    }
    return true;
  }
  if (!conflictsOk || pending !== 0) return false;
  return !introducedVacuous(spec, parsed.spec, originalVacuous);
}

function reportOk(original: LintReport, next: LintReport | null, edit: Edit): boolean {
  if (next === null) return false;
  if (!targetsGone(next, edit)) return false;
  if (newConflict(original, next)) return false;
  if (newVacuousReport(original, next)) return false;
  if (edit.op === "drop" && (newGap(original, next) || newUnused(original, next))) return false;
  return true;
}

function fastOk(original: Spec, patched: Spec, edit: Edit, originalKeys: string[], originalVacuous: string[]): boolean {
  if (edit.gapName.length > 0) return gapEditOk(patched, edit);
  if (edit.conflictKey.length > 0) {
    if (!targetCleared(patched, edit)) return false;
    if (newVacuous(patched, originalVacuous)) return false;
    if (edit.op === "drop" && orphaned(original, edit.id)) return false;
    return true;
  }
  const scan = keyScan(original, patched);
  if (scan === null) return false;
  if (edit.conflictKey.length > 0 && hasKey(scan.keys, edit.conflictKey)) return false;
  for (let i = 0; i < scan.keys.length; i++) {
    if (!hasKey(originalKeys, scan.keys[i])) return false;
  }
  if (edit.vacuousId.length > 0 && hasWord(vacuousNow(patched, originalVacuous), edit.vacuousId)) return false;
  if (newVacuous(patched, originalVacuous)) return false;
  if (edit.op === "drop" && orphaned(original, edit.id)) return false;
  return true;
}

function targetsGone(report: LintReport, edit: Edit): boolean {
  if (edit.conflictKey.length > 0) {
    for (let i = 0; i < report.conflicts.length; i++) {
      if (normIds(report.conflicts[i].ids) === edit.conflictKey) return false;
    }
  }
  if (edit.vacuousId.length > 0) {
    for (let i = 0; i < report.vacuous.length; i++) {
      if (report.vacuous[i].id === edit.vacuousId) return false;
    }
  }
  if (edit.gapName.length > 0) {
    for (let i = 0; i < report.gaps.length; i++) {
      if (report.gaps[i].output === edit.gapName) return false;
    }
  }
  return true;
}

function newConflict(original: LintReport, next: LintReport): boolean {
  for (let i = 0; i < next.conflicts.length; i++) {
    const key = normIds(next.conflicts[i].ids);
    let known = false;
    for (let j = 0; j < original.conflicts.length; j++) {
      if (normIds(original.conflicts[j].ids) === key) known = true;
    }
    if (!known) return true;
  }
  return false;
}

function newVacuousReport(original: LintReport, next: LintReport): boolean {
  for (let i = 0; i < next.vacuous.length; i++) {
    let known = false;
    for (let j = 0; j < original.vacuous.length; j++) {
      if (original.vacuous[j].id === next.vacuous[i].id) known = true;
    }
    if (!known) return true;
  }
  return false;
}

function newGap(original: LintReport, next: LintReport): boolean {
  for (let i = 0; i < next.gaps.length; i++) {
    let known = false;
    for (let j = 0; j < original.gaps.length; j++) {
      if (original.gaps[j].output === next.gaps[i].output) known = true;
    }
    if (!known) return true;
  }
  return false;
}

function newUnused(original: LintReport, next: LintReport): boolean {
  for (let i = 0; i < next.unused.length; i++) {
    let known = false;
    for (let j = 0; j < original.unused.length; j++) {
      if (original.unused[j].name === next.unused[i].name) known = true;
    }
    if (!known) return true;
  }
  return false;
}

function gapEditOk(spec: Spec, edit: Edit): boolean {
  const req = requirementById(spec, edit.id);
  if (req === null) return false;
  if (req.antecedent !== null && !possible(spec, req.antecedent)) return false;
  return true;
}

function gapClosed(spec: Spec, edit: Edit): boolean {
  const patched = applySpec(spec, edit);
  if (patched === null) return false;
  const index = symbolIndex(patched, edit.gapName);
  if (index < 0) return false;
  if (patched.symbols[index].role === "event") return eventMentioned(patched, index);
  return bestGap(patched, index) === null;
}

function openGaps(spec: Spec): string[] {
  const names: string[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    if (isDriver(spec.symbols[i])) continue;
    if (bestGap(spec, i) === null) continue;
    names.push(spec.symbols[i].name);
  }
  for (let i = 0; i < spec.symbols.length; i++) {
    if (spec.symbols[i].role !== "event") continue;
    if (eventMentioned(spec, i)) continue;
    names.push(spec.symbols[i].name);
  }
  return names;
}

function eventMentioned(spec: Spec, index: number): boolean {
  for (let r = 0; r < spec.requirements.length; r++) {
    if (requirementMentions(spec.requirements[r], index)) return true;
  }
  return false;
}

function additionSafe(spec: Spec, req: Requirement): boolean {
  if (req.antecedent !== null && !possible(spec, req.antecedent)) return false;
  const holds: Requirement[] = [];
  for (let i = 0; i < spec.requirements.length; i++) {
    if (sharesOutput(spec, spec.requirements[i], req)) holds.push(spec.requirements[i]);
  }
  holds.push(req);
  if (firstUnsatDrivers(spec, holds) !== null) return false;
  if (!hasUbiquitous(spec)) return true;
  const patched = withReq(spec, req);
  return !newVacuous(patched, vacuousIds(findVacuous(spec)));
}

function sharesOutput(spec: Spec, left: Requirement, right: Requirement): boolean {
  for (let i = 0; i < spec.symbols.length; i++) {
    if (isDriver(spec.symbols[i])) continue;
    if (requirementMentions(left, i) && requirementMentions(right, i)) return true;
  }
  return false;
}

function introducedVacuous(original: Spec, spec: Spec, originalIds: string[]): boolean {
  if (hasUbiquitous(spec)) return newVacuous(spec, originalIds);
  for (let i = 0; i < spec.requirements.length; i++) {
    const req = spec.requirements[i];
    if (req.antecedent === null) continue;
    const prev = requirementById(original, req.id);
    if (prev !== null && prev.sentence === req.sentence) continue;
    if (possible(spec, req.antecedent)) continue;
    if (!hasWord(originalIds, req.id)) return true;
  }
  return false;
}

function newVacuous(spec: Spec, originalIds: string[]): boolean {
  const now = vacuousNow(spec, originalIds);
  for (let i = 0; i < now.length; i++) {
    if (!hasWord(originalIds, now[i])) return true;
  }
  return false;
}

function vacuousNow(spec: Spec, originalIds: string[]): string[] {
  if (!hasUbiquitous(spec)) {
    const found: string[] = [];
    for (let i = 0; i < spec.requirements.length; i++) {
      const req = spec.requirements[i];
      if (req.antecedent === null) continue;
      if (possible(spec, req.antecedent)) continue;
      if (!hasWord(originalIds, req.id)) found.push(req.id);
    }
    return found;
  }
  const found = findVacuous(spec);
  const ids: string[] = [];
  for (let i = 0; i < found.length; i++) ids.push(found[i].id);
  return ids;
}

function hasUbiquitous(spec: Spec): boolean {
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].antecedent === null) return true;
  }
  return false;
}

function orphaned(spec: Spec, id: string): boolean {
  const req = requirementById(spec, id);
  if (req === null) return false;
  for (let s = 0; s < spec.symbols.length; s++) {
    const sym = spec.symbols[s];
    if (sym.role !== "input" && sym.role !== "event") continue;
    if (!requirementMentions(req, s)) continue;
    let other = false;
    for (let r = 0; r < spec.requirements.length; r++) {
      if (spec.requirements[r].id === id) continue;
      if (requirementMentions(spec.requirements[r], s)) other = true;
    }
    if (!other) return true;
  }
  return false;
}

interface KeyScan {
  keys: string[];
}

function keyScan(original: Spec, patched: Spec): KeyScan | null {
  const now = independentGroups(patched, patched.requirements);
  if (now === null) {
    const groups = conflictingSets(patched);
    const keys: string[] = [];
    for (let i = 0; i < groups.length; i++) keys.push(normIds(idsOf(patched, groups[i].indexes)));
    return { keys: keys };
  }
  const before = independentGroups(original, original.requirements);
  const keys: string[] = [];
  for (let g = 0; g < now.length; g++) {
    if (before !== null && groupSeen(before, now[g])) continue;
    const found = conflictKeysMatched(patched, now[g]);
    for (let k = 0; k < found.length; k++) keys.push(normKey(found[k]));
  }
  return { keys: keys };
}

function groupSeen(groups: Requirement[][], holds: Requirement[]): boolean {
  for (let i = 0; i < groups.length; i++) {
    if (sameHolds(groups[i], holds)) return true;
  }
  return false;
}

function sameHolds(left: Requirement[], right: Requirement[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function idsOf(spec: Spec, indexes: number[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < indexes.length; i++) ids.push(spec.requirements[indexes[i]].id);
  return ids;
}

function conflictKeyList(spec: Spec, report: LintReport): string[] {
  const keys: string[] = [];
  for (let i = 0; i < report.conflicts.length; i++) keys.push(normIds(report.conflicts[i].ids));
  if (keys.length === 0 && spec.requirements.length === 0) return keys;
  return keys;
}

function vacuousIds(items: Vacuous[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < items.length; i++) ids.push(items[i].id);
  return ids;
}

function lintReport(spec: Spec): LintReport | null {
  const outcome = lintSpec(spec);
  if (outcome.kind === "error") return null;
  return outcome.report;
}

function hardFindings(report: LintReport): number {
  return (
    report.conflicts.length +
    report.gaps.length +
    report.misuse.length +
    report.wording.length +
    report.duplicate.length +
    report.vacuous.length +
    report.unused.length
  );
}

function sameSentences(left: Spec, right: Spec): boolean {
  if (left.requirements.length !== right.requirements.length) return false;
  for (let i = 0; i < left.requirements.length; i++) {
    if (left.requirements[i].id !== right.requirements[i].id) return false;
    if (left.requirements[i].sentence !== right.requirements[i].sentence) return false;
  }
  return true;
}

function applySpec(spec: Spec, edit: Edit): Spec | null {
  if (edit.op === "drop") return withoutReq(spec, edit.id);
  if (edit.op === "add" || edit.op === "replace") {
    const line = edit.op === "replace" ? lineOf(spec, edit.id) : 0;
    const built = parseOne(spec, edit.id, edit.sentence, line);
    if (built === null) return null;
    if (edit.op === "add") return withReq(spec, built);
    return replaceReq(spec, built);
  }
  return null;
}

function applyText(source: string, edit: Edit): string {
  const lines = splitSource(source);
  if (edit.op === "add") {
    appendLine(lines, edit.id + " " + edit.sentence);
    return joinLines(lines);
  }
  const span = findSpan(lines, edit.id);
  if (span === null) return source;
  if (edit.op === "drop") return joinLines(replaceSpan(lines, span.start, span.end, []));
  const inserted: string[] = [];
  inserted.push(edit.id + " " + edit.sentence);
  return joinLines(replaceSpan(lines, span.start, span.end, inserted));
}

function splitSource(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      let line = text.slice(start, i);
      if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, line.length - 1);
      lines.push(line);
      start = i + 1;
    }
  }
  return lines;
}

function joinLines(lines: string[]): string {
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) out += "\n";
    out += lines[i];
  }
  return out;
}

function appendLine(lines: string[], line: string): void {
  if (lines.length > 0 && lines[lines.length - 1].length === 0) {
    lines[lines.length - 1] = line;
    lines.push("");
    return;
  }
  lines.push(line);
}

function replaceSpan(lines: string[], start: number, end: number, insert: string[]): string[] {
  const next: string[] = [];
  for (let i = 0; i < start; i++) next.push(lines[i]);
  for (let i = 0; i < insert.length; i++) next.push(insert[i]);
  for (let i = end; i < lines.length; i++) next.push(lines[i]);
  return next;
}

interface Span {
  start: number;
  end: number;
}

function findSpan(lines: string[], id: string): Span | null {
  for (let i = 0; i < lines.length; i++) {
    if (lineId(lines[i]) !== id) continue;
    let end = i + 1;
    while (end < lines.length) {
      const next = trimLine(lines[end]);
      if (next.length === 0 || ignorable(next) || lineId(next).length > 0 || declaration(next)) break;
      end++;
    }
    return { start: i, end: end };
  }
  return null;
}

function lineId(line: string): string {
  const trimmed = trimLine(line);
  if (trimmed.length < 2) return "";
  const head = trimmed.charCodeAt(0);
  if (head !== 82 && head !== 80) return "";
  let i = 1;
  if (i >= trimmed.length || !isDigit(trimmed.charCodeAt(i))) return "";
  while (i < trimmed.length && isDigit(trimmed.charCodeAt(i))) i++;
  while (i < trimmed.length && trimmed.charCodeAt(i) === 46) {
    i++;
    if (i >= trimmed.length || !isDigit(trimmed.charCodeAt(i))) return "";
    while (i < trimmed.length && isDigit(trimmed.charCodeAt(i))) i++;
  }
  if (i < trimmed.length && trimmed.charCodeAt(i) !== 32 && trimmed.charCodeAt(i) !== 9) return "";
  return trimmed.slice(0, i);
}

function ignorable(line: string): boolean {
  if (line.length === 0) return true;
  if (line.charCodeAt(0) === 35) return true;
  if (line.length >= 2 && line.slice(0, 2) === "//") return true;
  if (line.length >= 4 && line.slice(0, 4) === "<!--") return true;
  if (line === "-->") return true;
  return false;
}

function declaration(line: string): boolean {
  const word = leadingWord(line);
  return word === "enum" || word === "event" || word === "state" || word === "input" || word === "output" || word === "unwanted";
}

function leadingWord(line: string): string {
  let i = 0;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  const start = i;
  while (i < line.length) {
    const code = line.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) break;
    i++;
  }
  return lowerText(line.slice(start, i));
}

function trimLine(text: string): string {
  let a = 0;
  let b = text.length;
  while (a < b && (text.charCodeAt(a) === 32 || text.charCodeAt(a) === 9)) a++;
  while (b > a && (text.charCodeAt(b - 1) === 32 || text.charCodeAt(b - 1) === 9)) b--;
  return text.slice(a, b);
}

function lowerText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) out += String.fromCharCode(code + 32);
    else out += text.slice(i, i + 1);
  }
  return out;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function parseOne(spec: Spec, id: string, sentence: string, line: number): Requirement | null {
  const parsed = parseProperty(id + " " + sentence, spec);
  if (!parsed.ok || parsed.requirements.length !== 1) return null;
  const got = parsed.requirements[0];
  return {
    id: id,
    line: line,
    sentence: got.sentence,
    system: got.system,
    antecedent: got.antecedent,
    consequent: got.consequent,
    hasWhen: got.hasWhen,
    hasIf: got.hasIf,
    whenTerm: got.whenTerm,
  };
}

function withReq(spec: Spec, req: Requirement): Spec {
  const requirements: Requirement[] = [];
  for (let i = 0; i < spec.requirements.length; i++) requirements.push(spec.requirements[i]);
  requirements.push(req);
  return { enums: spec.enums, symbols: spec.symbols, requirements: requirements };
}

function withoutReq(spec: Spec, id: string): Spec {
  const requirements: Requirement[] = [];
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].id !== id) requirements.push(spec.requirements[i]);
  }
  return { enums: spec.enums, symbols: spec.symbols, requirements: requirements };
}

function replaceReq(spec: Spec, req: Requirement): Spec {
  const requirements: Requirement[] = [];
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].id === req.id) requirements.push(req);
    else requirements.push(spec.requirements[i]);
  }
  return { enums: spec.enums, symbols: spec.symbols, requirements: requirements };
}

function requirementById(spec: Spec, id: string): Requirement | null {
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].id === id) return spec.requirements[i];
  }
  return null;
}

function requirementIndex(spec: Spec, id: string): number {
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].id === id) return i;
  }
  return -1;
}

function lineOf(spec: Spec, id: string): number {
  const req = requirementById(spec, id);
  if (req === null) return 0;
  return req.line;
}

function symbolIndex(spec: Spec, name: string): number {
  for (let i = 0; i < spec.symbols.length; i++) {
    if (spec.symbols[i].name === name) return i;
  }
  return -1;
}

function systemName(spec: Spec, output: number): string {
  for (let i = 0; i < spec.requirements.length; i++) {
    if (!requirementMentions(spec.requirements[i], output)) continue;
    if (spec.requirements[i].system.length > 0) return spec.requirements[i].system;
  }
  if (spec.requirements.length > 0 && spec.requirements[0].system.length > 0) return spec.requirements[0].system;
  return "System";
}

function nextRequirementNumber(spec: Spec): number {
  let max = 0;
  for (let i = 0; i < spec.requirements.length; i++) {
    const n = idNumber(spec.requirements[i].id);
    if (n > max) max = n;
  }
  return max;
}

function idNumber(id: string): number {
  if (id.length < 2 || id.charCodeAt(0) !== 82) return 0;
  let n = 0;
  let any = false;
  for (let i = 1; i < id.length; i++) {
    const code = id.charCodeAt(i);
    if (code < 48 || code > 57) break;
    any = true;
    n = n * 10 + (code - 48);
  }
  return any ? n : 0;
}

function responseChoices(spec: Spec, index: number): string[] {
  const sym = spec.symbols[index];
  const found: string[] = [];
  if (sym.sort.kind === "bool") {
    const phrase = sym.phrase.length > 0 ? sym.phrase : sym.name;
    found.push(negatePhrase(phrase));
    found.push(phrase);
    return found;
  }
  if (sym.sort.kind === "int") {
    found.push(fillAs(sym, formatInt(sym.sort.min)));
    if (sym.sort.max !== sym.sort.min) found.push(fillAs(sym, formatInt(sym.sort.max)));
    return dropEmpty(found);
  }
  if (sym.sort.kind === "enum") {
    const decl = enumVariants(spec, sym.sort.enumName);
    for (let i = 0; i < decl.length; i++) found.push(fillAs(sym, decl[i]));
    return dropEmpty(found);
  }
  return found;
}

function dropEmpty(values: string[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i].length > 0) found.push(values[i]);
  }
  return found;
}

function enumVariants(spec: Spec, name: string): string[] {
  for (let i = 0; i < spec.enums.length; i++) {
    if (spec.enums[i].name === name) return spec.enums[i].variants;
  }
  const empty: string[] = [];
  return empty;
}

function fillAs(sym: SymbolDecl, value: string): string {
  if (sym.asText.length === 0) {
    const name = sym.phrase.length > 0 ? sym.phrase : sym.name;
    return name + " is " + value;
  }
  let out = "";
  let i = 0;
  while (i < sym.asText.length) {
    if (sym.asText.charCodeAt(i) === 123) {
      let end = i + 1;
      while (end < sym.asText.length && sym.asText.charCodeAt(end) !== 125) end++;
      if (end >= sym.asText.length) return "";
      const hole = sym.asText.slice(i + 1, end);
      if (hole === "op") {
        i = end + 1;
        continue;
      }
      if (hole === "value" || hole === "name" || hole === sym.name) out += value;
      else return "";
      i = end + 1;
      continue;
    }
    out += sym.asText.slice(i, i + 1);
    i++;
  }
  return collapseSpaces(out);
}

function collapseSpaces(text: string): string {
  let out = "";
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9) {
      space = out.length > 0;
      continue;
    }
    if (space) out += " ";
    space = false;
    out += text.slice(i, i + 1);
  }
  return out;
}

function responseOf(sentence: string): string {
  const parts = topCommas(stripPeriod(sentence));
  if (parts === null || parts.length === 0) return "";
  return parts[parts.length - 1];
}

function guardText(sentence: string): string {
  const parts = topCommas(stripPeriod(sentence));
  if (parts === null || parts.length <= 1) return "";
  let out = "";
  for (let i = 0; i < parts.length - 1; i++) {
    const rest = withoutKeyword(parts[i]);
    if (rest.length === 0) continue;
    if (out.length > 0) out += " and ";
    out += rest;
  }
  return out;
}

function withoutKeyword(clause: string): string {
  const trimmed = trimLine(clause);
  let space = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) === 32) {
      space = i;
      break;
    }
  }
  if (space < 0) return "";
  return trimLine(trimmed.slice(space + 1));
}

function stripPeriod(sentence: string): string {
  if (sentence.length > 0 && sentence.charCodeAt(sentence.length - 1) === 46) return sentence.slice(0, sentence.length - 1);
  return sentence;
}

function topCommas(text: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 40) depth++;
    else if (code === 41) {
      depth--;
      if (depth < 0) return null;
    } else if (code === 44 && depth === 0) {
      parts.push(trimLine(text.slice(start, i)));
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(trimLine(text.slice(start)));
  return parts;
}

function dnf(term: Term): Term[][] | null {
  return dnfNode(term, false);
}

function dnfNode(term: Term, neg: boolean): Term[][] | null {
  if (term.kind === "not") return dnfNode(term.term, !neg);
  if (term.kind === "and" || term.kind === "or") {
    const left = dnfNode(term.left, neg);
    if (left === null) return null;
    const right = dnfNode(term.right, neg);
    if (right === null) return null;
    const asAnd = term.kind === "and" ? !neg : neg;
    if (asAnd) return conjoinCubes(left, right);
    return disjoinCubes(left, right);
  }
  const lit = neg ? negateLit(term) : term;
  if (lit === null) return null;
  const cube: Term[] = [];
  cube.push(lit);
  const cubes: Term[][] = [];
  cubes.push(cube);
  return cubes;
}

function conjoinCubes(left: Term[][], right: Term[][]): Term[][] | null {
  if (left.length * right.length > 64) return null;
  const out: Term[][] = [];
  for (let i = 0; i < left.length; i++) {
    for (let j = 0; j < right.length; j++) {
      const cube: Term[] = [];
      for (let a = 0; a < left[i].length; a++) cube.push(left[i][a]);
      for (let b = 0; b < right[j].length; b++) cube.push(right[j][b]);
      out.push(cube);
    }
  }
  return out;
}

function disjoinCubes(left: Term[][], right: Term[][]): Term[][] | null {
  if (left.length + right.length > 64) return null;
  const out: Term[][] = [];
  for (let i = 0; i < left.length; i++) out.push(left[i]);
  for (let i = 0; i < right.length; i++) out.push(right[i]);
  return out;
}

function tightenCubes(spec: Spec, cubes: Term[][]): Term[][] | null {
  const cleaned: Term[][] = [];
  for (let i = 0; i < cubes.length; i++) {
    const cube = tightenCube(spec, cubes[i]);
    if (cube === null) continue;
    cleaned.push(cube);
  }
  const out: Term[][] = [];
  for (let i = 0; i < cleaned.length; i++) {
    let redundant = false;
    for (let j = 0; j < cleaned.length; j++) {
      if (i === j) continue;
      if (moreGeneral(cleaned[j], cleaned[i])) redundant = true;
    }
    if (!redundant) out.push(cleaned[i]);
  }
  return out;
}

function moreGeneral(general: Term[], specific: Term[]): boolean {
  if (general.length >= specific.length) return false;
  for (let i = 0; i < general.length; i++) {
    if (!cubeHas(specific, general[i])) return false;
  }
  return true;
}

function cubeHas(cube: Term[], lit: Term): boolean {
  for (let i = 0; i < cube.length; i++) {
    if (termsEqual(cube[i], lit)) return true;
  }
  return false;
}

function cubeTrue(cubes: Term[][]): boolean {
  for (let i = 0; i < cubes.length; i++) {
    if (cubes[i].length === 0) return true;
  }
  return false;
}

function tightenCube(spec: Spec, cube: Term[]): Term[] | null {
  const boolIdx: number[] = [];
  const boolVal: boolean[] = [];
  const intIdx: number[] = [];
  const intLo: number[] = [];
  const intHi: number[] = [];
  const enumIdx: number[] = [];
  const enumVar: string[] = [];
  const extra: Term[] = [];
  for (let i = 0; i < cube.length; i++) {
    if (!absorbLit(spec, cube[i], boolIdx, boolVal, intIdx, intLo, intHi, enumIdx, enumVar, extra)) return null;
  }
  const out: Term[] = [];
  for (let i = 0; i < boolIdx.length; i++) {
    const term = symTerm(spec, boolIdx[i]);
    if (boolVal[i]) out.push(term);
    else out.push({ kind: "not", term: term });
  }
  for (let i = 0; i < intIdx.length; i++) {
    const sym = spec.symbols[intIdx[i]];
    if (sym.sort.kind !== "int") return null;
    if (intLo[i] > intHi[i]) return null;
    const left = symTerm(spec, intIdx[i]);
    if (intLo[i] === intHi[i]) {
      out.push({ kind: "eq", left: left, right: { kind: "int", value: intLo[i] } });
      continue;
    }
    if (intLo[i] > sym.sort.min) out.push({ kind: "ge", left: left, right: { kind: "int", value: intLo[i] } });
    if (intHi[i] < sym.sort.max) out.push({ kind: "le", left: left, right: { kind: "int", value: intHi[i] } });
  }
  for (let i = 0; i < enumIdx.length; i++) {
    const sym = spec.symbols[enumIdx[i]];
    if (sym.sort.kind !== "enum") return null;
    out.push({
      kind: "eq",
      left: symTerm(spec, enumIdx[i]),
      right: { kind: "enum", enumName: sym.sort.enumName, variant: enumVar[i], index: variantIndex(spec, sym.sort.enumName, enumVar[i]) },
    });
  }
  for (let i = 0; i < extra.length; i++) out.push(extra[i]);
  return out;
}

function absorbLit(
  spec: Spec,
  lit: Term,
  boolIdx: number[],
  boolVal: boolean[],
  intIdx: number[],
  intLo: number[],
  intHi: number[],
  enumIdx: number[],
  enumVar: string[],
  extra: Term[],
): boolean {
  if (lit.kind === "not") {
    const inner = lit.term;
    if (inner.kind === "sym") return setBool(spec, inner.index, false, boolIdx, boolVal);
    const flipped = negateLit(inner);
    if (flipped === null) return false;
    return absorbLit(spec, flipped, boolIdx, boolVal, intIdx, intLo, intHi, enumIdx, enumVar, extra);
  }
  if (lit.kind === "sym") return setBool(spec, lit.index, true, boolIdx, boolVal);
  if (lit.kind === "bool") return lit.value;
  if (
    lit.kind === "eq" ||
    lit.kind === "neq" ||
    lit.kind === "lt" ||
    lit.kind === "le" ||
    lit.kind === "gt" ||
    lit.kind === "ge"
  ) {
    if (lit.left.kind !== "sym") {
      extra.push(lit);
      return true;
    }
    const sym = spec.symbols[lit.left.index];
    if (sym.sort.kind === "bool") {
      extra.push(lit);
      return true;
    }
    if (sym.sort.kind === "enum") {
      if (lit.kind !== "eq" || lit.right.kind !== "enum") {
        extra.push(lit);
        return true;
      }
      return setEnum(lit.left.index, lit.right.variant, enumIdx, enumVar);
    }
    if (lit.right.kind !== "int") {
      extra.push(lit);
      return true;
    }
    if (lit.kind === "neq") {
      extra.push(lit);
      return true;
    }
    return setInt(spec, lit.left.index, lit.kind, lit.right.value, intIdx, intLo, intHi);
  }
  extra.push(lit);
  return true;
}

function setBool(spec: Spec, index: number, value: boolean, boolIdx: number[], boolVal: boolean[]): boolean {
  if (spec.symbols[index].sort.kind !== "bool") return false;
  for (let i = 0; i < boolIdx.length; i++) {
    if (boolIdx[i] !== index) continue;
    if (boolVal[i] !== value) return false;
    return true;
  }
  boolIdx.push(index);
  boolVal.push(value);
  return true;
}

function setEnum(index: number, variant: string, enumIdx: number[], enumVar: string[]): boolean {
  for (let i = 0; i < enumIdx.length; i++) {
    if (enumIdx[i] !== index) continue;
    if (enumVar[i] !== variant) return false;
    return true;
  }
  enumIdx.push(index);
  enumVar.push(variant);
  return true;
}

function setInt(spec: Spec, index: number, kind: string, value: number, intIdx: number[], intLo: number[], intHi: number[]): boolean {
  const sym = spec.symbols[index];
  if (sym.sort.kind !== "int") return false;
  let slot = -1;
  for (let i = 0; i < intIdx.length; i++) {
    if (intIdx[i] === index) slot = i;
  }
  if (slot < 0) {
    intIdx.push(index);
    intLo.push(sym.sort.min);
    intHi.push(sym.sort.max);
    slot = intIdx.length - 1;
  }
  let lo = intLo[slot];
  let hi = intHi[slot];
  if (kind === "eq") {
    lo = value;
    hi = value;
  } else if (kind === "lt") hi = value - 1;
  else if (kind === "le") hi = value;
  else if (kind === "gt") lo = value + 1;
  else if (kind === "ge") lo = value;
  if (lo > intLo[slot]) intLo[slot] = lo;
  if (hi < intHi[slot]) intHi[slot] = hi;
  return intLo[slot] <= intHi[slot];
}

function variantIndex(spec: Spec, enumName: string, variant: string): number {
  for (let i = 0; i < spec.enums.length; i++) {
    if (spec.enums[i].name !== enumName) continue;
    for (let v = 0; v < spec.enums[i].variants.length; v++) {
      if (spec.enums[i].variants[v] === variant) return v;
    }
  }
  return 0;
}

function symTerm(spec: Spec, index: number): Term {
  const sym = spec.symbols[index];
  return { kind: "sym", name: sym.name, index: index, phrase: sym.phrase };
}

function renderCubes(spec: Spec, cubes: Term[][]): string {
  let out = "";
  for (let i = 0; i < cubes.length; i++) {
    if (cubes[i].length === 0) return "";
    const phrase = renderCube(spec, cubes[i]);
    if (phrase.length === 0) return "";
    if (out.length > 0) out += " or ";
    out += phrase;
  }
  return out;
}

function renderCube(spec: Spec, cube: Term[]): string {
  let out = "";
  for (let i = 0; i < cube.length; i++) {
    const phrase = literalPhrase(spec, cube[i]);
    if (phrase.length === 0) return "";
    if (out.length > 0) out += " and ";
    out += phrase;
  }
  return out;
}

function renderTerm(spec: Spec, term: Term): string {
  return renderNode(spec, term, "top");
}

function renderNode(spec: Spec, term: Term, parent: string): string {
  if (term.kind === "and") {
    const left = renderNode(spec, term.left, "and");
    const right = renderNode(spec, term.right, "and");
    if (left.length === 0 || right.length === 0) return "";
    return left + " and " + right;
  }
  if (term.kind === "or") {
    const left = renderNode(spec, term.left, "or");
    const right = renderNode(spec, term.right, "or");
    if (left.length === 0 || right.length === 0) return "";
    const body = left + " or " + right;
    if (parent === "and") return "(" + body + ")";
    return body;
  }
  return literalPhrase(spec, term);
}

function literalPhrase(spec: Spec, term: Term): string {
  if (term.kind === "not") {
    const inner = term.term;
    if (inner.kind === "sym") return negatePhrase(symbolPhrase(spec.symbols[inner.index]));
    const phrase = literalPhrase(spec, inner);
    if (phrase.length === 0) return "";
    return "not (" + phrase + ")";
  }
  if (term.kind === "sym") return symbolPhrase(spec.symbols[term.index]);
  if (
    term.kind === "eq" ||
    term.kind === "neq" ||
    term.kind === "lt" ||
    term.kind === "le" ||
    term.kind === "gt" ||
    term.kind === "ge"
  ) {
    if (term.left.kind !== "sym") return "";
    const name = symbolPhrase(spec.symbols[term.left.index]);
    if (term.right.kind === "int") return name + " is " + relationPhrase(term.kind, term.right.value);
    if (term.right.kind === "enum") {
      if (term.kind === "neq") return name + " is not " + term.right.variant;
      return name + " is " + term.right.variant;
    }
    if (term.right.kind === "sym") return name + " is " + symbolPhrase(spec.symbols[term.right.index]);
  }
  return "";
}

function relationPhrase(kind: string, value: number): string {
  const shown = formatInt(value);
  if (kind === "lt") return "less than " + shown;
  if (kind === "le") return "at most " + shown;
  if (kind === "gt") return "greater than " + shown;
  if (kind === "ge") return "at least " + shown;
  if (kind === "neq") return "not " + shown;
  return shown;
}

function symbolPhrase(sym: SymbolDecl): string {
  if (sym.phrase.length > 0) return sym.phrase;
  return sym.name;
}

function negatePhrase(phrase: string): string {
  const token = " is ";
  const at = phrase.indexOf(token);
  if (at >= 0) return phrase.slice(0, at) + " is not " + phrase.slice(at + token.length);
  return "not " + phrase;
}

function clampTerm(spec: Spec, term: Term): Term | null {
  const copy = clampNode(spec, term);
  if (copy === null) return null;
  if (termsEqual(copy, term)) return null;
  return copy;
}

function clampNode(spec: Spec, term: Term): Term | null {
  if (term.kind === "not") {
    const inner = clampNode(spec, term.term);
    if (inner === null) return term;
    return { kind: "not", term: inner };
  }
  if (term.kind === "and" || term.kind === "or") {
    const left = clampNode(spec, term.left);
    const right = clampNode(spec, term.right);
    if (left === null || right === null) return null;
    if (term.kind === "and") return { kind: "and", left: left, right: right };
    return { kind: "or", left: left, right: right };
  }
  if (
    term.kind === "eq" ||
    term.kind === "neq" ||
    term.kind === "lt" ||
    term.kind === "le" ||
    term.kind === "gt" ||
    term.kind === "ge"
  ) {
    return clampCmp(spec, term);
  }
  return term;
}

function clampCmp(spec: Spec, term: Term): Term | null {
  if (term.kind !== "eq" && term.kind !== "neq" && term.kind !== "lt" && term.kind !== "le" && term.kind !== "gt" && term.kind !== "ge") {
    return term;
  }
  if (term.left.kind !== "sym" || term.right.kind !== "int") return term;
  const sym = spec.symbols[term.left.index];
  if (sym.sort.kind !== "int") return term;
  const value = term.right.value;
  if (value >= sym.sort.min && value <= sym.sort.max) return term;
  if (value > sym.sort.max) {
    if (term.kind === "lt" || term.kind === "le") return { kind: "le", left: term.left, right: { kind: "int", value: sym.sort.max } };
    return { kind: "ge", left: term.left, right: { kind: "int", value: sym.sort.max } };
  }
  if (term.kind === "gt" || term.kind === "ge") return { kind: "ge", left: term.left, right: { kind: "int", value: sym.sort.min } };
  return { kind: "le", left: term.left, right: { kind: "int", value: sym.sort.min } };
}

function negateLit(term: Term): Term | null {
  if (term.kind === "not") return term.term;
  if (term.kind === "sym") return { kind: "not", term: term };
  if (term.kind === "bool") return { kind: "bool", value: !term.value };
  if (term.kind === "eq") return { kind: "neq", left: term.left, right: term.right };
  if (term.kind === "neq") return { kind: "eq", left: term.left, right: term.right };
  if (term.kind === "lt") return { kind: "ge", left: term.left, right: term.right };
  if (term.kind === "le") return { kind: "gt", left: term.left, right: term.right };
  if (term.kind === "gt") return { kind: "le", left: term.left, right: term.right };
  if (term.kind === "ge") return { kind: "lt", left: term.left, right: term.right };
  if (term.kind === "and") {
    const left = negateLit(term.left);
    const right = negateLit(term.right);
    if (left === null || right === null) return null;
    return { kind: "or", left: left, right: right };
  }
  if (term.kind === "or") {
    const left = negateLit(term.left);
    const right = negateLit(term.right);
    if (left === null || right === null) return null;
    return { kind: "and", left: left, right: right };
  }
  return null;
}

function andKids(term: Term, out: Term[]): void {
  if (term.kind === "and") {
    andKids(term.left, out);
    andKids(term.right, out);
    return;
  }
  out.push(term);
}

function andTerms(terms: Term[]): Term {
  let acc = terms[0];
  for (let i = 1; i < terms.length; i++) acc = { kind: "and", left: acc, right: terms[i] };
  return acc;
}

function orTerms(terms: Term[]): Term {
  let acc = terms[0];
  for (let i = 1; i < terms.length; i++) acc = { kind: "or", left: acc, right: terms[i] };
  return acc;
}

function possible(spec: Spec, term: Term): boolean {
  const probe: Requirement = {
    id: "probe",
    line: 0,
    sentence: "",
    system: "",
    antecedent: null,
    consequent: term,
    hasWhen: false,
    hasIf: false,
    whenTerm: null,
  };
  const holds: Requirement[] = [];
  holds.push(probe);
  return satisfiable(spec, holds);
}

function editOf(
  op: string,
  id: string,
  sentence: string,
  kind: string,
  proposalId: string,
  before: string,
  after: string,
  cleared: string[],
  because: string[],
  note: string,
  conflict: string,
  vacuousId: string,
  gapName: string,
): Edit {
  return {
    op: op,
    id: id,
    sentence: sentence,
    conflictKey: conflict,
    vacuousId: vacuousId,
    gapName: gapName,
    proposal: {
      id: proposalId,
      kind: kind,
      before: before,
      after: after,
      cleared: cleared,
      because: because,
      note: note,
    },
  };
}

function normIds(ids: string[]): string {
  const copy: string[] = [];
  for (let i = 0; i < ids.length; i++) copy.push(trimLine(ids[i]));
  sortIds(copy);
  let out = "";
  for (let i = 0; i < copy.length; i++) {
    if (i > 0) out += ",";
    out += copy[i];
  }
  return out;
}

function normKey(key: string): string {
  const ids: string[] = [];
  let start = 0;
  for (let i = 0; i <= key.length; i++) {
    if (i === key.length || key.charCodeAt(i) === 44) {
      if (i > start) ids.push(key.slice(start, i));
      start = i + 1;
    }
  }
  return normIds(ids);
}

function sortIds(ids: string[]): void {
  for (let i = 1; i < ids.length; i++) {
    const item = ids[i];
    let j = i;
    while (j > 0 && idBefore(item, ids[j - 1])) {
      ids[j] = ids[j - 1];
      j--;
    }
    ids[j] = item;
  }
}

function idBefore(left: string, right: string): boolean {
  const a = idNumber(left);
  const b = idNumber(right);
  if (a !== b) return a < b;
  return left < right;
}

function joinIds(ids: string[]): string {
  let out = "";
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) out += ", ";
    out += ids[i];
  }
  return out;
}

function joinWords(ids: string[]): string {
  if (ids.length === 0) return "none";
  return joinIds(ids);
}

function hasKey(keys: string[], key: string): boolean {
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === key) return true;
  }
  return false;
}

function hasWord(words: string[], word: string): boolean {
  for (let i = 0; i < words.length; i++) {
    if (words[i] === word) return true;
  }
  return false;
}
