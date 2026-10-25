/**
 * Lint a spec for contradictions, uncovered outputs, events nobody handles,
 * error conditions with no response, EARS pattern mistakes, words a test
 * cannot pin down, conditions that can never be true, and schema the
 * requirements never use. Unreachable requirements stay errors. Redundant
 * requirements, outputs and states no requirement constrains, and enum
 * values a constrained output can never produce stay warnings, along with
 * vague words, weak modals, a response that names two outputs, and a result
 * that constrains no output. Those warnings do not by themselves fail the
 * command. Contradiction reports name the smallest set, the
 * situation, an example, and candidate repairs that do not pick a winner.
 */

import { describeAssignment, displayCode, findEnum, isDriver, literalShown, reportBool, requirementMentions, speakBound, termMentions, type Requirement, type Spec, type SymbolDecl, type Term } from "./spec.ts";
import { satisfiable } from "./decide.ts";
import { conflictKey, findRepairs, GroupCores, type Repair } from "./repair.ts";
import { bestGap, conflictingSets, implyingIds, modelFor, redundantFlags, scanRequirements, spaceSize, type ConflictGroup } from "./solver.ts";
import { Binding, evalAssertion, evalBool, formatScenario, formatTerm, termsEqual, T_FALSE, T_TRUE, T_UNKNOWN } from "./term.ts";
import { displayQuote, englishList, formatInt, pastVoice } from "./text.ts";

interface WordRule {
  word: string;
  kind: string;
}

const WORD_RULES: WordRule[] = [
  { word: "as needed", kind: "vague" },
  { word: "user-friendly", kind: "vague" },
  { word: "appropriate", kind: "vague" },
  { word: "efficient", kind: "vague" },
  { word: "flexible", kind: "vague" },
  { word: "quickly", kind: "vague" },
  { word: "robust", kind: "vague" },
  { word: "large", kind: "vague" },
  { word: "small", kind: "vague" },
  { word: "fast", kind: "vague" },
  { word: "slow", kind: "vague" },
  { word: "easy", kind: "vague" },
  { word: "microservice", kind: "solution" },
  { word: "algorithm", kind: "solution" },
  { word: "database", kind: "solution" },
  { word: "function", kind: "solution" },
  { word: "server", kind: "solution" },
  { word: "class", kind: "solution" },
  { word: "api", kind: "solution" },
];

export interface NameValue {
  name: string;
  value: string;
}

export interface Conflict {
  ids: string[];
  lines: number[];
  sentences: string[];
  minimal: boolean;
  everySituation: boolean;
  situation: NameValue[];
  requires: NameValue[];
  example: NameValue[];
  exampleJson: string;
  keeps: string[];
  breaks: string;
  summary: string;
  clash: string;
  fix: string;
  keepsSentence: string;
  repairs: Repair[];
}

export interface Gap {
  output: string;
  situation: NameValue[];
  text: string;
}

export interface Misuse {
  id: string;
  line: number;
  symbols: string[];
  sentence: string;
  text: string;
}

export interface Wording {
  line: number;
  word: string;
  kind: string;
  text: string;
  context: string;
}

export interface Redundant {
  id: string;
  line: number;
  sentence: string;
  text: string;
  fix: string;
  impliedBy: string[];
}

export interface Duplicate {
  id: string;
  line: number;
  sameAs: string;
  sentence: string;
  text: string;
  fix: string;
}

export interface Vacuous {
  id: string;
  line: number;
  sentence: string;
  text: string;
  fix: string;
  because: string[];
}

export interface Uncovered {
  name: string;
  kind: string;
  text: string;
  fix: string;
}

export interface Unused {
  name: string;
  kind: string;
  text: string;
  fix: string;
}

export interface Warning {
  id: string;
  line: number;
  sentence: string;
  kind: string;
  word: string;
  text: string;
  fix: string;
}

export interface LintReport {
  conflicts: Conflict[];
  gaps: Gap[];
  misuse: Misuse[];
  wording: Wording[];
  redundant: Redundant[];
  duplicate: Duplicate[];
  vacuous: Vacuous[];
  unused: Unused[];
  uncovered: Uncovered[];
  warnings: Warning[];
}

export type LintOutcome = { kind: "report"; report: LintReport } | { kind: "error"; message: string };

export function lintSpec(spec: Spec): LintOutcome {
  if (spaceSize(spec) < 0) {
    return {
      kind: "error",
      message: "a symbol has an empty domain. Declare at least one allowed value.",
    };
  }
  const conflicts: Conflict[] = [];
  const groups = conflictingSets(spec);
  const originalKeys: string[] = [];
  for (let i = 0; i < groups.length; i++) originalKeys.push(conflictKey(spec, groups[i].indexes));
  const earlier = earlierDuplicate(spec);
  const cores = new GroupCores(spec);
  for (let i = 0; i < groups.length; i++) conflicts.push(explainConflict(spec, groups[i], originalKeys, cores));
  const gaps: Gap[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    if (isDriver(spec.symbols[i])) continue;
    const situation = bestGap(spec, i);
    if (situation === null) continue;
    gaps.push(explainGap(spec, i, situation));
  }
  for (let i = 0; i < spec.symbols.length; i++) {
    if (spec.symbols[i].role !== "event") continue;
    if (eventMentioned(spec, i)) continue;
    gaps.push(explainUnhandled(spec, i));
  }
  const uncovered = findUncovered(spec, groups.length > 0);
  return {
    kind: "report",
    report: {
      conflicts: conflicts,
      gaps: gaps,
      misuse: findMisuse(spec),
      wording: findWording(spec),
      redundant: findRedundant(spec, groups, earlier),
      duplicate: findDuplicates(spec, earlier),
      vacuous: findVacuous(spec),
      unused: findUnused(spec, uncovered),
      uncovered: uncovered,
      warnings: findWarnings(spec),
    },
  };
}

/**
 * Conflict ids and gap texts for diff. Repairs and the other lint lists are
 * not part of a diff, so this skips them. Summaries match lintSpec.
 */
export function lintFacts(spec: Spec): LintOutcome {
  if (spaceSize(spec) < 0) {
    return {
      kind: "error",
      message: "a symbol has an empty domain. Declare at least one allowed value.",
    };
  }
  const groups = conflictingSets(spec);
  const conflicts: Conflict[] = [];
  for (let i = 0; i < groups.length; i++) conflicts.push(conflictFacts(spec, groups[i]));
  const gaps: Gap[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    if (isDriver(spec.symbols[i])) continue;
    const situation = bestGap(spec, i);
    if (situation === null) continue;
    gaps.push(explainGap(spec, i, situation));
  }
  for (let i = 0; i < spec.symbols.length; i++) {
    if (spec.symbols[i].role !== "event") continue;
    if (eventMentioned(spec, i)) continue;
    gaps.push(explainUnhandled(spec, i));
  }
  const empty: Misuse[] = [];
  const noWords: Wording[] = [];
  const noRedundant: Redundant[] = [];
  const noDuplicate: Duplicate[] = [];
  const noVacuous: Vacuous[] = [];
  const noUnused: Unused[] = [];
  const noUncovered: Uncovered[] = [];
  const noWarnings: Warning[] = [];
  return {
    kind: "report",
    report: {
      conflicts: conflicts,
      gaps: gaps,
      misuse: empty,
      wording: noWords,
      redundant: noRedundant,
      duplicate: noDuplicate,
      vacuous: noVacuous,
      unused: noUnused,
      uncovered: noUncovered,
      warnings: noWarnings,
    },
  };
}

