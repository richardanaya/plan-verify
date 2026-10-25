<p align="center"><img src="assets/logo.png" alt="plan-verify" width="480"></p>

# plan-verify

Catch contradictions in your requirements before anyone builds them.


https://github.com/user-attachments/assets/2653ac92-2f97-4aec-9852-73baa3745d2f



*Watch the 2-minute demo.*

## EARS and SMT

EARS (Easy Approach to Requirements Syntax) is a handful of sentence patterns: always, While, When, If...then, and Where. Each requirement is one testable condition and one response.

```ears
When an order is submitted, the Order System shall fulfill the order.
```

SMT (satisfiability modulo theories) is the kind of math engine that decides whether a set of logical rules can all be true at once. plan-verify turns each EARS line into an SMT implication and solves it with its own solver written in TypeScript (no Z3).

## What it does

You write a plan. You, or an AI agent, turn that plan into EARS requirements. plan-verify finds contradictions, gaps, rules that can never fire, and repeats, explains them in plain English, and never picks a winner.

## Why

- A clash in the requirements is cheaper to settle than a clash in the product.
- The report names which requirements disagree, the situation, and a question to take back to the author.
- plan-verify does not choose which requirement wins.
- The same TypeScript runs on Node and as a native binary, and the solver is part of this repository.

## Quick start

You need Node 24 and clang.

```bash
npm install
npm run build
./build/plan-verify lint examples/order-conflict.ears.md
./build/plan-verify repair examples/order-conflict.ears.md
./build/plan-verify report examples/order-conflict.ears.md
./build/plan-verify scenarios examples/order.ears.md
```

`scenarios` prints an accepted case and a rejected case for the fulfillment requirement in `examples/order.ears.md`.

## Example

`examples/order-conflict.ears.md` is three rules about one submitted order:

```ears
event order_submitted: Bool "The customer submits an order." phrase "an order is submitted"
output order_fulfilled: Bool "The order is fulfilled." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"

R1 When an order is not submitted, the Order System shall not fulfill the order.
R2 When an order is submitted, the Order System shall fulfill the order.
R3 When an order is submitted, the Order System shall not fulfill the order.
```

`plan-verify report` starts like this:

```text
## 1. R2 and R3 cannot both hold.

They clash when an order was submitted.

R2 line 7
"When an order is submitted, the Order System shall fulfill the order."

R3 line 8
"When an order is submitted, the Order System shall not fulfill the order."

Which requirement should win? To keep R2, remove R3. To keep R3, remove R2. This report does not choose.
```

The rest of the report lists repairs and does not choose one. The full output is in [the lint notes](docs/lint.md).

## Commands

| Command | What it answers |
| --- | --- |
| `check` | Does this scenario fit the requirements? |
| `diff` | How does a revised spec change what is accepted? |
| `lint` | Do any requirements clash, leave a hole, never fire, or repeat? |
| `report` | What are the logical problems, in plain English? |
| `emit-smt` | What is the SMT-LIB for these requirements? |
| `policy` | Which scenarios do the requirements allow, and does any of them break a property? |
| `scenarios` | What accepted and rejected scenario files show each requirement? |
| `help` | What commands are available? |

Exit status is `0` when the command is clean, `1` when something is wrong in the requirements, and `2` when the files or the arguments are wrong. A lint warning for a vague word, a weak modal, an escape clause, two outputs in one response, or a result that constrains no output stays exit 0. A requirement implied by the others, and an output, state, or enum value that no requirement can produce, stay exit 0 as well. A requirement that can never fire still exits 1.

## How it works

Each requirement becomes an implication: when its condition holds, its response must hold. plan-verify prints that logic as SMT-LIB and decides it with its own solver. Booleans go through DPLL. Integers and enums tighten bounds. ScriptC compiles the same TypeScript to a native binary, and Node runs the same source.

## What it handles, and what it doesn't

- EARS patterns: a requirement can always hold (no condition), or use While, When, If ... then, and Where. Combined clauses are accepted in that order.
- Types: Bool, Int, and enum. Events and states are Bool. Every Int declares a range inside -1,000,000..1,000,000.
- Solver scope: linear integer arithmetic only. Integers can be added, subtracted, and compared. There is no multiply operator, so a variable is not multiplied by a constant or by another variable. No real numbers, no strings in the logic, and no time or sequence.
- Listing limits: every minimal conflicting set is listed when there are 12 requirements or fewer, even if a range is wide. Above 12, sets that fail in the same situations can collapse to one, and a driver domain wider than 64 values or more than 8192 driver combinations drops a later set that needs a requirement already reported.
- Non-goals: this is not a general theorem prover. It does not check code against the spec, it parses only the EARS grammar it accepts, and it does not choose which requirement wins.

Details are in [the reference](docs/reference.md).

## Agentic neurosymbolic verification

An AI agent (the neural part) turns a plain-English plan into EARS requirements. plan-verify (the symbolic part) converts them to SMT-LIB and proves contradictions, gaps, rules that can never fire, and repeats with its own solver. The agent reads those plain-English findings, asks the human about the choices, revises, and runs lint again until the spec is clean. [skills/plan-verify/SKILL.md](skills/plan-verify/SKILL.md) is how an agent runs this loop.

- The neural side writes.
- The symbolic side checks with math.
- The human decides.

## Examples

The specs in [examples](examples) cover each kind of finding. [A plan to the problems](examples/plan-to-problems/README.md) starts from a plain plan and ends with a plain list of problems.

## Read more

- [Reference](docs/reference.md): grammar, the solver, the build, and the other commands
- [Lint](docs/lint.md): each finding, with the command output
- [JSON](docs/json.md): the `--json` objects and their fields
- CI uploads release binaries for Linux, macOS, and Windows as workflow artifacts. The target list is in the reference.

## Performance

The native ScriptC binary and the same code under Node 24 are timed with `npm run bench`, one run each on a 4 vCPU VM. Release is `npm run build:release` (speed, the committed profile, and strip).

| workload | native ms | release ms | Node ms |
| --- | ---: | ---: | ---: |
| help | 1 | 2 | 97 |
| plan-to-problems | 23 | 18 | 122 |
| gen-25 | 28 | 22 | 144 |
| gen-50 | 100 | 76 | 210 |
| gen-100 | 298 | 209 | 312 |
| gen-100 diff, same spec | 74 | 64 | 167 |
| gen-100 diff, one requirement negated | 118 | 89 | 224 |

The gen-100 rows are the middle of three runs. `gen-100 diff` compares that spec with itself, then with R1's approval sentence negated. The full history is in [the performance notes](docs/performance.md).
