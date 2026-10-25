# Reference

How to build plan-verify, the EARS grammar, the solver, and the commands other than the lint catalogue. Each finding is in [lint.md](lint.md). Proposed edits are in [repair.md](repair.md). The `--json` objects are in [json.md](json.md).

## Build

You need Node 24 and clang. `npm install` installs ScriptC 0.4.2.

```bash
npm install
npm run build
./build/plan-verify lint examples/order-conflict.ears.md
```

`npm run build` uses ScriptC's default optimization. `npm run build:release` builds the same program with `--optimization=speed` and `--strip`. On Linux that script also passes `--profile-use=bench/plan-verify.profdata`. Other platforms build with speed and strip, because profile-guided optimization is Linux-only. `npm run profile` rewrites the profile from the bench specs and the examples. That step is Linux-only and needs Clang 19 or newer.

`node --experimental-strip-types src/main.ts` runs the same program and prints the same bytes. The tests fail if the two ever drift.

The lint report for that file is in [lint.md](lint.md). `scriptc coverage --fail-on=blockers` stays fully static for `src/main.ts`, `test/unit.ts`, and `test/run-all.ts`.

## Platforms

Push to `main` and pull requests build a release binary for each target below and upload it as a workflow artifact named `plan-verify-<target>`. Every build uses `--optimization=speed` and `--strip`. The committed profile is passed with `--profile-use` only for the two Linux x64 targets. Zig 0.16.0 supplies the linker for cross builds and for Windows.

| target | where it is built | goldens |
| --- | --- | --- |
| linux-x64-gnu | native clang on `ubuntu-24.04` | Node and this binary, byte for byte |
| linux-x64-musl | zig `x86_64-linux-musl` on `ubuntu-24.04`, fully static | the static binary runs on that runner, byte for byte with Node |
| linux-arm64-gnu | zig `aarch64-linux-gnu.2.36` on `ubuntu-24.04` | cross-built only |
| macos-arm64 | native on `macos-14` | Node and this binary, byte for byte |
| macos-x64 | native on `macos-15-intel` | Node and this binary, byte for byte |
| x86_64-windows-gnu | zig on `windows-2025`, runtime pack `@scriptc/runtime-win32-x64-msvc@0.4.2` | Node and this binary, byte for byte |

`macos-13` is no longer a GitHub-hosted runner, so the x64 Mac build uses `macos-15-intel`. The Windows triple is `x86_64-windows-gnu`. ScriptC publishes the runtime for that build as `@scriptc/runtime-win32-x64-msvc@0.4.2`.

On Windows, the golden files, saved reports, and fenced samples are compared after CR is removed. The runner checkout and the console use CRLF, and the checked-in goldens use LF. Node and the native binary are compared with those CR bytes left in place, so the two programs still have to print the same bytes.

## Check one scenario

`examples/order.ears.md` is a single rule: when an order is submitted and inventory is available, the order is fulfilled. A scenario is a JSON object with one value for every declared name.

<!-- verify stdout 1
build/plan-verify
check
examples/order.ears.md
--input
examples/order-fail.json
-->
```text
spec: examples/order.ears.md
scenario: examples/order-fail.json
violations: 1

R1 line 7
WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.
An order was submitted and inventory was available, but the order was not fulfilled.
```

<!-- verify stdout 0
build/plan-verify
check
examples/order.ears.md
--input
examples/order-pass.json
-->
```text
spec: examples/order.ears.md
scenario: examples/order-pass.json
violations: 0
```

`check` answers a different question from `lint`. The passing scenario fits R1. Lint still finds a hole, because nothing says what fulfillment should be when the order was submitted and the inventory is not available. `examples/order-covered.ears.md` gives every situation a response. Both outputs are in [lint.md](lint.md).

## See the logic

`emit-smt` prints each requirement as one named implication. The comment above the assertion points back at the line and the sentence.

<!-- verify stdout 0
build/plan-verify
emit-smt
examples/order.ears.md
-->
```text
; spec: examples/order.ears.md
(set-logic ALL)
; event order_submitted: Bool "The customer submits an order." phrase "an order is submitted"
(declare-fun order_submitted () Bool)
; state inventory_available: Bool "Enough stock is on hand to fill the order." phrase "inventory is available"
(declare-fun inventory_available () Bool)
; output order_fulfilled: Bool "The order is fulfilled." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"
(declare-fun order_fulfilled () Bool)
; R1_L7 line 7: WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.
(assert (! (=> (and order_submitted inventory_available) order_fulfilled) :named R1_L7))
```

