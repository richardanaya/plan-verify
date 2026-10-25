# Performance

Lint time is dominated by the solver: finding a bad driver situation, then the minimal requirement sets, then checking each candidate repair. A Node CPU profile of the 100-requirement spec put about half of the samples in `imply`, the loop that forces linear comparisons from integer bounds. After the cuts below, that share is about one percent. `gen-100` native is under 1.5 s and faster than Node. The release build finishes that spec in 290 ms.

## Machine

These numbers are one wall-clock run each on this VM: 4 vCPU Intel Xeon under KVM, Node v24.22.1, clang 18.1.3. Columns through grouped used ScriptC 0.4.1. The default and release columns use ScriptC 0.4.2. Default is `npm run build`. Release is `npm run build:release`: `--optimization=speed`, `--profile-use=bench/plan-verify.profdata`, and `--strip`. Before is commit `1843ce5`. The middle pair is commit `65b21fd`. Grouped is the run recorded with that layout. `help` is process startup. The other rows are `lint`. Cells in the new columns are the bench printout rounded to the nearest millisecond. `help` printed 1.4 ms default and 1.5 ms release before that rounding.

An earlier hyperfine run on an 8-core Xeon (commit `05167b1`, clang 19.1.7, Node v24.22.1) is what set the target. Native startup there was about 0.8 ms, Node about 99 ms. `lint` of `gen-25` was 12.9 s native and 8.1 s Node. The 12-requirement plan-to-problems spec was 16.4 s native and 10.2 s Node. `gen-50` and `gen-100` both exceeded 60 s.

## Before and after

Milliseconds. A cell marked with a greater-than sign did not finish inside that bound.

| workload | before Node | before native | 65b21fd Node | 65b21fd native | grouped Node | grouped native | Node | default native | release native |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| help | 97 | 3 | 97 | 2 | 100 | 2 | 97 | 1 | 2 |
| gen-10 | 572 | 793 | 141 | 20 | 121 | 11 | 130 | 11 | 9 |
| gen-15 | 294 | 292 | 160 | 39 | 140 | 22 | 140 | 21 | 16 |
| gen-20 | 1842 | 2425 | 248 | 134 | 176 | 43 | 168 | 40 | 32 |
| gen-25 | 7859 | 12591 | 181 | 75 | 156 | 34 | 144 | 28 | 22 |
| plan-to-problems | 9664 | 15950 | 158 | 40 | 126 | 22 | 122 | 23 | 18 |
| gen-50 | >20000 | >20000 | 624 | 571 | 243 | 114 | 210 | 100 | 76 |
| gen-100 | >60000 | >60000 | 5259 | 5903 | 538 | 466 | 499 | 398 | 290 |

`gen-100` before is the 8-core bound. On this 4-vCPU VM, `gen-50` already exceeded 20 s before the change, so `gen-100` was left to that earlier run. Later columns finish here. On `gen-100`, release native is 290 ms, default native is 398 ms, and Node is 499 ms.

The report text is unchanged: same findings, same order, same minimal sets, same example scenarios. Node, the default binary, and the release binary print the same bytes.

## What the solver does differently

Requirements that never share an output, and whose conditions do not read an output, are solved as separate groups. Drivers a group does not mention stay at the low end of the domain, which is where the least bad situation already put them. A uniform integer uses the finitely many comparison boundaries at every span, including spans of 64 and below.

Specs with 12 requirements or fewer still list every minimal conflicting set. Deletion finds each set, and the list is sorted into the same width-then-mask order as the old enumeration. Above 12, when the driver space is still small enough to walk, a subtree that is realizable for every completion is skipped.

A gap for one output branches only the drivers that appear in a condition of a requirement that names that output. The other drivers stay at the top of their domains, which is the gap the old walk selected.

`imply` keeps the unassigned comparisons in a compact list. Each one-variable comparison is a `TheoryRow` with number fields for the symbol, coefficient, operator, and constant, so the native loop loads those as raw doubles.

## Reusing cores

A repair of a spec with more than 12 requirements used to run the full core search on every candidate. The requirements are already split by output. Cores for a group the repair does not touch are saved and reused. A group whose requirement changed is searched again with the same algorithm the full spec used, and only on the drivers that group mentions. Specs that do not split, including checkout, still search the whole spec.

A driver literal whose symbols do not appear in the conflict cannot remove it, so that candidate is dropped before the sentence is parsed. The rewritten sentence is parsed only after the literal has removed the conflict, and only when the parsed condition is the literal added to the old one.

`search` walks past symbols whose bounds are already a single value without calling `imply` again.

## Why native caught Node on gen-100

In `build/main.ll`, `imply` loads a slot from the live-comparison list and uses that number as an index into the coefficient and bound arrays. ScriptC lowers a `number[]` read to `number | undefined`. When that value indexes another number array, the in-range path builds a tagged union and allocates with `scr_union_new_f64`. Node keeps the same arrays as packed numbers, so the full scan was cheaper there.

A comparison that is not forced is parked. `setLo`, `setHi`, and backtracking wake only the comparisons that read the bound that changed. Bools whose bounds did not change stay parked the same way. On this VM, `gen-100` native went from 5903 ms at `65b21fd` to 466 ms with that parking, ahead of Node.