function conflictFacts(spec: Spec, group: ConflictGroup): Conflict {
  const ids: string[] = [];
  const lines: number[] = [];
  const sentences: string[] = [];
  for (let i = 0; i < group.indexes.length; i++) {
    const req = spec.requirements[group.indexes[i]];
    ids.push(req.id);
    lines.push(req.line);
    sentences.push(req.sentence);
  }
  const none: NameValue[] = [];
  const noRepairs: Repair[] = [];
  return {
    ids: ids,
    lines: lines,
    sentences: sentences,
    minimal: group.minimal,
    everySituation: false,
    situation: none,
    requires: none,
    example: none,
    exampleJson: "",
    keeps: [],
    breaks: "",
    summary: summaryText(ids, group.minimal),
    clash: "",
    fix: "",
    keepsSentence: "",
    repairs: noRepairs,
  };
}

/** Vague words that are warnings. Words already in WORD_RULES stay wording findings. */
const VAGUE_WARNINGS: string[] = [
  "appropriately",
  "reasonable",
  "adequate",
  "sufficient",
  "timely",
  "normally",
  "usually",
  "several",
  "minimal",
  "optimal",
  "some",
  "many",
  "few",
  "etc",
];

const ESCAPE_WARNINGS: string[] = ["where possible", "if possible"];

const WEAK_MODALS: string[] = ["should", "may", "might", "could", "can", "will try"];

function findWarnings(spec: Spec): Warning[] {
  const found: Warning[] = [];
  for (let i = 0; i < spec.requirements.length; i++) {
    const req = spec.requirements[i];
    collectVagueWarnings(spec, req, found);
    collectModalWarning(req, found);
    collectEscapeWarnings(spec, req, found);
    collectCompoundWarning(spec, req, found);
    collectUntestableWarning(spec, req, found);
  }
  return found;
}

function collectVagueWarnings(spec: Spec, req: Requirement, found: Warning[]): void {
  const lower = lowerAscii(req.sentence);
  let i = 0;
  while (i < lower.length) {
    if (!boundaryBefore(lower, i)) {
      i++;
      continue;
    }
    let matched = -1;
    for (let w = 0; w < VAGUE_WARNINGS.length; w++) {
      const word = VAGUE_WARNINGS[w];
      if (i + word.length > lower.length) continue;
      if (lower.slice(i, i + word.length) !== word) continue;
      if (!boundaryAfter(lower, i + word.length)) continue;
      if (matched < 0 || word.length > VAGUE_WARNINGS[matched].length) matched = w;
    }
    if (matched < 0) {
      i++;
      continue;
    }
    const word = VAGUE_WARNINGS[matched];
    const end = i + word.length;
    if (!coveredBySchema(spec, lower, i, end)) {
      found.push({
        id: req.id,
        line: req.line,
        sentence: req.sentence,
        kind: "vague",
        word: word,
        text: displayQuote(word) + " is too vague to test. Replace it with a value a scenario can check.",
        fix: "Suggested fix: replace " + displayQuote(word) + " with a declared bound.",
      });
    }
    i = end;
  }
}

function collectModalWarning(req: Requirement, found: Warning[]): void {
  const modal = responseModal(req.sentence, req.system);
  if (!weakModal(modal)) return;
  found.push({
    id: req.id,
    line: req.line,
    sentence: req.sentence,
    kind: "modal",
    word: modal,
    text: req.id + " uses " + displayQuote(modal) + " instead of \"shall\".",
    fix: "Suggested fix: write \"shall\" so the response is required.",
  });
}

function collectEscapeWarnings(spec: Spec, req: Requirement, found: Warning[]): void {
  const lower = lowerAscii(req.sentence);
  let i = 0;
  while (i < lower.length) {
    if (!boundaryBefore(lower, i)) {
      i++;
      continue;
    }
    let matched = -1;
    for (let w = 0; w < ESCAPE_WARNINGS.length; w++) {
      const word = ESCAPE_WARNINGS[w];
      if (i + word.length > lower.length) continue;
      if (lower.slice(i, i + word.length) !== word) continue;
      if (!boundaryAfter(lower, i + word.length)) continue;
      if (matched < 0 || word.length > ESCAPE_WARNINGS[matched].length) matched = w;
    }
    if (matched < 0) {
      i++;
      continue;
    }
    const word = ESCAPE_WARNINGS[matched];
    const end = i + word.length;
    if (!coveredBySchema(spec, lower, i, end)) {
      found.push({
        id: req.id,
        line: req.line,
        sentence: req.sentence,
        kind: "modal",
        word: word,
        text: req.id + " uses " + displayQuote(word) + ", which lets the response slip.",
        fix: "Suggested fix: delete " + displayQuote(word) + " and keep \"shall\".",
      });
    }
    i = end;
  }
}

function collectCompoundWarning(spec: Spec, req: Requirement, found: Warning[]): void {
  const term = req.consequent;
  if (term.kind !== "and" && term.kind !== "or") return;
  const outputs = distinctOutputs(spec, term);
  if (outputs.length < 2) return;
  const labels: string[] = [];
  for (let i = 0; i < outputs.length; i++) labels.push(outputLabel(spec.symbols[outputs[i]]));
  found.push({
    id: req.id,
    line: req.line,
    sentence: req.sentence,
    kind: "compound",
    word: term.kind,
    text: req.id + " joins " + englishList(labels) + " with \"" + term.kind + "\" in one response.",
    fix: "Suggested fix: split this into one requirement per output.",
  });
}

function collectUntestableWarning(spec: Spec, req: Requirement, found: Warning[]): void {
  if (distinctOutputs(spec, req.consequent).length > 0) return;
  const phrase = untestablePhrase(responseTail(req.sentence, req.system));
  if (phrase.length === 0) return;
  found.push({
    id: req.id,
    line: req.line,
    sentence: req.sentence,
    kind: "untestable",
    word: phrase,
    text: req.id + " says " + displayQuote(phrase) + ", and no output is constrained.",
    fix: "Suggested fix: name the output the response sets.",
  });
}

function weakModal(modal: string): boolean {
  for (let i = 0; i < WEAK_MODALS.length; i++) {
    if (WEAK_MODALS[i] === modal) return true;
  }
  return false;
}

function responseModal(sentence: string, system: string): string {
  const lower = lowerAscii(sentence);
  const mark = "the " + lowerAscii(system) + " ";
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(mark, from);
    if (at < 0) return "";
    if (!boundaryBefore(lower, at)) {
      from = at + 1;
      continue;
    }
    const start = at + mark.length;
    const first = wordAt(lower, start);
    if (first.length === 0) return "";
    if (first === "will") {
      const second = wordAt(lower, start + spanOfWord(lower, start));
      if (second === "try") return "will try";
    }
    return first;
  }
  return "";
}

function responseTail(sentence: string, system: string): string {
  const lower = lowerAscii(sentence);
  const mark = "the " + lowerAscii(system) + " ";
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(mark, from);
    if (at < 0) return "";
    if (!boundaryBefore(lower, at)) {
      from = at + 1;
      continue;
    }
    let i = at + mark.length;
    const first = wordAt(lower, i);
    i += spanOfWord(lower, i);
    if (first === "will") {
      const second = wordAt(lower, i);
      if (second === "try") i += spanOfWord(lower, i);
    }
    while (i < sentence.length && sentence.charCodeAt(i) === 32) i++;
    let end = sentence.length;
    if (end > i && sentence.charCodeAt(end - 1) === 46) end--;
    return trimSpaces(sentence.slice(i, end));
  }
  return "";
}

function spanOfWord(text: string, from: number): number {
  let i = from;
  while (i < text.length && !isWordChar(text.charCodeAt(i))) i++;
  const start = i;
  while (i < text.length && isWordChar(text.charCodeAt(i))) i++;
  return i - start + (start - from);
}

function untestablePhrase(tail: string): string {
  let lower = lowerAscii(trimSpaces(tail));
  lower = stripEscapes(lower);
  lower = trimSpaces(lower);
  if (lower === "not fail" || lower === "always work" || lower === "always works") return lower;
  return "";
}