## Commands

| Command | Question it answers | Status |
| --- | --- | --- |
| `check [--json] <spec> --input <scenario>` | Does this scenario fit the requirements? | Implemented |
| `diff [--json] <old-spec> <new-spec> [--out <dir>]` | How does a revised spec change what is accepted? | Implemented |
| `lint [--json] <spec>` | Do any requirements clash, leave a hole, never trigger, leave schema unused, repeat each other, or use a word a test cannot pin down? | Implemented |
| `repair [--json] <spec> [--apply] [--out <path>]` | What is the smallest edit for each conflict, vacuous requirement, and completeness gap? | Implemented |
| `report <spec>` | What are the logical problems, in plain language? | Implemented |
| `scenarios [--json] <spec> [--out <dir>]` | What accepted and rejected examples show each requirement's trigger? | Implemented |
| `emit-smt [--json] <spec>` | What is the SMT-LIB for these requirements? | Implemented |
| `policy [--json] <spec> [--property <file>]` | Which scenarios do the requirements allow and forbid? Does any allowed scenario break a property? | Implemented |
| `help` | What commands are available? | Implemented |

<!-- verify stdout 0
build/plan-verify
help
-->
```text
usage:
  plan-verify check [--json] <spec> --input <scenario>
  plan-verify diff [--json] <old-spec> <new-spec> [--out <dir>]
  plan-verify emit-smt [--json] <spec>
  plan-verify lint [--json] <spec>
  plan-verify repair [--json] <spec> [--apply] [--out <path>]
  plan-verify report <spec>
  plan-verify scenarios [--json] <spec> [--out <dir>]
  plan-verify policy [--json] <spec> [--property <file>]
  plan-verify help
```

With no property, `policy` prints one scenario the requirements allow and one they forbid. Both are the first assignment the search finds, false before true. A requirement whose condition is false counts as satisfied, so the allowed scenario is not a recommendation.

<!-- verify stdout 0
build/plan-verify
policy
examples/order.ears.md
-->
```text
spec: examples/order.ears.md
accepted:
{
  "order_submitted": false,
  "inventory_available": false,
  "order_fulfilled": false
}
This scenario satisfies every requirement.
rejected:
{
  "order_submitted": true,
  "inventory_available": true,
  "order_fulfilled": false
}
This scenario violates a requirement.

R1 line 7
WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.
An order was submitted and inventory was available, but the order was not fulfilled.
```

Exit status is `0` when the command is clean or lint reports only warnings, redundant requirements, or uncovered outputs, states, and enum values, `1` when a scenario violates a requirement, lint finds a conflict, a gap, misuse, a wording issue, a duplicate, a vacuous requirement, or unused schema, a property has a counterexample, or a revised spec changes what is accepted, and `2` when the spec, the scenario, the property, or the arguments are wrong. `--json` is for the agent. The text report is for the product manager.

## What EARS is

An EARS line is one testable response, with the condition in front of it:

```text
While <state>, when <trigger>, if <condition>, where <feature>, then the <system> shall <response>.
```

Each piece is optional. `then` belongs in the line exactly when `if` is there. The names come from declarations at the top of the spec, so the same idea cannot be spelled two ways:

```text
event order_submitted: Bool "The customer submits an order." phrase "an order is submitted"
state inventory_available: Bool "Enough stock is on hand to fill the order." phrase "inventory is available"
input quantity: Int 1..10 "How many units the customer asked for." phrase "the quantity"
output order_fulfilled: Bool "The order is fulfilled." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"
unwanted event payment_declined: Bool "The payment was declined." phrase "payment fails"
```

The phrase is the only wording a requirement may use for that name. `not fulfill the order` is the phrase with `not` in front. When the phrase contains `is`, write `the customer is not cancelling`. `the quantity is at most 10` still parses, and lint flags `shall the quantity is 10`. Bind the response with `as`, for example `as "accept {op} {value} units"`, and write `shall accept at most 10 units`. `says "{value} units were accepted"` is the sentence a report uses. A Bool can add `action "start the subscription"` next to `phrase "the subscription is started"`. Matching is exact and case-insensitive: the words have to be the phrase you declared, and the longest phrase wins. A sentence that says `an order was submitted` is not close enough to count. The error names the line and the nearest phrases.