The four parallel arrays (`thVar`, `thCoeff`, `thOp`, `thConst`) were the remaining boxed loads inside that loop. They are now fields on `TheoryRow`. `imply` loads those fields with `getelementptr` and does not call `scr_union_new_f64`. Default native `gen-100` is 398 ms. The release build, speed plus the committed profile, is 290 ms.

## Running it

```bash
npm run build
npm run build:release
npm run bench
```

`npm run build` is the default ScriptC build. `npm run build:release` adds `--optimization=speed` and `--strip`. On Linux it also passes `--profile-use=bench/plan-verify.profdata`. On other platforms the script builds with speed and strip only. `npm run profile` regenerates that file: an instrumented speed build, `lint` of `gen-10` through `gen-50` and every example, then `scriptc merge-profiles`. Profile generation is Linux-only and needs Clang 19 or newer, because ScriptC 0.4.2 writes LLVM profile version 10. `npm run bench` times Node, `build/plan-verify`, and `build/plan-verify-release` when that binary is present.

`bench/gen-spec.mjs` writes a spec with N requirements (`node bench/gen-spec.mjs 25 > bench/specs/gen-25.ears.md`). The checked-in specs under `bench/specs/` are the ones timed above. CI fails the native `gen-25` lint if it is still running after 20 seconds.

## Vacuity and coverage

The unreachable check, the minimal set of requirements that imply another, and enum values a constrained output can never produce use the same solver. `gen-100` has no always-true requirements, no redundant requirements, and no enums, so those extra solves do not run there. On this VM the pre-change default binary, commit `8257b0b`, linted `gen-100` in 421 ms, `gen-25` in 29 ms, and checkout in 1168 ms. After the change, three `gen-100` runs were 405 ms, 482 ms, and 451 ms native, and 543 ms, 630 ms, and 537 ms on Node. `gen-25` native was 30 ms. Checkout native was 1169 ms. The slowest `gen-100` native run, 482 ms, is about 14% above the 421 ms pre-change run on this machine. Node and the default binary printed the same bytes for `gen-100`, checkout, and `examples/order-blocked.ears.md`.

## Scenario files

`scenarios --out` asks the solver for one accepted assignment per requirement and, for each atomic condition, a rejected assignment and a flip. On this VM the default binary wrote `gen-100` in 143 ms, 140 ms, and 135 ms. Node wrote it in 278 ms, 243 ms, and 243 ms. That run writes 459 scenario files and reports 7 requirements whose trigger cannot be true while the other requirements hold, so the exit status is 1. `gen-25` was 12 ms native and 122 ms on Node. With the same `--out` path, Node and the default binary printed the same summary and wrote the same scenario bytes.

## Semantic diff

`diff` asks the solver for conflict ids, gap texts, and one witness each way. Repair search stays on `lint`. A wide spec searches each output group on that group's drivers, then merges the cores in the same least-bad situation order as the full walk. An unchanged pair of specs lints once.

On this VM, before that change, the default binary diffed `bench/specs/gen-100.ears.md` against itself in 793 ms, 777 ms, and 810 ms, exit 0. Node did that in 779 ms, 708 ms, and 706 ms. After the change the default binary did it in 77 ms, 74 ms, and 74 ms. The release binary did it in 52 ms, 64 ms, and 66 ms. Node did it in 191 ms, 167 ms, and 166 ms. Replacing `the Amber Desk shall approve the amber request.` in R1 with `the Amber Desk shall not approve the amber request.` exited 1. Before, that was 776 ms, 780 ms, and 790 ms native, and 737 ms, 731 ms, and 739 ms on Node. After, the default binary did it in 118 ms, 117 ms, and 147 ms, the release binary in 89 ms, 97 ms, and 75 ms, and Node in 246 ms, 224 ms, and 199 ms. Both directions name R1. Node and the default binary printed the same bytes for the unchanged pair and for the negated copy.

The same group search speeds `lint` of `gen-100`. Three default runs were 357 ms, 298 ms, and 298 ms. Three release runs were 222 ms, 209 ms, and 208 ms. Three Node runs were 316 ms, 303 ms, and 312 ms. The report text is the same.

## Repair

`repair bench/specs/gen-100.ears.md` prints proposals and writes nothing. On this VM that command exited 1 with 47 proposals. Three default-binary runs were 501 ms, 480 ms, and 492 ms. Three release runs were 329 ms, 315 ms, and 318 ms. Three Node runs were 446 ms, 461 ms, and 478 ms. The slowest default run, 501 ms, is under twice the 298 ms `gen-100` lint recorded above. Node and the default binary printed the same 9816 bytes. Applying that set and running `lint` left every count at 0.

## Explain

`explain` evaluates the scenario the way `check` does, then tries input, state, and event values until every requirement holds. On this VM, `explain bench/specs/gen-25.ears.md --input test/fixtures/explain-gen25.json` exited 1. Three default-binary runs were 4 ms, 4 ms, and 4 ms. Three release runs were 4 ms, 3 ms, and 3 ms. Three `check` runs of the same files were 5 ms, 4 ms, and 4 ms on the default binary and 3 ms, 3 ms, and 3 ms on the release binary. Three Node explain runs were 119 ms, 117 ms, and 118 ms. Three Node check runs were 120 ms, 115 ms, and 117 ms. Explain stayed within the check time. Node and the default binary printed the same bytes.

## Next

Specs that do not split into output groups search every repair against the whole core set. Checkout is one of those. On this VM that lint is 1156 ms default, 869 ms release, and 881 ms on Node.
