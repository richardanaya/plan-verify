/**
 * Why a scenario breaks a requirement, and the smallest input, state,
 * or event change that makes every requirement hold.
 * Outputs stay at the values in the scenario.
 */

import { evaluate, type Violation } from "./check.ts";
import { codeAt, displayCode, domainSize, findEnum, isDriver, type Requirement, type Spec, type SymbolDecl, type Term } from "./spec.ts";
import { Binding, evalBool, T_TRUE } from "./term.ts";
import { formatInt } from "./text.ts";

export interface AtomReading {
  text: string;
  held: boolean;
  actual: string;
}

export interface ValueReading {
  name: string;
  value: string;
}

export interface FlipChange {
  name: string;
  from: string;
  to: string;
}

export interface Explanation {
  id: string;
  line: number;
  sentence: string;
  conditions: AtomReading[];
  actuals: ValueReading[];
  because: string;
  flip: FlipChange[] | null;
  file: string;
}

interface Change {
  index: number;
  from: number;
  to: number;
}

export function explainScenario(spec: Spec, env: Binding, violations: Violation[]): Explanation[] {
  const found: Explanation[] = [];
  for (let i = 0; i < violations.length; i++) {
    const violation = violations[i];
    const req = requirementById(spec, violation.id);
    if (req === null) continue;
    found.push(explainOne(spec, env, req));
  }
  return found;
}

export function formatExplainText(specPath: string, scenarioPath: string, violations: Violation[], explanations: Explanation[]): string {
  if (violations.length === 0) return checkHeader(specPath, scenarioPath, 0);
  const lines: string[] = [];
  lines.push(checkHeader(specPath, scenarioPath, violations.length));
  for (let i = 0; i < explanations.length; i++) {
    lines.push("");
    pushBlock(lines, explanations[i]);
  }
  return lines.join("\n");
}

export function formatWhyText(explanations: Explanation[]): string {
  const lines: string[] = [];
  for (let i = 0; i < explanations.length; i++) {
    if (i > 0) lines.push("");
    pushBlock(lines, explanations[i]);
  }
  return lines.join("\n");
}

export function formatExplainJson(specPath: string, scenarioPath: string, violations: Violation[], explanations: Explanation[]): string {
  const rows = [];
  for (let i = 0; i < violations.length; i++) {
    const item = violations[i];
    rows.push({ id: item.id, line: item.line, sentence: item.sentence, because: item.because });
  }
  const explained = [];
  for (let i = 0; i < explanations.length; i++) {
    const item = explanations[i];
    explained.push({
      id: item.id,
      line: item.line,
      sentence: item.sentence,
      conditions: item.conditions,
      actuals: item.actuals,
      because: item.because,
      flip: item.flip,
    });
  }
  return JSON.stringify(
    {
      ok: violations.length === 0,
      spec: specPath,
      scenario: scenarioPath,
      violations: rows,
      explanations: explained,
    },
    null,
    2,
  );
}

export function scenarioBody(spec: Spec, env: Binding, changes: FlipChange[]): string {
  const codes: number[] = [];
  for (let i = 0; i < spec.symbols.length; i++) codes.push(env.code[i]);
  for (let i = 0; i < changes.length; i++) {
    const index = symbolIndex(spec, changes[i].name);
    if (index < 0) continue;
    codes[index] = codeFromShown(spec, spec.symbols[index], changes[i].to);
  }
  let out = "{\n";
  for (let i = 0; i < spec.symbols.length; i++) {
    if (i > 0) out += ",\n";
    out += "  " + jsonString(spec.symbols[i].name) + ": " + jsonCode(spec, spec.symbols[i], codes[i]);
  }
  out += "\n}\n";
  return out;
}

function explainOne(spec: Spec, env: Binding, req: Requirement): Explanation {
  const atoms: Term[] = [];
  if (req.antecedent !== null) collectAtoms(req.antecedent, atoms);
  const conditions: AtomReading[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    const held = evalBool(atom, spec, env) === T_TRUE;
    conditions.push({ text: atomText(spec, atom), held: held, actual: actualText(spec, env, atom) });
  }
  const actuals = consequentActuals(spec, env, req.consequent);
  const because = becauseLine(req.antecedent !== null, conditions, actuals);
  const changes = minimalFlip(spec, env, req);
  const flip = changes === null ? null : showChanges(spec, changes);
  return {
    id: req.id,
    line: req.line,
    sentence: req.sentence,
    conditions: conditions,
    actuals: actuals,
    because: because,
    flip: flip,
    file: "",
  };
}