function stripEscapes(lower: string): string {
  let out = "";
  let i = 0;
  while (i < lower.length) {
    if (boundaryBefore(lower, i)) {
      let matched = -1;
      for (let w = 0; w < ESCAPE_WARNINGS.length; w++) {
        const word = ESCAPE_WARNINGS[w];
        if (i + word.length > lower.length) continue;
        if (lower.slice(i, i + word.length) !== word) continue;
        if (!boundaryAfter(lower, i + word.length)) continue;
        matched = w;
      }
      if (matched >= 0) {
        i += ESCAPE_WARNINGS[matched].length;
        continue;
      }
    }
    out += lower.slice(i, i + 1);
    i++;
  }
  return out;
}

function distinctOutputs(spec: Spec, term: Term): number[] {
  const found: number[] = [];
  collectOutputs(spec, term, found);
  return found;
}

function collectOutputs(spec: Spec, term: Term, found: number[]): void {
  if (term.kind === "sym") {
    if (spec.symbols[term.index].role !== "output") return;
    for (let i = 0; i < found.length; i++) {
      if (found[i] === term.index) return;
    }
    found.push(term.index);
    return;
  }
  if (term.kind === "not") {
    collectOutputs(spec, term.term, found);
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
    collectOutputs(spec, term.left, found);
    collectOutputs(spec, term.right, found);
  }
}

function outputLabel(sym: SymbolDecl): string {
  if (sym.phrase.length > 0) return displayQuote(sym.phrase);
  return sym.name;
}

export function findVacuous(spec: Spec): Vacuous[] {
  const ubiquitous: number[] = [];
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].antecedent === null) ubiquitous.push(i);
  }
  const found: Vacuous[] = [];
  for (let i = 0; i < spec.requirements.length; i++) {
    const req = spec.requirements[i];
    if (req.antecedent === null) continue;
    const because = unreachableBecause(spec, req, ubiquitous);
    if (because === null) continue;
    found.push({
      id: req.id,
      line: req.line,
      sentence: req.sentence,
      text: req.id + " can never trigger. Its condition is impossible for every allowed value.",
      fix:
        "Suggested fix: rewrite the condition in " +
        req.id +
        " so a real situation can make it true, or remove the requirement. Do not invent a response.",
      because: because,
    });
  }
  return found;
}

function requirementVacuous(spec: Spec, req: Requirement): boolean {
  if (req.antecedent === null) return false;
  const ubiquitous: number[] = [];
  for (let i = 0; i < spec.requirements.length; i++) {
    if (spec.requirements[i].antecedent === null && spec.requirements[i].id !== req.id) ubiquitous.push(i);
  }
  return unreachableBecause(spec, req, ubiquitous) !== null;
}

function unreachableBecause(spec: Spec, req: Requirement, ubiquitous: number[]): string[] | null {
  if (req.antecedent === null) return null;
  if (!conditionPossible(spec, req.antecedent)) return schemaBecause(spec, req.antecedent);
  const others: number[] = [];
  for (let i = 0; i < ubiquitous.length; i++) {
    if (spec.requirements[ubiquitous[i]].id !== req.id) others.push(ubiquitous[i]);
  }
  if (others.length === 0) return null;
  if (triggerPossible(spec, req.antecedent, others)) return null;
  const kept = shrinkBlockers(spec, req.antecedent, others);
  const because: string[] = [];
  for (let i = 0; i < kept.length; i++) because.push(spec.requirements[kept[i]].id);
  if (because.length === 0) because.push("the condition contradicts itself");
  return because;
}

function schemaBecause(spec: Spec, antecedent: Term): string[] {
  const mentioned: number[] = [];
  collectIntSymbols(spec, antecedent, mentioned);
  if (mentioned.length === 0) {
    const self: string[] = [];
    self.push("the condition contradicts itself");
    return self;
  }
  if (!conditionPossible(widenInts(spec, mentioned), antecedent)) {
    const self: string[] = [];
    self.push("the condition contradicts itself");
    return self;
  }
  const tight: number[] = [];
  for (let i = 0; i < mentioned.length; i++) tight.push(mentioned[i]);
  for (let i = 0; i < mentioned.length; i++) {
    const trial: number[] = [];
    for (let k = 0; k < tight.length; k++) {
      if (tight[k] !== mentioned[i]) trial.push(tight[k]);
    }
    const widened: number[] = [];
    for (let m = 0; m < mentioned.length; m++) {
      let stay = false;
      for (let t = 0; t < trial.length; t++) {
        if (trial[t] === mentioned[m]) stay = true;
      }
      if (!stay) widened.push(mentioned[m]);
    }
    if (!conditionPossible(widenInts(spec, widened), antecedent)) {
      tight.length = 0;
      for (let t = 0; t < trial.length; t++) tight.push(trial[t]);
    }
  }
  if (tight.length === 0) {
    const self: string[] = [];
    self.push("the condition contradicts itself");
    return self;
  }
  const because: string[] = [];
  for (let i = 0; i < tight.length; i++) because.push(schemaFact(spec.symbols[tight[i]]));
  return because;
}

function schemaFact(sym: SymbolDecl): string {
  const label = sym.phrase.length > 0 ? sym.phrase : sym.name;
  if (sym.sort.kind === "int") return label + " is " + formatInt(sym.sort.min) + ".." + formatInt(sym.sort.max);
  return label;
}

function collectIntSymbols(spec: Spec, term: Term, found: number[]): void {
  if (term.kind === "sym") {
    if (spec.symbols[term.index].sort.kind !== "int") return;
    for (let i = 0; i < found.length; i++) {
      if (found[i] === term.index) return;
    }
    found.push(term.index);
    return;
  }
  if (term.kind === "not") {
    collectIntSymbols(spec, term.term, found);
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
    collectIntSymbols(spec, term.left, found);
    collectIntSymbols(spec, term.right, found);
  }
}

function widenInts(spec: Spec, indexes: number[]): Spec {
  const symbols: SymbolDecl[] = [];
  for (let i = 0; i < spec.symbols.length; i++) symbols.push(spec.symbols[i]);
  for (let n = 0; n < indexes.length; n++) {
    const at = indexes[n];
    const sym = symbols[at];
    if (sym.sort.kind !== "int") continue;
    symbols[at] = copySymbol(sym, -1000000, 1000000);
  }
  return { enums: spec.enums, symbols: symbols, requirements: spec.requirements };
}

function copySymbol(sym: SymbolDecl, min: number, max: number): SymbolDecl {
  return {
    role: sym.role,
    name: sym.name,
    sort: { kind: "int", min: min, max: max },
    description: sym.description,
    phrase: sym.phrase,
    outcomeYes: sym.outcomeYes,
    outcomeNo: sym.outcomeNo,
    action: sym.action,
    says: sym.says,
    asText: sym.asText,
    unwanted: sym.unwanted,
    line: sym.line,
    source: sym.source,
  };
}

function triggerPossible(spec: Spec, antecedent: Term, ubiquitous: number[]): boolean {
  const holds: Requirement[] = [];
  holds.push(probeFor(antecedent));
  for (let i = 0; i < ubiquitous.length; i++) holds.push(spec.requirements[ubiquitous[i]]);
  return satisfiable(spec, holds);
}

function shrinkBlockers(spec: Spec, antecedent: Term, ubiquitous: number[]): number[] {
  const kept: number[] = [];
  for (let i = 0; i < ubiquitous.length; i++) kept.push(ubiquitous[i]);
  for (let i = 0; i < ubiquitous.length; i++) {
    const trial: number[] = [];
    for (let k = 0; k < kept.length; k++) {
      if (kept[k] !== ubiquitous[i]) trial.push(kept[k]);
    }
    if (triggerPossible(spec, antecedent, trial)) continue;
    kept.length = 0;
    for (let k = 0; k < trial.length; k++) kept.push(trial[k]);
  }
  return kept;
}