A Bool can also say how a report states the result, after the phrase: `outcome "the order was fulfilled" / "the order was not fulfilled"`. One string is enough. The false form inserts `not` after the first `was`, `were`, or `is`, or prefixes `not` when none of those words is there. Two strings separated by `/` are used as written. `outcome` is only for Bool, and `not` is allowed in that wording. When it is left off, a phrase that contains `is` is reported with `was` or `was not`. The violation line for the order above is `An order was submitted and inventory was available, but the order was not fulfilled.`

<!-- verify stderr 2
build/plan-verify
lint
test/fixtures/unknown-phrase.ears.md
-->
```text
error: test/fixtures/unknown-phrase.ears.md:5: unknown phrase "an order was submitted". Closest: "an order is submitted", "inventory is available", "fulfill the order".
```

Scenarios and the SMT-LIB still use the declared names (`order_submitted`, `quantity`). The sentences you read, and the explanations under them, use the phrases and the outcome wording.

Events and states are booleans. Inputs and outputs are booleans, integers with an inclusive range, or enums. An unwanted event, such as a payment being declined, is written with `if` ... `then`. Writing it with `when` is a lint finding, because `when` reads like the normal trigger for the response.

A line with no condition is ubiquitous: the response is always required. `While` is a state that holds. `When` is the trigger. `If` ... `then` is the unwanted or exceptional case. `Where` is a feature or a variant, such as a region.

## How a contradiction is found

Each requirement becomes an implication: when its condition is true, its response must be true. `check` plugs in the scenario you wrote. `lint` asks whether some situation has no response that satisfies the set.

Booleans are decided by DPLL over the clauses of those implications. Integers, and enum values numbered in the order you declared them, are linear arithmetic: bounds tighten until a comparison is forced, and the search branches where a bound or a comparison can change. A model is the lexicographically least assignment. The search tries `false` before `true`, enum values in declaration order, and integers from the low end of the range to the high end. The example scenario is that first assignment. Run it twice and you get the same bytes.

A set such as `{R2, R3}` is reported when some situation has no allowed response, even if other situations are fine. The set is minimal: drop any one requirement and the rest can be satisfied. With 12 requirements or fewer, every such set is listed, smallest first. With more than 12, each set is shrunk by deleting requirements from a failing situation, and situations are tried in that same order. Two sets that share a requirement and fail in exactly the same situations can collapse to one of them. If a driver domain is wider than 64 values, or the driver combinations exceed 8192, each set is removed before the next search, so a later set that needs a requirement from an earlier one is not reported.

An integer has to declare `min..max`, inside `-1000000..1000000`. The procedure decides the range. It does not list every value, so a wide range is still checked.

A comparison that ties two wide integers together is still decided, by splitting the range. A boolean combination of those comparisons can take longer than a single bound.

Vague words, solution words, and a sample of every lint finding are in [lint.md](lint.md).

## Policy

A property is a separate file of requirement lines. It uses the spec's names and phrases, and it does not declare symbols. `P1` is the usual id.

`examples/order-always.ears.md` hopes the order is fulfilled in every scenario. The requirements do not say that. The counterexample is a scenario they allow where the order is not fulfilled:

<!-- verify stdout 1
build/plan-verify
policy
examples/order.ears.md
--property
examples/order-always.ears.md
-->
```text
spec: examples/order.ears.md
property: examples/order-always.ears.md
counterexample:
{
  "order_submitted": false,
  "inventory_available": false,
  "order_fulfilled": false
}
This scenario satisfies every requirement and violates the property.

P1 line 3
The Order System shall fulfill the order.
The order was not fulfilled.
```

`examples/order-same.ears.md` repeats R1. Nothing the requirements allow can break it:

<!-- verify stdout 0
build/plan-verify
policy
examples/order.ears.md
--property
examples/order-same.ears.md
-->
```text
spec: examples/order.ears.md
property: examples/order-same.ears.md
No scenario satisfies every requirement and violates the property.
```

When the requirements themselves cannot all hold, there is no scenario to test the property against. `examples/order-status.ears.md` is that spec: the status would have to be shipped and cancelled.