function becauseLine(hasTrigger: boolean, conditions: AtomReading[], actuals: ValueReading[]): string {
  let shall = "";
  for (let i = 0; i < actuals.length; i++) {
    if (i > 0) shall += " and ";
    shall += actuals[i].name + " stayed " + actuals[i].value;
  }
  if (shall.length === 0) shall = "the response stayed false";
  const shallClause = "SHALL failed because " + shall;
  if (!hasTrigger) return shallClause;
  let held = "";
  for (let i = 0; i < conditions.length; i++) {
    if (!conditions[i].held) continue;
    if (held.length > 0) held += " and ";
    held += conditions[i].actual;
  }
  if (held.length === 0) return shallClause;
  return "trigger held because " + held + "; " + shallClause;
}

function pushBlock(lines: string[], item: Explanation): void {
  lines.push(item.id + " line " + formatInt(item.line));
  lines.push(item.sentence);
  lines.push("conditions:");
  if (item.conditions.length === 0) lines.push("  none");
  for (let i = 0; i < item.conditions.length; i++) {
    const cond = item.conditions[i];
    lines.push("  " + cond.text + ": " + (cond.held ? "true" : "false"));
  }
  lines.push("shall:");
  if (item.actuals.length === 0) lines.push("  none");
  for (let i = 0; i < item.actuals.length; i++) {
    lines.push("  " + item.actuals[i].name + ": " + item.actuals[i].value);
  }
  lines.push("because: " + item.because);
  if (item.flip === null) lines.push("flip: none");
  else {
    lines.push("flip:");
    for (let i = 0; i < item.flip.length; i++) {
      const change = item.flip[i];
      lines.push("  " + change.name + ": " + change.from + " -> " + change.to);
    }
  }
  if (item.file.length > 0) lines.push("wrote: " + item.file);
}

function checkHeader(specPath: string, scenarioPath: string, count: number): string {
  return "spec: " + specPath + "\nscenario: " + scenarioPath + "\nviolations: " + formatInt(count);
}

function collectAtoms(term: Term, out: Term[]): void {
  if (term.kind === "and" || term.kind === "or") {
    collectAtoms(term.left, out);
    collectAtoms(term.right, out);
    return;
  }
  out.push(term);
}

function consequentActuals(spec: Spec, env: Binding, term: Term): ValueReading[] {
  const indexes: number[] = [];
  collectSymbolIndexes(term, indexes);
  const found: ValueReading[] = [];
  for (let i = 0; i < indexes.length; i++) {
    let seen = false;
    for (let j = 0; j < found.length; j++) {
      if (found[j].name === spec.symbols[indexes[i]].name) seen = true;
    }
    if (seen) continue;
    found.push({ name: spec.symbols[indexes[i]].name, value: displayCode(spec, spec.symbols[indexes[i]], env.code[indexes[i]]) });
  }
  return found;
}

function actualText(spec: Spec, env: Binding, term: Term): string {
  const indexes: number[] = [];
  collectSymbolIndexes(term, indexes);
  let out = "";
  for (let i = 0; i < indexes.length; i++) {
    let seen = false;
    for (let j = 0; j < i; j++) {
      if (indexes[j] === indexes[i]) seen = true;
    }
    if (seen) continue;
    if (out.length > 0) out += " and ";
    const sym = spec.symbols[indexes[i]];
    out += sym.name + "=" + displayCode(spec, sym, env.code[indexes[i]]);
  }
  if (out.length > 0) return out;
  return atomText(spec, term);
}

function atomText(spec: Spec, term: Term): string {
  if (term.kind === "sym") return term.name;
  if (term.kind === "not") {
    if (term.term.kind === "sym") return "not " + term.term.name;
    return "not " + atomText(spec, term.term);
  }
  if (
    term.kind === "eq" ||
    term.kind === "neq" ||
    term.kind === "lt" ||
    term.kind === "le" ||
    term.kind === "gt" ||
    term.kind === "ge"
  ) {
    const left = term.left.kind === "sym" ? term.left.name : atomText(spec, term.left);
    return left + " " + cmpOp(term) + " " + valueText(spec, term.right);
  }
  return formatFallback(term);
}