function probeFor(term: Term): Requirement {
  return {
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
}

function conditionPossible(spec: Spec, term: Term): boolean {
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

function findUnused(spec: Spec, uncovered: Uncovered[]): Unused[] {
  const found: Unused[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    const sym = spec.symbols[i];
    if (sym.role === "event" || sym.role === "state" || sym.role === "output") continue;
    if (symbolMentioned(spec, i)) continue;
    const label = symbolLabel(sym);
    found.push({
      name: sym.name,
      kind: sym.role,
      text: label + " is " + article(sym.role) + " " + sym.role + " and no requirement mentions it.",
      fix: "Suggested fix: use " + sym.name + " in a requirement, or remove it from the schema.",
    });
  }
  for (let e = 0; e < spec.enums.length; e++) {
    const decl = spec.enums[e];
    for (let v = 0; v < decl.variants.length; v++) {
      const variant = decl.variants[v];
      if (variantMentioned(spec, decl.name, variant)) continue;
      const name = decl.name + "." + variant;
      if (uncoveredHas(uncovered, name)) continue;
      found.push({
        name: name,
        kind: "variant",
        text: name + " is never mentioned.",
        fix: "Suggested fix: use " + variant + " in a requirement, or remove it from " + decl.name + ".",
      });
    }
  }
  return found;
}

function article(role: string): string {
  if (role === "input") return "an";
  return "a";
}

function symbolLabel(sym: SymbolDecl): string {
  if (sym.phrase.length > 0) return sym.name + " (" + displayQuote(sym.phrase) + ")";
  return sym.name;
}

function symbolMentioned(spec: Spec, index: number): boolean {
  for (let r = 0; r < spec.requirements.length; r++) {
    if (requirementMentions(spec.requirements[r], index)) return true;
  }
  return false;
}

function consequentMentions(spec: Spec, index: number): boolean {
  for (let r = 0; r < spec.requirements.length; r++) {
    if (termMentions(spec.requirements[r].consequent, index)) return true;
  }
  return false;
}

function variantMentioned(spec: Spec, enumName: string, variant: string): boolean {
  for (let r = 0; r < spec.requirements.length; r++) {
    const req = spec.requirements[r];
    if (req.antecedent !== null && termHasVariant(req.antecedent, enumName, variant)) return true;
    if (termHasVariant(req.consequent, enumName, variant)) return true;
  }
  return false;
}

function termHasVariant(term: Term, enumName: string, variant: string): boolean {
  if (term.kind === "enum") return term.enumName === enumName && term.variant === variant;
  if (term.kind === "not") return termHasVariant(term.term, enumName, variant);
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
    return termHasVariant(term.left, enumName, variant) || termHasVariant(term.right, enumName, variant);
  }
  return false;
}

function findRedundant(spec: Spec, groups: ConflictGroup[], earlier: number[]): Redundant[] {
  const eligible: boolean[] = [];
  for (let i = 0; i < spec.requirements.length; i++) eligible.push(earlier[i] < 0);
  for (let g = 0; g < groups.length; g++) {
    const indexes = groups[g].indexes;
    for (let k = 0; k < indexes.length; k++) eligible[indexes[k]] = false;
  }
  const narrowed = groups.length > 0;
  const flags = redundantFlags(spec, eligible);
  const found: Redundant[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const req = spec.requirements[i];
    if (requirementVacuous(spec, req)) continue;
    const impliedBy = implyingIds(spec, i, eligible);
    const held = narrowed
      ? "Whenever the requirements outside a conflict hold, "
      : "Whenever the other requirements hold, ";
    const who = impliesClause(impliedBy);
    found.push({
      id: req.id,
      line: req.line,
      sentence: req.sentence,
      text: req.id + " adds nothing. " + who + held + req.id + " holds too.",
      fix:
        "Suggested fix: remove " +
        req.id +
        ", or ask whether it was meant to say something the others do not already require. Do not delete it until the PM agrees.",
      impliedBy: impliedBy,
    });
  }
  return found;
}

function impliesClause(ids: string[]): string {
  if (ids.length === 0) return "The other requirements imply it. ";
  if (ids.length === 1) return ids[0] + " implies it. ";
  return englishList(ids) + " imply it. ";
}

function findUncovered(spec: Spec, hasConflict: boolean): Uncovered[] {
  const found: Uncovered[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    const sym = spec.symbols[i];
    if (sym.role === "state") {
      if (symbolMentioned(spec, i)) continue;
      const label = symbolLabel(sym);
      found.push({
        name: sym.name,
        kind: "state",
        text: "No requirement constrains " + label + ".",
        fix: "Suggested fix: use " + sym.name + " in a requirement, or remove it from the schema.",
      });
      continue;
    }
    if (sym.role !== "output") continue;
    if (consequentMentions(spec, i)) continue;
    const label = symbolLabel(sym);
    found.push({
      name: sym.name,
      kind: "output",
      text: "No requirement constrains " + label + ".",
      fix:
        "Suggested fix: add a shall requirement that sets " +
        sym.name +
        ", or remove it from the schema. Do not choose the value.",
    });
  }
  if (hasConflict) return found;
  let needValues = false;
  for (let i = 0; i < spec.symbols.length; i++) {
    const sym = spec.symbols[i];
    if (sym.role !== "output" || sym.sort.kind !== "enum") continue;
    if (!consequentMentions(spec, i)) continue;
    needValues = true;
  }
  if (!needValues) return found;
  if (!satisfiable(spec, spec.requirements)) return found;
  for (let i = 0; i < spec.symbols.length; i++) {
    const sym = spec.symbols[i];
    if (sym.role !== "output" || sym.sort.kind !== "enum") continue;
    if (!consequentMentions(spec, i)) continue;
    const decl = findEnum(spec, sym.sort.enumName);
    if (decl === null) continue;
    for (let v = 0; v < decl.variants.length; v++) {
      if (canProduce(spec, i, decl.name, decl.variants[v], v)) continue;
      const name = decl.name + "." + decl.variants[v];
      found.push({
        name: name,
        kind: "variant",
        text: "No requirement can set " + outputLabel(sym) + " to " + decl.variants[v] + ".",
        fix: "Suggested fix: add a requirement that produces " + decl.variants[v] + ", or remove it from " + decl.name + ".",
      });
    }
  }
  return found;
}

function uncoveredHas(found: Uncovered[], name: string): boolean {
  for (let i = 0; i < found.length; i++) {
    if (found[i].name === name) return true;
  }
  return false;
}

function canProduce(spec: Spec, outputIndex: number, enumName: string, variant: string, variantIndex: number): boolean {
  const sym = spec.symbols[outputIndex];
  const probe = probeFor({
    kind: "eq",
    left: { kind: "sym", name: sym.name, index: outputIndex, phrase: sym.phrase },
    right: { kind: "enum", enumName: enumName, variant: variant, index: variantIndex },
  });
  const holds: Requirement[] = [];
  for (let i = 0; i < spec.requirements.length; i++) holds.push(spec.requirements[i]);
  holds.push(probe);
  return satisfiable(spec, holds);
}

function findDuplicates(spec: Spec, earlier: number[]): Duplicate[] {
  const found: Duplicate[] = [];
  for (let i = 0; i < earlier.length; i++) {
    if (earlier[i] < 0) continue;
    const req = spec.requirements[i];
    const prior = spec.requirements[earlier[i]];
    if (requirementVacuous(spec, req) || requirementVacuous(spec, prior)) continue;
    found.push({
      id: req.id,
      line: req.line,
      sameAs: prior.id,
      sentence: req.sentence,
      text: req.id + " duplicates " + prior.id + ". The condition and the response are the same.",
      fix:
        "Suggested fix: remove " +
        req.id +
        ", or ask whether it was meant to differ from " +
        prior.id +
        ". Do not delete it until the PM agrees.",
    });
  }
  return found;
}

function earlierDuplicate(spec: Spec): number[] {
  const earlier: number[] = [];
  const reqs = spec.requirements;
  for (let i = 0; i < reqs.length; i++) earlier.push(-1);
  for (let i = 0; i < reqs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (sameRequirement(reqs[j], reqs[i])) {
        earlier[i] = j;
        break;
      }
    }
  }
  return earlier;
}