<!-- verify stdout 0
build/plan-verify
policy
examples/order-status.ears.md
--property
examples/status-placed.ears.md
-->
```text
spec: examples/order-status.ears.md
property: examples/status-placed.ears.md
No scenario satisfies every requirement, so none violates the property.
```

## Repair

`repair` runs the same analysis as `lint` and prints one proposed edit for each minimal conflict, each vacuous requirement, and each completeness gap. The default command writes nothing. `--apply` writes `<spec>.repaired.ears.md`, or the path given to `--out`, when the whole set lints with no hard finding. Samples, the preference order, and the exit codes are in [repair.md](repair.md).

## Diff

`diff` compares what two versions of a spec accept. Schema changes come first. A name whose type, range, or variants do not meet is left out, and the rest is compared. Requirements match by id, then by identical text. A reword that means the same thing is marked `reworded, same meaning`. Each behavior change is one witness, with the requirements responsible on both sides. `--out <dir>` writes that witness for `check --input`. Exit 0 means the compared meaning is the same. Exit 1 means it changed, or a name was left out. Exit 2 is a file that cannot be read or parsed. The samples are in [diff.md](diff.md).

## Scenarios

`scenarios` lists a small set of examples so a product manager can check that a requirement means what they think. For each requirement it looks for an accepted scenario with the trigger true, an accepted scenario with the trigger false, and a rejected scenario with the trigger true. Each one is the first assignment the search finds, false before true. A requirement with no trigger says so, instead of inventing a trigger-false case. The same assignment is printed once.

<!-- verify stdout 0
build/plan-verify
scenarios
examples/order.ears.md
-->
```text
spec: examples/order.ears.md
scenarios: 3

R1 accepted, trigger true
{
  "order_submitted": true,
  "inventory_available": true,
  "order_fulfilled": true
}
An order was submitted and inventory was available, and the order was fulfilled.

R1 accepted, trigger false
{
  "order_submitted": false,
  "inventory_available": false,
  "order_fulfilled": false
}
An order was not submitted and inventory was not available, and the order was not fulfilled.

R1 rejected, trigger true
{
  "order_submitted": true,
  "inventory_available": true,
  "order_fulfilled": false
}
An order was submitted and inventory was available, but the order was not fulfilled.
```

`scenarios --out <dir>` writes one JSON file per case, in the shape `check --input` reads. Each requirement gets a file where the trigger is true and the response holds, and a rejected file for each atomic condition that can break that requirement alone. A second file flips that condition so the trigger is false and every requirement holds. A condition the solver cannot show changing the outcome is listed, with the reason. The names, the manifest, and those reasons are in [scenarios.md](scenarios.md).

The `--json` form of the listing, without `--out`, is in [json.md](json.md).

## From a plan to the problems

[examples/plan-to-problems/README.md](../examples/plan-to-problems/README.md) walks the whole path. A plain product plan goes in. A plain list of logical problems comes out. The live step that drafts the spec calls a model. The report step does not. The offline test uses the spec already in the folder and does not need a key.

## Where this comes from

The shape of the analysis follows Kiro's requirements analysis: separate behavior from design, and look for what the requirements refuse to allow.

- [Deep spec analysis](https://kiro.dev/blog/deep-spec-analysis/)
- [Analyze requirements](https://kiro.dev/docs/specs/analyze-requirements/)

## For the agent in the conversation

The skill at [`skills/plan-verify/SKILL.md`](../skills/plan-verify/SKILL.md) tells an agent how to sit with a product manager. It lists the grammar the parser accepts, shows real `check`, `lint`, `report`, `scenarios`, `emit-smt`, `policy`, `diff`, and `help` output, including the sentences a product manager would read, and says to ask which requirement should win.

## Questions

**Why our own solver?** The decision procedure is in this repository: DPLL for the boolean structure, and bounds for linear integer arithmetic. There is no Z3, cvc5, or yices to install, and the Node run and the native binary are tested to print the same bytes.

**Why ScriptC?** One TypeScript program is the product. ScriptC 0.4.2 compiles that program to a native binary, and `scriptc coverage` stays fully static. Node 24 runs the same files for day-to-day edits.

**Why do integers need a range?** The arithmetic is bounded. A declared range, inside `-1000000..1000000`, keeps every integer finite. The solver does not walk that range one value at a time.

**Will it pick a winner?** It will show who clashes, the situation, and an example that breaks one requirement in the set. The fix says to ask which requirement should win.