function cmpOp(term: Term): string {
  if (term.kind === "eq") return "=";
  if (term.kind === "neq") return "!=";
  if (term.kind === "lt") return "<";
  if (term.kind === "le") return "<=";
  if (term.kind === "gt") return ">";
  if (term.kind === "ge") return ">=";
  return "?";
}

function valueText(spec: Spec, term: Term): string {
  if (term.kind === "sym") return term.name;
  if (term.kind === "int") return formatInt(term.value);
  if (term.kind === "enum") return term.variant;
  if (term.kind === "bool") return term.value ? "true" : "false";
  return formatFallback(term);
}

function formatFallback(term: Term): string {
  if (term.kind === "sym") return term.name;
  if (term.kind === "int") return formatInt(term.value);
  if (term.kind === "bool") return term.value ? "true" : "false";
  if (term.kind === "enum") return term.variant;
  if (term.kind === "not") return "not " + formatFallback(term.term);
  if (term.kind === "and") return formatFallback(term.left) + " and " + formatFallback(term.right);
  if (term.kind === "or") return formatFallback(term.left) + " or " + formatFallback(term.right);
  if (
    term.kind === "eq" ||
    term.kind === "neq" ||
    term.kind === "lt" ||
    term.kind === "le" ||
    term.kind === "gt" ||
    term.kind === "ge"
  ) {
    return formatFallback(term.left) + " " + cmpOp(term) + " " + formatFallback(term.right);
  }
  if (term.kind === "add") return formatFallback(term.left) + " + " + formatFallback(term.right);
  if (term.kind === "sub") return formatFallback(term.left) + " - " + formatFallback(term.right);
  return "?";
}

function collectSymbolIndexes(term: Term, found: number[]): void {
  if (term.kind === "sym") {
    found.push(term.index);
    return;
  }
  if (term.kind === "not") {
    collectSymbolIndexes(term.term, found);
    return;
  }
  if (
    term.kind === "and" ||
    term.kind === "or" ||
    term.kind === "eq" ||
    term.kind === "neq" ||
    term.kind === "lt" ||
    term.kind === "le" ||
    term.kind === "gt" ||
    term.kind === "ge" ||
    term.kind === "add" ||
    term.kind === "sub"
  ) {
    collectSymbolIndexes(term.left, found);
    collectSymbolIndexes(term.right, found);
  }
}

function minimalFlip(spec: Spec, env: Binding, req: Requirement): Change[] | null {
  const drivers: number[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    if (isDriver(spec.symbols[i])) drivers.push(i);
  }
  if (drivers.length === 0) return null;
  const mentioned: number[] = [];
  if (req.antecedent !== null) collectSymbolIndexes(req.antecedent, mentioned);
  collectSymbolIndexes(req.consequent, mentioned);
  let best: Change[] | null = null;
  for (let size = 1; size <= drivers.length; size++) {
    best = searchSize(spec, env, drivers, mentioned, size, best);
    if (best !== null) return best;
  }
  return null;
}

function searchSize(
  spec: Spec,
  env: Binding,
  drivers: number[],
  mentioned: number[],
  size: number,
  best: Change[] | null,
): Change[] | null {
  const pick: number[] = [];
  for (let i = 0; i < size; i++) pick.push(i);
  while (true) {
    best = searchValues(spec, env, drivers, pick, 0, [], mentioned, best);
    if (!advance(pick, drivers.length)) break;
  }
  return best;
}

function advance(pick: number[], n: number): boolean {
  const size = pick.length;
  for (let i = size - 1; i >= 0; i--) {
    const limit = n - (size - i);
    if (pick[i] < limit) {
      pick[i]++;
      for (let j = i + 1; j < size; j++) pick[j] = pick[j - 1] + 1;
      return true;
    }
  }
  return false;
}

function searchValues(
  spec: Spec,
  env: Binding,
  drivers: number[],
  pick: number[],
  at: number,
  chosen: Change[],
  mentioned: number[],
  best: Change[] | null,
): Change[] | null {
  if (at >= pick.length) {
    if (!satisfies(spec, env, chosen)) return best;
    if (best === null || betterFlip(mentioned, chosen, best)) return copyChanges(chosen);
    return best;
  }
  const index = drivers[pick[at]];
  const alts = alternates(spec, index, env.code[index]);
  for (let i = 0; i < alts.length; i++) {
    chosen.push({ index: index, from: env.code[index], to: alts[i] });
    best = searchValues(spec, env, drivers, pick, at + 1, chosen, mentioned, best);
    chosen.pop();
  }
  return best;
}