function sameRequirement(left: Requirement, right: Requirement): boolean {
  return termsEqual(guardTerm(left), guardTerm(right)) && termsEqual(left.consequent, right.consequent);
}

function guardTerm(req: Requirement): Term {
  if (req.antecedent === null) return { kind: "bool", value: true };
  return req.antecedent;
}

function eventMentioned(spec: Spec, index: number): boolean {
  for (let r = 0; r < spec.requirements.length; r++) {
    if (requirementMentions(spec.requirements[r], index)) return true;
  }
  return false;
}

function explainUnhandled(spec: Spec, index: number): Gap {
  const sym = spec.symbols[index];
  const label = sym.phrase.length > 0 ? displayQuote(sym.phrase) : sym.name;
  if (sym.unwanted) {
    return {
      output: sym.name,
      situation: [],
      text:
        "No requirement states a response when " +
        label +
        ". Suggested fix: add an if ... then requirement, and ask what the system shall do. Do not choose the response.",
    };
  }
  return {
    output: sym.name,
    situation: [],
    text:
      "No requirement handles " +
      label +
      ". Suggested fix: add a requirement that says what the system shall do, or remove the event.",
  };
}

function explainConflict(spec: Spec, group: ConflictGroup, originalKeys: string[], cores: GroupCores): Conflict {
  const ids: string[] = [];
  const lines: number[] = [];
  const sentences: string[] = [];
  for (let i = 0; i < group.indexes.length; i++) {
    const req = spec.requirements[group.indexes[i]];
    ids.push(req.id);
    lines.push(req.line);
    sentences.push(req.sentence);
  }
  const scan = scanRequirements(spec, group.indexes);
  const situation = scan.unsat === null ? new Binding(spec.symbols.length) : scan.unsat;
  const everySituation = !scan.sawSat;
  const situationPairs = driverPairs(spec, situation);
  const active = activeRequires(spec, group.indexes, situation);
  const lastPos = group.indexes.length - 1;
  const keptIndexes: number[] = [];
  for (let i = 0; i < lastPos; i++) keptIndexes.push(group.indexes[i]);
  const exampleEnv = modelFor(spec, keptIndexes, situation);
  const examplePairs: NameValue[] = [];
  let exampleJson = "";
  let keeps: string[] = [];
  let keepsSentence = "";
  const breaks = ids[lastPos];
  if (exampleEnv !== null) {
    for (let i = 0; i < spec.symbols.length; i++) {
      examplePairs.push({ name: spec.symbols[i].name, value: displayCode(spec, spec.symbols[i], exampleEnv.code[i]) });
    }
    exampleJson = formatScenario(spec, exampleEnv);
    let faithful = true;
    for (let i = 0; i < keptIndexes.length; i++) {
      const req = spec.requirements[keptIndexes[i]];
      if (evalAssertion(req.antecedent, req.consequent, spec, exampleEnv) !== T_TRUE) faithful = false;
    }
    const broken = spec.requirements[group.indexes[lastPos]];
    if (evalAssertion(broken.antecedent, broken.consequent, spec, exampleEnv) !== T_FALSE) faithful = false;
    if (faithful) {
      for (let i = 0; i < lastPos; i++) keeps.push(ids[i]);
      keepsSentence = keepsText(keeps, breaks);
    }
  }
  const summary = summaryText(ids, group.minimal);
  const clash = clashText(spec, everySituation, situationPairs);
  const fix = fixText(ids, group.minimal);
  const repairs = findRepairs(spec, group.indexes, originalKeys, cores);
  return {
    ids: ids,
    lines: lines,
    sentences: sentences,
    minimal: group.minimal,
    everySituation: everySituation,
    situation: situationPairs,
    requires: active,
    example: examplePairs,
    exampleJson: exampleJson,
    keeps: keeps,
    breaks: breaks,
    summary: summary,
    clash: clash,
    fix: fix,
    keepsSentence: keepsSentence,
    repairs: repairs,
  };
}

function activeRequires(spec: Spec, indexes: number[], situation: Binding): NameValue[] {
  const chosen: number[] = [];
  let sawTrue = false;
  for (let i = 0; i < indexes.length; i++) {
    const req = spec.requirements[indexes[i]];
    const guard = req.antecedent === null ? T_TRUE : evalBool(req.antecedent, spec, situation);
    if (guard === T_TRUE) {
      if (!sawTrue) {
        chosen.length = 0;
        sawTrue = true;
      }
      chosen.push(indexes[i]);
    } else if (!sawTrue && guard === T_UNKNOWN) {
      chosen.push(indexes[i]);
    }
  }
  if (chosen.length === 0) {
    for (let i = 0; i < indexes.length; i++) chosen.push(indexes[i]);
  }
  const pairs: NameValue[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const req = spec.requirements[chosen[i]];
    pairs.push({ name: req.id, value: obligationValue(spec, req.consequent) });
  }
  return pairs;
}

function obligationValue(spec: Spec, term: Term): string {
  const plain = formatTerm(term);
  const voiced = voiceObligation(spec, term);
  if (voiced !== plain) return "that " + voiced;
  return plain;
}

function voiceObligation(spec: Spec, term: Term): string {
  if (term.kind === "sym") {
    const sym = spec.symbols[term.index];
    if (sym.sort.kind === "bool" && (sym.phrase.length > 0 || sym.outcomeYes.length > 0)) return reportBool(sym, true);
    return formatTerm(term);
  }
  if (term.kind === "not") {
    const inner = term.term;
    if (inner.kind === "sym") {
      const sym = spec.symbols[inner.index];
      if (sym.sort.kind === "bool" && (sym.phrase.length > 0 || sym.outcomeYes.length > 0)) return reportBool(sym, false);
    }
  }
  const spoken = voiceBound(spec, term);
  if (spoken.length > 0) return spoken;
  return pastVoice(formatTerm(term));
}

function voiceBound(spec: Spec, term: Term): string {
  if (
    term.kind !== "eq" &&
    term.kind !== "neq" &&
    term.kind !== "lt" &&
    term.kind !== "le" &&
    term.kind !== "gt" &&
    term.kind !== "ge"
  ) {
    return "";
  }
  if (term.left.kind !== "sym") return "";
  const sym = spec.symbols[term.left.index];
  if (sym.sort.kind === "bool") return "";
  const shown = literalShown(term.right);
  if (shown.length > 0) return speakBound(sym, shown, term.kind, false);
  return speakBound(sym, formatTerm(term.right), term.kind, true);
}

function explainGap(spec: Spec, outputIndex: number, situation: Binding): Gap {
  const sym = spec.symbols[outputIndex];
  const name = sym.name;
  const pairs = driverPairs(spec, situation);
  const voiced = sym.sort.kind === "bool" && (sym.phrase.length > 0 || sym.outcomeYes.length > 0);
  let text = voiced ? "Nothing says whether " + reportBool(sym, true) : "Nothing covers " + (sym.phrase.length > 0 ? sym.phrase : name);
  if (pairs.length === 0) text += ".";
  else text += " when " + pairClause(spec, pairs) + ".";
  text += " Suggested fix: add a requirement for this situation, and ask what the system shall do. Do not choose the response.";
  return { output: name, situation: pairs, text: text };
}

