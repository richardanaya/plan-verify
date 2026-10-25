/**
 * plan-verify command line.
 * User arguments start at process.argv index 2 under both Node and ScriptC.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { bindScenario, evaluate, formatCheckJson, formatCheckText, formatErrorJson } from "./check.ts";
import { diffMeaningChanged, diffSpecs, formatDiffJson, formatDiffText, type DiffReport } from "./diff.ts";
import { parseProperty, parseSpec } from "./ears.ts";
import { parseScenarioJson } from "./jsonvalue.ts";
import { formatLintJson, formatLintText, lintSpec } from "./lint.ts";
import { formatRepairJson, formatRepairText, planRepairs, repairedPath } from "./propose.ts";
import { buildProblems } from "./report.ts";
import { formatGeneratedJson, formatGeneratedText, generateScenarios, type GeneratedScenarios } from "./gentest.ts";
import { formatScenariosJson, formatScenariosText, listScenarios } from "./scenarios.ts";
import { analyzePolicy, formatPolicyJson, formatPolicyText } from "./policy.ts";
import { formatEmitJson, printSmt } from "./smt.ts";
import { spaceSize } from "./solver.ts";
import { displayQuote } from "./text.ts";
import type { Requirement } from "./spec.ts";

const EXIT_OK = 0;
const EXIT_VIOLATIONS = 1;
const EXIT_USAGE = 2;

function main(): void {
  const args: string[] = [];
  for (let i = 2; i < process.argv.length; i++) args.push(process.argv[i]);
  if (args.length === 0) {
    console.error("error: missing command");
    usage(true);
    process.exit(EXIT_USAGE);
  }
  const command = args[0];
  if (command === "help" || command === "--help" || command === "-h") {
    usage(false);
    process.exit(EXIT_OK);
  }
  if (command === "policy") {
    commandPolicy(args.slice(1));
    return;
  }
  if (command === "check") {
    commandCheck(args.slice(1));
    return;
  }
  if (command === "diff") {
    commandDiff(args.slice(1));
    return;
  }
  if (command === "emit-smt") {
    commandEmit(args.slice(1));
    return;
  }
  if (command === "lint") {
    commandLint(args.slice(1));
    return;
  }
  if (command === "repair") {
    commandRepair(args.slice(1));
    return;
  }
  if (command === "report") {
    commandReport(args.slice(1));
    return;
  }
  if (command === "scenarios") {
    commandScenarios(args.slice(1));
    return;
  }
  console.error("error: unknown command " + displayQuote(command));
  usage(true);
  process.exit(EXIT_USAGE);
}

interface Flags {
  json: boolean;
  input: string;
  property: string;
  out: string;
  apply: boolean;
  positionals: string[];
  error: string;
}

function parseFlags(args: string[], allowInput: boolean, allowProperty: boolean, allowOut: boolean, allowApply: boolean): Flags {
  const flags: Flags = { json: false, input: "", property: "", out: "", apply: false, positionals: [], error: "" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--input") {
      if (!allowInput) {
        flags.error = "unknown option --input";
        return flags;
      }
      if (flags.input.length > 0) {
        flags.error = "repeated option --input";
        return flags;
      }
      if (i + 1 >= args.length) {
        flags.error = "missing value for --input";
        return flags;
      }
      i++;
      flags.input = args[i];
    } else if (arg === "--property") {
      if (!allowProperty) {
        flags.error = "unknown option --property";
        return flags;
      }
      if (flags.property.length > 0) {
        flags.error = "repeated option --property";
        return flags;
      }
      if (i + 1 >= args.length) {
        flags.error = "missing value for --property";
        return flags;
      }
      i++;
      flags.property = args[i];
    } else if (arg === "--out") {
      if (!allowOut) {
        flags.error = "unknown option --out";
        return flags;
      }
      if (flags.out.length > 0) {
        flags.error = "repeated option --out";
        return flags;
      }
      if (i + 1 >= args.length) {
        flags.error = "missing value for --out";
        return flags;
      }
      i++;
      flags.out = args[i];
    } else if (arg === "--apply") {
      if (!allowApply) {
        flags.error = "unknown option --apply";
        return flags;
      }
      if (flags.apply) {
        flags.error = "repeated option --apply";
        return flags;
      }
      flags.apply = true;
    } else if (arg.startsWith("--")) {
      flags.error = "unknown option " + arg;
      return flags;
    } else flags.positionals.push(arg);
  }
  return flags;
}

function commandCheck(args: string[]): void {
  const flags = parseFlags(args, true, false, false, false);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.positionals.length !== 1 || flags.input.length === 0) {
    fail(flags.json, "usage: plan-verify check [--json] <spec> --input <scenario>");
  }
  const specPath = flags.positionals[0];
  const scenarioPath = flags.input;
  const specText = readText(specPath);
  if (specText === null) fail(flags.json, "cannot read " + specPath);
  const spec = parseSpec(specText);
  if (!spec.ok) fail(flags.json, specPath + ":" + String(spec.line) + ": " + spec.message);
  const scenarioText = readText(scenarioPath);
  if (scenarioText === null) fail(flags.json, "cannot read " + scenarioPath);
  const json = parseScenarioJson(scenarioText);
  if (!json.ok) fail(flags.json, scenarioPath + ":" + String(json.line) + ": " + json.message);
  const bound = bindScenario(spec.spec, json.object);
  if (!bound.ok) fail(flags.json, "scenario " + scenarioPath + ": " + bound.message);
  const violations = evaluate(spec.spec, bound.env);
  if (flags.json) console.log(formatCheckJson(specPath, scenarioPath, violations));
  else console.log(formatCheckText(specPath, scenarioPath, violations));
  if (violations.length === 0) process.exit(EXIT_OK);
  process.exit(EXIT_VIOLATIONS);
}

function commandDiff(args: string[]): void {
  const flags = parseFlags(args, false, false, true, false);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.positionals.length !== 2) fail(flags.json, "usage: plan-verify diff [--json] <old-spec> <new-spec> [--out <dir>]");
  const oldPath = flags.positionals[0];
  const newPath = flags.positionals[1];
  const oldText = readText(oldPath);
  if (oldText === null) fail(flags.json, "cannot read " + oldPath);
  const newText = readText(newPath);
  if (newText === null) fail(flags.json, "cannot read " + newPath);
  const oldParsed = parseSpec(oldText);
  if (!oldParsed.ok) fail(flags.json, oldPath + ":" + String(oldParsed.line) + ": " + oldParsed.message);
  const newParsed = parseSpec(newText);
  if (!newParsed.ok) fail(flags.json, newPath + ":" + String(newParsed.line) + ": " + newParsed.message);
  const outcome = diffSpecs(oldPath, oldParsed.spec, newPath, newParsed.spec);
  if (outcome.kind === "error") fail(flags.json, outcome.message);
  if (flags.out.length > 0) {
    const wrote = writeDiffFiles(flags.out, outcome.report);
    if (wrote.length > 0) fail(flags.json, wrote);
  }
  if (flags.json) console.log(formatDiffJson(oldPath, newPath, outcome.report, flags.out));
  else console.log(formatDiffText(oldPath, newPath, outcome.report, flags.out));
  if (diffMeaningChanged(outcome.report)) process.exit(EXIT_VIOLATIONS);
  process.exit(EXIT_OK);
}

function writeDiffFiles(dir: string, report: DiffReport): string {
  try {
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < report.files.length; i++) {
      const file = report.files[i];
      writeFileSync(dir + "/" + file.file, file.body, "utf8");
    }
  } catch {
    return "cannot write " + dir;
  }
  return "";
}

function commandEmit(args: string[]): void {
  const flags = parseFlags(args, false, false, false, false);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.positionals.length !== 1) fail(flags.json, "usage: plan-verify emit-smt [--json] <spec>");
  const specPath = flags.positionals[0];
  const specText = readText(specPath);
  if (specText === null) fail(flags.json, "cannot read " + specPath);
  const spec = parseSpec(specText);
  if (!spec.ok) fail(flags.json, specPath + ":" + String(spec.line) + ": " + spec.message);
  const smt = printSmt(specPath, spec.spec);
  if (flags.json) console.log(formatEmitJson(specPath, smt));
  else console.log(smt);
  process.exit(EXIT_OK);
}

function commandLint(args: string[]): void {
  const flags = parseFlags(args, false, false, false, false);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.input.length > 0 || flags.positionals.length !== 1) fail(flags.json, "usage: plan-verify lint [--json] <spec>");
  const specPath = flags.positionals[0];
  const specText = readText(specPath);
  if (specText === null) fail(flags.json, "cannot read " + specPath);
  const spec = parseSpec(specText);
  if (!spec.ok) fail(flags.json, specPath + ":" + String(spec.line) + ": " + spec.message);
  const outcome = lintSpec(spec.spec);
  if (outcome.kind === "error") fail(flags.json, outcome.message);
  const findings =
    outcome.report.conflicts.length +
    outcome.report.gaps.length +
    outcome.report.misuse.length +
    outcome.report.wording.length +
    outcome.report.duplicate.length +
    outcome.report.vacuous.length +
    outcome.report.unused.length;
  // Unreachable requirements (vacuous) stay exit 1, with conflicts, gaps,
  // misuse, wording, duplicates, and unused inputs or variants. Redundant
  // requirements, uncovered outputs, states, and enum values, and wording
  // warnings stay exit 0. Parse errors exit 2.
  if (flags.json) console.log(formatLintJson(specPath, outcome.report));
  else console.log(formatLintText(specPath, outcome.report));
  if (findings === 0) process.exit(EXIT_OK);
  process.exit(EXIT_VIOLATIONS);
}

function commandRepair(args: string[]): void {
  const flags = parseFlags(args, false, false, true, true);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.positionals.length !== 1) {
    fail(flags.json, "usage: plan-verify repair [--json] <spec> [--apply] [--out <path>]");
  }
  if (flags.out.length > 0 && !flags.apply) fail(flags.json, "--out requires --apply");
  const specPath = flags.positionals[0];
  const specText = readText(specPath);
  if (specText === null) fail(flags.json, "cannot read " + specPath);
  const spec = parseSpec(specText);
  if (!spec.ok) fail(flags.json, specPath + ":" + String(spec.line) + ": " + spec.message);
  const planned = planRepairs(spec.spec, specText);
  if (planned.kind === "error") fail(flags.json, planned.message);
  let wrote = "";
  let note = "";
  if (flags.apply) {
    if (!planned.applicable) note = "apply: skipped";
    else {
      const path = flags.out.length > 0 ? flags.out : repairedPath(specPath);
      const err = writeRepaired(path, planned.edited);
      if (err.length > 0) fail(flags.json, err);
      wrote = path;
    }
  }
  if (flags.json) console.log(formatRepairJson(specPath, planned.proposals, wrote));
  else console.log(formatRepairText(specPath, planned.proposals, wrote, note));
  if (planned.proposals.length === 0) process.exit(EXIT_OK);
  process.exit(EXIT_VIOLATIONS);
}

function writeRepaired(path: string, text: string): string {
  const dir = parentDir(path);
  try {
    if (dir.length > 0) mkdirSync(dir, { recursive: true });
    writeFileSync(path, text, "utf8");
  } catch {
    return "cannot write " + path;
  }
  return "";
}

function parentDir(path: string): string {
  let slash = -1;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) === 47) slash = i;
  }
  if (slash <= 0) return "";
  return path.slice(0, slash);
}

function commandReport(args: string[]): void {
  const flags = parseFlags(args, false, false, false, false);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.json) fail(true, "usage: plan-verify report <spec>");
  if (flags.positionals.length !== 1) fail(false, "usage: plan-verify report <spec>");
  const specPath = flags.positionals[0];
  const specText = readText(specPath);
  if (specText === null) fail(false, "cannot read " + specPath);
  const spec = parseSpec(specText);
  if (!spec.ok) fail(false, specPath + ":" + String(spec.line) + ": " + spec.message);
  const outcome = lintSpec(spec.spec);
  if (outcome.kind === "error") fail(false, outcome.message);
  const doc = buildProblems(specPath, spec.spec, outcome.report);
  console.log(doc.text);
  if (doc.count === 0) process.exit(EXIT_OK);
  process.exit(EXIT_VIOLATIONS);
}

function commandScenarios(args: string[]): void {
  const flags = parseFlags(args, false, false, true, false);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.positionals.length !== 1) fail(flags.json, "usage: plan-verify scenarios [--json] <spec> [--out <dir>]");
  const specPath = flags.positionals[0];
  const specText = readText(specPath);
  if (specText === null) fail(flags.json, "cannot read " + specPath);
  const spec = parseSpec(specText);
  if (!spec.ok) fail(flags.json, specPath + ":" + String(spec.line) + ": " + spec.message);
  if (spaceSize(spec.spec) < 0) {
    fail(flags.json, "a symbol has an empty domain. Declare at least one allowed value.");
  }
  if (flags.out.length === 0) {
    const rows = listScenarios(spec.spec);
    if (flags.json) console.log(formatScenariosJson(specPath, rows));
    else console.log(formatScenariosText(specPath, rows));
    process.exit(EXIT_OK);
  }
  const generated = generateScenarios(spec.spec);
  const wrote = writeGenerated(flags.out, generated);
  if (wrote.length > 0) fail(flags.json, wrote);
  if (flags.json) console.log(formatGeneratedJson(specPath, flags.out, generated));
  else console.log(formatGeneratedText(specPath, flags.out, generated));
  if (generated.uncovered.length === 0) process.exit(EXIT_OK);
  process.exit(EXIT_VIOLATIONS);
}

function writeGenerated(dir: string, generated: GeneratedScenarios): string {
  try {
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < generated.files.length; i++) {
      const file = generated.files[i];
      writeFileSync(dir + "/" + file.file, file.body, "utf8");
    }
  } catch {
    return "cannot write " + dir;
  }
  return "";
}

function commandPolicy(args: string[]): void {
  const flags = parseFlags(args, false, true, false, false);
  if (flags.error.length > 0) fail(flags.json, flags.error);
  if (flags.positionals.length !== 1) fail(flags.json, "usage: plan-verify policy [--json] <spec> [--property <file>]");
  const specPath = flags.positionals[0];
  const specText = readText(specPath);
  if (specText === null) fail(flags.json, "cannot read " + specPath);
  const parsed = parseSpec(specText);
  if (!parsed.ok) fail(flags.json, specPath + ":" + String(parsed.line) + ": " + parsed.message);
  if (spaceSize(parsed.spec) < 0) {
    fail(flags.json, "a symbol has an empty domain. Declare at least one allowed value.");
  }
  let propertyReqs: Requirement[] = [];
  if (flags.property.length > 0) {
    const propertyText = readText(flags.property);
    if (propertyText === null) fail(flags.json, "cannot read " + flags.property);
    const property = parseProperty(propertyText, parsed.spec);
    if (!property.ok) fail(flags.json, flags.property + ":" + String(property.line) + ": " + property.message);
    propertyReqs = property.requirements;
  }
  const report = analyzePolicy(parsed.spec, flags.property, propertyReqs);
  if (flags.json) console.log(formatPolicyJson(specPath, parsed.spec, report));
  else console.log(formatPolicyText(specPath, parsed.spec, report));
  if (report.holds) process.exit(EXIT_OK);
  process.exit(EXIT_VIOLATIONS);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function fail(json: boolean, message: string): never {
  if (json) console.log(formatErrorJson(message));
  else console.error("error: " + message);
  process.exit(EXIT_USAGE);
}

function usage(toStderr: boolean): void {
  const text =
    "usage:\n" +
    "  plan-verify check [--json] <spec> --input <scenario>\n" +
    "  plan-verify diff [--json] <old-spec> <new-spec> [--out <dir>]\n" +
    "  plan-verify emit-smt [--json] <spec>\n" +
    "  plan-verify lint [--json] <spec>\n" +
    "  plan-verify repair [--json] <spec> [--apply] [--out <path>]\n" +
    "  plan-verify report <spec>\n" +
    "  plan-verify scenarios [--json] <spec> [--out <dir>]\n" +
    "  plan-verify policy [--json] <spec> [--property <file>]\n" +
    "  plan-verify help";
  if (toStderr) console.error(text);
  else console.log(text);
}

main();