function alternates(spec: Spec, index: number, current: number): number[] {
  const sym = spec.symbols[index];
  const count = domainSize(spec, sym);
  const found: number[] = [];
  for (let i = 0; i < count; i++) {
    const code = codeAt(sym, i);
    if (code !== current) found.push(code);
  }
  return found;
}

function satisfies(spec: Spec, env: Binding, changes: Change[]): boolean {
  const next = env.copy();
  for (let i = 0; i < changes.length; i++) next.code[changes[i].index] = changes[i].to;
  return evaluate(spec, next).length === 0;
}

function betterFlip(mentioned: number[], left: Change[], right: Change[]): boolean {
  if (left.length !== right.length) return left.length < right.length;
  const leftOut = outsideCount(mentioned, left);
  const rightOut = outsideCount(mentioned, right);
  if (leftOut !== rightOut) return leftOut < rightOut;
  const a = sortedChanges(left);
  const b = sortedChanges(right);
  for (let i = 0; i < a.length; i++) {
    if (a[i].index !== b[i].index) return a[i].index < b[i].index;
    if (a[i].to !== b[i].to) return a[i].to < b[i].to;
  }
  return false;
}

function outsideCount(mentioned: number[], changes: Change[]): number {
  let count = 0;
  for (let i = 0; i < changes.length; i++) {
    if (!hasIndex(mentioned, changes[i].index)) count++;
  }
  return count;
}

function hasIndex(indexes: number[], value: number): boolean {
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] === value) return true;
  }
  return false;
}

function sortedChanges(changes: Change[]): Change[] {
  const copy = copyChanges(changes);
  for (let i = 1; i < copy.length; i++) {
    const item = copy[i];
    let j = i;
    while (j > 0 && copy[j - 1].index > item.index) {
      copy[j] = copy[j - 1];
      j--;
    }
    copy[j] = item;
  }
  return copy;
}

function copyChanges(changes: Change[]): Change[] {
  const copy: Change[] = [];
  for (let i = 0; i < changes.length; i++) {
    copy.push({ index: changes[i].index, from: changes[i].from, to: changes[i].to });
  }
  return copy;
}

function showChanges(spec: Spec, changes: Change[]): FlipChange[] {
  const ordered = sortedChanges(changes);
  const found: FlipChange[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const sym = spec.symbols[ordered[i].index];
    found.push({
      name: sym.name,
      from: displayCode(spec, sym, ordered[i].from),
      to: displayCode(spec, sym, ordered[i].to),
    });
  }
  return found;
}

function requirementById(spec: Spec, id: string): Requirement | null {
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].id === id) return spec.requirements[i];
  }
  return null;
}

function symbolIndex(spec: Spec, name: string): number {
  for (let i = 0; i < spec.symbols.length; i++) {
    if (spec.symbols[i].name === name) return i;
  }
  return -1;
}

function codeFromShown(spec: Spec, sym: SymbolDecl, shown: string): number {
  if (sym.sort.kind === "bool") return shown === "true" ? 1 : 0;
  if (sym.sort.kind === "int") {
    let sign = 1;
    let start = 0;
    if (shown.length > 0 && shown.charAt(0) === "-") {
      sign = -1;
      start = 1;
    }
    let value = 0;
    for (let i = start; i < shown.length; i++) value = value * 10 + (shown.charCodeAt(i) - 48);
    return sign * value;
  }
  const decl = findEnum(spec, sym.sort.enumName);
  if (decl === null) return 0;
  for (let i = 0; i < decl.variants.length; i++) {
    if (decl.variants[i] === shown) return i;
  }
  return 0;
}

function jsonCode(spec: Spec, sym: SymbolDecl, code: number): string {
  if (sym.sort.kind === "bool") return code === 1 ? "true" : "false";
  if (sym.sort.kind === "int") return formatInt(code);
  return jsonString(displayCode(spec, sym, code));
}

function jsonString(text: string): string {
  let out = "\"";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\\" || ch === "\"") out += "\\";
    out += ch;
  }
  out += "\"";
  return out;
}