function findMisuse(spec: Spec): Misuse[] {
  const found: Misuse[] = [];
  for (let r = 0; r < spec.requirements.length; r++) {
    const req = spec.requirements[r];
    if (!req.hasWhen || req.hasIf || req.whenTerm === null) continue;
    const names: string[] = [];
    const labels: string[] = [];
    for (let s = 0; s < spec.symbols.length; s++) {
      if (!spec.symbols[s].unwanted) continue;
      if (!mentions(req.whenTerm, s)) continue;
      names.push(spec.symbols[s].name);
      const phrase = spec.symbols[s].phrase;
      labels.push(phrase.length > 0 ? displayQuote(phrase) : spec.symbols[s].name);
    }
    if (names.length === 0) continue;
    const label = labels.length === 1 ? labels[0] + " is an unwanted event" : englishList(labels) + " are unwanted events";
    found.push({
      id: req.id,
      line: req.line,
      symbols: names,
      sentence: req.sentence,
      text: label + ". Write if ... then, not when.",
    });
  }
  return found;
}

function findWording(spec: Spec): Wording[] {
  const found: Wording[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    collectWords(null, spec.symbols[i].description, spec.symbols[i].line, spec.symbols[i].source, found);
  }
  for (let i = 0; i < spec.requirements.length; i++) {
    collectWords(spec, spec.requirements[i].sentence, spec.requirements[i].line, spec.requirements[i].sentence, found);
    collectForm(spec, spec.requirements[i].sentence, spec.requirements[i].line, found);
  }
  return found;
}

function collectForm(spec: Spec, text: string, line: number, found: Wording[]): void {
  const lower = lowerAscii(text);
  if (hasAwkwardShall(lower)) {
    found.push({
      line: line,
      word: "shall",
      kind: "form",
      context: text,
      text:
        '"shall the ... is ..." is awkward. Write the response as a verb phrase, such as "bill at most 2 seats", and bind it with as.',
    });
  }
  if (hasBareWhen(spec, lower)) {
    found.push({
      line: line,
      word: "when",
      kind: "form",
      context: text,
      text: '"When" needs a condition with "is", not a bare verb. "When the subscription is started" is the form.',
    });
  }
  if (hasMisplacedNot(lower)) {
    found.push({
      line: line,
      word: "not",
      kind: "form",
      context: text,
      text: 'Put "not" after "is": "the customer is not cancelling", not "not the customer is cancelling".',
    });
  }
  if (hasBareNegation(lower)) {
    found.push({
      line: line,
      word: "not",
      kind: "negation",
      context: text,
      text:
        'The trigger is a bare negation. Write a positive condition, such as "When a non-member asks", or declare a positive event.',
    });
  }
}

function hasAwkwardShall(lower: string): boolean {
  const at = wordIndex(lower, "shall", 0);
  if (at < 0) return false;
  if (wordAt(lower, at + 5) !== "the") return false;
  return wordIndex(lower, "is", at + 5) >= 0;
}

function hasBareWhen(spec: Spec, lower: string): boolean {
  let from = 0;
  while (from < lower.length) {
    const at = wordIndex(lower, "when", from);
    if (at < 0) return false;
    const stop = clauseEnd(lower, at + 4);
    if (clauseHasBareVerb(spec, lower.slice(at + 4, stop))) return true;
    from = stop + 1;
  }
  return false;
}

function clauseHasBareVerb(spec: Spec, clause: string): boolean {
  const parts = splitConjuncts(clause);
  for (let i = 0; i < parts.length; i++) {
    let part = trimSpaces(parts[i]);
    if (startsWithWord(part, "not")) {
      const notAt = wordIndex(part, "not", 0);
      part = trimSpaces(part.slice(notAt + 3));
    }
    if (wordIndex(part, "is", 0) >= 0) continue;
    if (matchesResponsePhrase(spec, part)) return true;
  }
  return false;
}

function matchesResponsePhrase(spec: Spec, text: string): boolean {
  const target = trimSpaces(text);
  if (target.length === 0) return false;
  for (let i = 0; i < spec.symbols.length; i++) {
    const sym = spec.symbols[i];
    if (sym.action.length > 0 && lowerAscii(sym.action) === target) return true;
    if (sym.role === "output" && sym.phrase.length > 0 && wordIndex(lowerAscii(sym.phrase), "is", 0) < 0 && lowerAscii(sym.phrase) === target) {
      return true;
    }
  }
  return false;
}

function splitConjuncts(clause: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < clause.length) {
    const atAnd = wordIndex(clause, "and", i);
    const atOr = wordIndex(clause, "or", i);
    let at = -1;
    if (atAnd >= 0 && (atOr < 0 || atAnd <= atOr)) at = atAnd;
    else at = atOr;
    if (at < 0) break;
    parts.push(clause.slice(start, at));
    let j = at;
    while (j < clause.length && isWordChar(clause.charCodeAt(j))) j++;
    start = j;
    i = j;
  }
  parts.push(clause.slice(start));
  return parts;
}

function startsWithWord(text: string, word: string): boolean {
  const at = wordIndex(text, word, 0);
  if (at < 0) return false;
  for (let i = 0; i < at; i++) {
    if (text.charCodeAt(i) !== 32) return false;
  }
  return true;
}

function trimSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) === 32) start++;
  while (end > start && text.charCodeAt(end - 1) === 32) end--;
  return text.slice(start, end);
}

function hasBareNegation(lower: string): boolean {
  let kind = 0;
  while (kind < 4) {
    const key = triggerKey(kind);
    let from = 0;
    while (from < lower.length) {
      const at = wordIndex(lower, key, from);
      if (at < 0) break;
      const stop = clauseEnd(lower, at + key.length);
      if (clauseHasBareNot(lower.slice(at + key.length, stop))) return true;
      from = stop + 1;
    }
    kind++;
  }
  return false;
}

function triggerKey(kind: number): string {
  if (kind === 0) return "when";
  if (kind === 1) return "while";
  if (kind === 2) return "where";
  return "if";
}

function clauseHasBareNot(clause: string): boolean {
  const parts = splitConjuncts(clause);
  for (let i = 0; i < parts.length; i++) {
    const part = trimSpaces(parts[i]);
    if (!startsWithWord(part, "not")) continue;
    const notAt = wordIndex(part, "not", 0);
    const rest = trimSpaces(part.slice(notAt + 3));
    if (wordIndex(rest, "is", 0) < 0) return true;
  }
  return false;
}

function hasMisplacedNot(lower: string): boolean {
  let from = 0;
  while (from < lower.length) {
    const at = wordIndex(lower, "not", from);
    if (at < 0) return false;
    if (previousWord(lower, at) !== "is") {
      const stop = notSpanEnd(lower, at + 3);
      const span = lower.slice(at + 3, stop);
      const isAt = wordIndex(span, "is", 0);
      if (isAt >= 0 && wordAt(span, isAt + 2) !== "not") return true;
    }
    from = at + 3;
  }
  return false;
}

function clauseEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text.charCodeAt(i) === 44) return i;
  }
  return text.length;
}

function notSpanEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    if (text.charCodeAt(i) === 44) return i;
    if (isWordChar(text.charCodeAt(i))) {
      const start = i;
      while (i < text.length && isWordChar(text.charCodeAt(i))) i++;
      const word = text.slice(start, i);
      if (word === "and" || word === "or") return start;
      continue;
    }
    i++;
  }
  return text.length;
}

function wordIndex(text: string, word: string, from: number): number {
  let i = from;
  while (i < text.length) {
    while (i < text.length && !isWordChar(text.charCodeAt(i))) i++;
    if (i >= text.length) return -1;
    const start = i;
    while (i < text.length && isWordChar(text.charCodeAt(i))) i++;
    if (text.slice(start, i) === word) return start;
  }
  return -1;
}

function wordAt(text: string, from: number): string {
  let i = from;
  while (i < text.length && !isWordChar(text.charCodeAt(i))) i++;
  if (i >= text.length) return "";
  const start = i;
  while (i < text.length && isWordChar(text.charCodeAt(i))) i++;
  return text.slice(start, i);
}

function previousWord(text: string, index: number): string {
  let i = index - 1;
  while (i >= 0 && !isWordChar(text.charCodeAt(i))) i--;
  if (i < 0) return "";
  const end = i + 1;
  while (i >= 0 && isWordChar(text.charCodeAt(i))) i--;
  return text.slice(i + 1, end);
}

function collectWords(spec: Spec | null, text: string, line: number, context: string, found: Wording[]): void {
  const lower = lowerAscii(text);
  let i = 0;
  while (i < lower.length) {
    if (!boundaryBefore(lower, i)) {
      i++;
      continue;
    }
    let matched = -1;
    for (let w = 0; w < WORD_RULES.length; w++) {
      const word = WORD_RULES[w].word;
      if (lower.slice(i, i + word.length) !== word) continue;
      if (!boundaryAfter(lower, i + word.length)) continue;
      if (matched < 0 || word.length > WORD_RULES[matched].word.length) matched = w;
    }
    if (matched < 0) {
      i++;
      continue;
    }
    const rule = WORD_RULES[matched];
    const end = i + rule.word.length;
    if (spec !== null && coveredBySchema(spec, lower, i, end)) {
      i = end;
      continue;
    }
    const message =
      rule.kind === "vague"
        ? "\"" + rule.word + "\" is too vague to test. Replace it with something a scenario can check."
        : "\"" + rule.word + "\" names a solution. Say what the system must do, not how to build it.";
    found.push({ line: line, word: rule.word, kind: rule.kind, context: context, text: message });
    i = end;
  }
}

function coveredBySchema(spec: Spec, lower: string, start: number, end: number): boolean {
  for (let s = 0; s < spec.symbols.length; s++) {
    const sym = spec.symbols[s];
    if (insidePhrase(lower, start, end, sym.phrase)) return true;
    if (insidePhrase(lower, start, end, sym.action)) return true;
    if (sym.phrase.length === 0 && insidePhrase(lower, start, end, sym.name)) return true;
  }
  return false;
}

function insidePhrase(lower: string, start: number, end: number, phrase: string): boolean {
  const target = lowerAscii(phrase);
  if (target.length === 0) return false;
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(target, from);
    if (at < 0) return false;
    const after = at + target.length;
    if (boundaryBefore(lower, at) && boundaryAfter(lower, after) && start >= at && end <= after) return true;
    from = at + 1;
  }
  return false;
}

function mentions(term: import("./spec.ts").Term, index: number): boolean {
  if (term.kind === "sym") return term.index === index;
  if (term.kind === "not") return mentions(term.term, index);
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
    return mentions(term.left, index) || mentions(term.right, index);
  }
  return false;
}

function driverPairs(spec: Spec, env: Binding): NameValue[] {
  const pairs: NameValue[] = [];
  for (let i = 0; i < spec.symbols.length; i++) {
    if (!isDriver(spec.symbols[i]) || !env.known[i]) continue;
    pairs.push({ name: spec.symbols[i].name, value: displayCode(spec, spec.symbols[i], env.code[i]) });
  }
  return pairs;
}

function pairClause(spec: Spec, pairs: NameValue[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pairs.length; i++) parts.push(phrasePair(spec, pairs[i]));
  return englishList(parts);
}

function phrasePair(spec: Spec, pair: NameValue): string {
  for (let i = 0; i < spec.symbols.length; i++) {
    const sym = spec.symbols[i];
    if (sym.name !== pair.name) continue;
    return describeAssignment(sym, pair.value, pair.value === "true");
  }
  return pair.name + " is " + pair.value;
}

function summaryText(ids: string[], minimal: boolean): string {
  if (!minimal) return englishList(ids) + " cannot all hold.";
  if (ids.length === 1) return ids[0] + " cannot hold.";
  if (ids.length === 2) return ids[0] + " and " + ids[1] + " cannot both hold.";
  return englishList(ids) + " cannot all hold.";
}

function clashText(spec: Spec, everySituation: boolean, situation: NameValue[]): string {
  if (everySituation || situation.length === 0) return "They clash in every situation.";
  return "They clash when " + pairClause(spec, situation) + ".";
}

function fixText(ids: string[], minimal: boolean): string {
  if (!minimal) {
    return (
      "Suggested fix: ask which requirements should change. There are more than 12 requirements, so this is not yet the smallest conflicting set."
    );
  }
  if (ids.length === 1) {
    return (
      "Suggested fix: rewrite " +
      ids[0] +
      ". It cannot be satisfied for any allowed values. Ask what should happen instead of choosing a behavior on your own."
    );
  }
  if (ids.length === 2) {
    return (
      "Suggested fix: ask which requirement should win. To keep " +
      ids[0] +
      ", remove " +
      ids[1] +
      ". To keep " +
      ids[1] +
      ", remove " +
      ids[0] +
      "."
    );
  }
  return "Suggested fix: ask which requirement should win. Removing any one of " + englishList(ids) + " leaves the rest consistent.";
}

function keepsText(keeps: string[], breaks: string): string {
  if (keeps.length === 0) return "This scenario breaks " + breaks + ".";
  if (keeps.length === 1) return "This scenario keeps " + keeps[0] + " and breaks " + breaks + ".";
  return "This scenario keeps " + englishList(keeps) + " and breaks " + breaks + ".";
}

export function formatLintText(specPath: string, report: LintReport): string {
  const lines: string[] = [];
  lines.push("spec: " + specPath);
  lines.push("conflicts: " + formatInt(report.conflicts.length));
  lines.push("gaps: " + formatInt(report.gaps.length));
  lines.push("misuse: " + formatInt(report.misuse.length));
  lines.push("wording: " + formatInt(report.wording.length));
  lines.push("redundant: " + formatInt(report.redundant.length));
  lines.push("duplicate: " + formatInt(report.duplicate.length));
  lines.push("vacuous: " + formatInt(report.vacuous.length));
  lines.push("unused: " + formatInt(report.unused.length));
  lines.push("uncovered: " + formatInt(report.uncovered.length));
  lines.push("warnings: " + formatInt(report.warnings.length));
  for (let i = 0; i < report.conflicts.length; i++) {
    const conflict = report.conflicts[i];
    lines.push("");
    lines.push("conflict " + brace(conflict.ids));
    lines.push(conflict.summary);
    if (!conflict.minimal) {
      lines.push("There are more than 12 requirements, so this set may be bigger than the smallest clash.");
    }
    for (let r = 0; r < conflict.ids.length; r++) {
      lines.push("");
      lines.push(conflict.ids[r] + " line " + formatInt(conflict.lines[r]));
      lines.push(conflict.sentences[r]);
    }
    lines.push("");
    lines.push(conflict.clash);
    for (let r = 0; r < conflict.requires.length; r++) {
      lines.push(conflict.requires[r].name + " requires " + conflict.requires[r].value + ".");
    }
    if (conflict.exampleJson.length > 0) {
      lines.push("");
      lines.push("Example scenario:");
      lines.push(conflict.exampleJson);
      if (conflict.keepsSentence.length > 0) lines.push(conflict.keepsSentence);
    }
    lines.push("");
    lines.push(conflict.fix);
    pushRepairLines(lines, conflict.repairs);
  }
  for (let i = 0; i < report.gaps.length; i++) {
    lines.push("");
    lines.push("gap " + report.gaps[i].output);
    lines.push(report.gaps[i].text);
  }
  for (let i = 0; i < report.misuse.length; i++) {
    const item = report.misuse[i];
    lines.push("");
    lines.push("misuse " + item.id + " line " + formatInt(item.line));
    lines.push(item.text);
    lines.push(item.sentence);
  }
  for (let i = 0; i < report.wording.length; i++) {
    const item = report.wording[i];
    lines.push("");
    lines.push("wording line " + formatInt(item.line));
    lines.push(item.text);
    lines.push(item.context);
  }
  for (let i = 0; i < report.redundant.length; i++) {
    const item = report.redundant[i];
    lines.push("");
    lines.push("redundant " + item.id + " line " + formatInt(item.line));
    lines.push(item.text);
    lines.push(item.sentence);
    lines.push(item.fix);
  }
  for (let i = 0; i < report.duplicate.length; i++) {
    const item = report.duplicate[i];
    lines.push("");
    lines.push("duplicate " + item.id + " line " + formatInt(item.line));
    lines.push(item.text);
    lines.push(item.sentence);
    lines.push(item.fix);
  }
  for (let i = 0; i < report.vacuous.length; i++) {
    const item = report.vacuous[i];
    lines.push("");
    lines.push("vacuous " + item.id + " line " + formatInt(item.line));
    lines.push(item.text);
    lines.push(item.sentence);
    for (let b = 0; b < item.because.length; b++) lines.push("Blocked by " + item.because[b] + ".");
    lines.push(item.fix);
  }
  for (let i = 0; i < report.unused.length; i++) {
    const item = report.unused[i];
    lines.push("");
    lines.push("unused " + item.name);
    lines.push(item.text);
    lines.push(item.fix);
  }
  for (let i = 0; i < report.uncovered.length; i++) {
    const item = report.uncovered[i];
    lines.push("");
    lines.push("uncovered " + item.name);
    lines.push(item.text);
    lines.push(item.fix);
  }
  for (let i = 0; i < report.warnings.length; i++) {
    const item = report.warnings[i];
    lines.push("");
    lines.push("warning " + item.id + " line " + formatInt(item.line));
    lines.push(item.text);
    lines.push(item.sentence);
    lines.push(item.fix);
  }
  return lines.join("\n");
}

export function formatLintJson(specPath: string, report: LintReport): string {
  const conflicts = [];
  for (let i = 0; i < report.conflicts.length; i++) {
    const item = report.conflicts[i];
    const requirements = [];
    for (let r = 0; r < item.ids.length; r++) {
      requirements.push({ id: item.ids[r], line: item.lines[r], sentence: item.sentences[r] });
    }
    const requires = [];
    for (let r = 0; r < item.requires.length; r++) {
      requires.push({ id: item.requires[r].name, text: item.requires[r].value });
    }
    conflicts.push({
      ids: item.ids,
      minimal: item.minimal,
      everySituation: item.everySituation,
      summary: item.summary,
      clash: item.clash,
      requirements: requirements,
      situation: item.situation,
      requires: requires,
      example: item.example,
      keeps: item.keeps,
      breaks: item.breaks,
      fix: item.fix,
      repairs: repairJson(item.repairs),
    });
  }
  const gaps = [];
  for (let i = 0; i < report.gaps.length; i++) {
    gaps.push({ output: report.gaps[i].output, situation: report.gaps[i].situation, text: report.gaps[i].text });
  }
  const misuse = [];
  for (let i = 0; i < report.misuse.length; i++) {
    const item = report.misuse[i];
    misuse.push({ id: item.id, line: item.line, symbols: item.symbols, sentence: item.sentence, text: item.text });
  }
  const wording = [];
  for (let i = 0; i < report.wording.length; i++) {
    const item = report.wording[i];
    wording.push({ line: item.line, word: item.word, kind: item.kind, text: item.text, context: item.context });
  }
  const redundant = [];
  for (let i = 0; i < report.redundant.length; i++) {
    const item = report.redundant[i];
    redundant.push({
      id: item.id,
      line: item.line,
      sentence: item.sentence,
      text: item.text,
      fix: item.fix,
      impliedBy: item.impliedBy,
    });
  }
  const duplicate = [];
  for (let i = 0; i < report.duplicate.length; i++) {
    const item = report.duplicate[i];
    duplicate.push({
      id: item.id,
      line: item.line,
      sameAs: item.sameAs,
      sentence: item.sentence,
      text: item.text,
      fix: item.fix,
    });
  }
  const vacuous = [];
  for (let i = 0; i < report.vacuous.length; i++) {
    const item = report.vacuous[i];
    vacuous.push({
      id: item.id,
      line: item.line,
      sentence: item.sentence,
      text: item.text,
      fix: item.fix,
      because: item.because,
    });
  }
  const unused = [];
  for (let i = 0; i < report.unused.length; i++) {
    const item = report.unused[i];
    unused.push({ name: item.name, kind: item.kind, text: item.text, fix: item.fix });
  }
  const uncovered = [];
  for (let i = 0; i < report.uncovered.length; i++) {
    const item = report.uncovered[i];
    uncovered.push({ name: item.name, kind: item.kind, text: item.text, fix: item.fix });
  }
  const warnings = [];
  for (let i = 0; i < report.warnings.length; i++) {
    const item = report.warnings[i];
    warnings.push({
      id: item.id,
      line: item.line,
      sentence: item.sentence,
      kind: item.kind,
      word: item.word,
      text: item.text,
      fix: item.fix,
    });
  }
  const ok =
    conflicts.length === 0 &&
    gaps.length === 0 &&
    misuse.length === 0 &&
    wording.length === 0 &&
    duplicate.length === 0 &&
    vacuous.length === 0 &&
    unused.length === 0;
  return JSON.stringify(
    {
      ok: ok,
      spec: specPath,
      conflicts: conflicts,
      gaps: gaps,
      misuse: misuse,
      wording: wording,
      redundant: redundant,
      duplicate: duplicate,
      vacuous: vacuous,
      unused: unused,
      uncovered: uncovered,
      warnings: warnings,
    },
    null,
    2,
  );
}

function repairJson(repairs: Repair[]): { kind: string; id: string; text: string; sentence: string }[] {
  const out: { kind: string; id: string; text: string; sentence: string }[] = [];
  for (let i = 0; i < repairs.length; i++) {
    const item = repairs[i];
    out.push({ kind: item.kind, id: item.id, text: item.text, sentence: item.sentence });
  }
  return out;
}

function pushRepairLines(lines: string[], repairs: Repair[]): void {
  if (repairs.length === 0) return;
  lines.push("");
  lines.push("Candidate repairs follow. This report does not choose one.");
  for (let i = 0; i < repairs.length; i++) {
    const item = repairs[i];
    lines.push("");
    lines.push("repair " + item.kind + " " + item.id);
    lines.push(item.text);
    pushPlainLines(lines, item.sentence);
  }
}

function pushPlainLines(lines: string[], sentence: string): void {
  if (sentence.length === 0) return;
  let start = 0;
  for (let i = 0; i <= sentence.length; i++) {
    if (i === sentence.length || sentence.charCodeAt(i) === 10) {
      const part = sentence.slice(start, i);
      if (part.length > 0) lines.push(part);
      start = i + 1;
    }
  }
}

function brace(ids: string[]): string {
  let out = "{";
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) out += ", ";
    out += ids[i];
  }
  return out + "}";
}

function boundaryBefore(text: string, index: number): boolean {
  if (index === 0) return true;
  return !isWordChar(text.charCodeAt(index - 1));
}

function boundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  return !isWordChar(text.charCodeAt(index));
}

function isWordChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function lowerAscii(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) out += String.fromCharCode(code + 32);
    else out += text.slice(i, i + 1);
  }
  return out;
}
