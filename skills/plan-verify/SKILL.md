---
name: plan-verify
description: Use when a product manager is stating or revising requirements. Turn their words into EARS with this grammar, run plan-verify lint, explain any conflict, and ask which requirement should win before anyone builds the system.
---

# plan-verify

You are in a conversation with a product manager. They are telling you what a system should do, often in a few passes, sometimes contradicting what they said earlier. Turn what they say into EARS requirements with the grammar below, then run plan-verify.

Lint is implemented, and it is the check that matters. When it reports a conflict, explain it in plain words: which requirements clash, under what situation, the example scenario, and the suggested fix. Ask which requirement should win. Do not choose one, and do not paper over the clash with a new sentence they did not ask for. A requirement that adds nothing stays until the PM agrees to remove it. `scenarios` prints accepted and rejected examples so you can check that you heard them correctly. `scenarios --out` writes a file for each case, including each condition that flips the outcome.

`help` lists every command:

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

## Write, lint, repair, check, scenarios

Write the requirements in EARS. `examples/order-conflict.ears.md` is a submitted order with two answers:

```ears
event order_submitted: Bool "The customer submits an order." phrase "an order is submitted"
output order_fulfilled: Bool "The order is fulfilled." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"

R1 When an order is not submitted, the Order System shall not fulfill the order.
R2 When an order is submitted, the Order System shall fulfill the order.
R3 When an order is submitted, the Order System shall not fulfill the order.
```

Lint names the clash. Explain it, and ask which requirement should win.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-conflict.ears.md
-->
```text
spec: examples/order-conflict.ears.md
conflicts: 1
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

conflict {R2, R3}
R2 and R3 cannot both hold.

R2 line 7
When an order is submitted, the Order System shall fulfill the order.

R3 line 8
When an order is submitted, the Order System shall not fulfill the order.

They clash when an order was submitted.
R2 requires that the order was fulfilled.
R3 requires that the order was not fulfilled.

Example scenario:
{
  "order_submitted": true,
  "order_fulfilled": true
}
This scenario keeps R2 and breaks R3.

Suggested fix: ask which requirement should win. To keep R2, remove R3. To keep R3, remove R2.

Candidate repairs follow. This report does not choose one.

repair drop R2
One repair is to drop R2 and keep R3 as written.
When an order is submitted, the Order System shall not fulfill the order.

repair drop R3
One repair is to drop R3 and keep R2 as written.
When an order is submitted, the Order System shall fulfill the order.
```

`repair` proposes one concrete edit. It writes nothing until `--apply`. Show the proposal, and apply it when the product manager agrees.

<!-- verify stdout 1
build/plan-verify
repair
examples/order-conflict.ears.md
-->
```text
spec: examples/order-conflict.ears.md
proposals: 1

proposal conflict R2, R3
Drop R3.
clears R2, R3
before:
When an order is submitted, the Order System shall not fulfill the order.
after:
dropped
```

`--apply` writes the edited spec. The command still exits 1 because it proposed a change.

<!-- verify stdout 1
build/plan-verify
repair
examples/order-conflict.ears.md
--apply
--out
build/skill-repair.ears.md
-->
```text
spec: examples/order-conflict.ears.md
proposals: 1
wrote: build/skill-repair.ears.md

proposal conflict R2, R3
Drop R3.
clears R2, R3
before:
When an order is submitted, the Order System shall not fulfill the order.
after:
dropped
```

Check the written spec against a submitted order that is fulfilled.

<!-- verify stdout 0
build/plan-verify
check
build/skill-repair.ears.md
--input
test/fixtures/repair-submitted.json
-->
```text
spec: build/skill-repair.ears.md
scenario: test/fixtures/repair-submitted.json
violations: 0
```

Scenarios lists an accepted case and a rejected case for each remaining requirement.

<!-- verify stdout 0
build/plan-verify
scenarios
build/skill-repair.ears.md
-->
```text
spec: build/skill-repair.ears.md
scenarios: 6

R1 accepted, trigger true
{
  "order_submitted": false,
  "order_fulfilled": false
}
An order was not submitted, and the order was not fulfilled.

R1 accepted, trigger false
{
  "order_submitted": true,
  "order_fulfilled": true
}
An order was submitted, and the order was fulfilled.

R1 rejected, trigger true
{
  "order_submitted": false,
  "order_fulfilled": true
}
An order was not submitted, but the order was fulfilled.

R2 accepted, trigger true
Same scenario as R1 accepted, trigger false.
An order was submitted, and the order was fulfilled.

R2 accepted, trigger false
Same scenario as R1 accepted, trigger true.
An order was not submitted, and the order was not fulfilled.

R2 rejected, trigger true
{
  "order_submitted": true,
  "order_fulfilled": false
}
An order was submitted, but the order was not fulfilled.
```

`report <spec>` prints the logical problems in plain language: contradictions, uncovered situations, conditions that can never be true, requirements that add nothing, and exact duplicates. For a contradiction it asks which requirement should win and does not choose. Lint itself names a repeat that sits outside every conflict. The report still explains a stricter repeat by naming the wider requirement.

`policy` searches the same finite domain as lint. With no property it prints one scenario the requirements allow and one they forbid. With a property file it looks for a scenario the requirements allow and the property forbids. Do not treat either scenario as the behavior the PM agreed to, and do not pick a winning requirement.

## Revising a spec

When the product manager changes a requirement, keep the previous spec and write the new one beside it. Leave each requirement's id in place so the two files can be matched. Then diff them:

`build/plan-verify diff <old-spec> <new-spec>`

The report lists schema changes first, then what was added, removed, renamed, or reworded. A reword that means the same thing says `reworded, same meaning`. It searches for one scenario the old spec accepts and the new spec rejects, and one the other way. Each is the first assignment, false before true, with the requirement that fails and the requirement on the other side. `--out <dir>` writes that scenario for `check`. If neither exists, the report says `No scenario changes acceptance.` Exit 0 means the compared meaning did not change. Exit 1 means it did, or a name was left out of the comparison. Ask the product manager about a scenario that changed acceptance before anyone builds it.

`examples/order-v1.ears.md` fulfills an order only when it was submitted and inventory is available. `examples/order-v2.ears.md` keeps that rule and says what happens in the other situations. The smallest scenario the old spec still allows is an order that was never submitted and was fulfilled anyway:

<!-- verify stdout 1
build/plan-verify
diff
examples/order-v1.ears.md
examples/order-v2.ears.md
-->
```text
old: examples/order-v1.ears.md
new: examples/order-v2.ears.md
schema:
none
added:
R2 line 8
WHEN an order is submitted AND inventory is not available, THE Order System SHALL not fulfill the order.

R3 line 9
WHEN an order is not submitted, THE Order System SHALL not fulfill the order.
removed:
none
renamed:
none
reworded:
none
behavior:
The old spec accepts this scenario and the new spec rejects it.
{
  "order_submitted": false,
  "inventory_available": false,
  "order_fulfilled": true
}
old:
R3 is not in the old spec.
new:
R3 line 9
WHEN an order is not submitted, THE Order System SHALL not fulfill the order.
An order was not submitted, but the order was fulfilled.

No scenario is accepted by the new spec and rejected by the old spec.
lint:
conflicts fixed:
none
conflicts new:
none
gaps fixed:
order_fulfilled
Nothing says whether the order was fulfilled when an order was submitted and inventory was not available. Suggested fix: add a requirement for this situation, and ask what the system shall do. Do not choose the response.
gaps new:
none
```

The samples below are the built CLI. `node --experimental-strip-types src/main.ts` prints the same bytes when `build/plan-verify` is not there yet. The same spec always produces the same SMT-LIB.

## Confirm the edit

After you edit requirements, diff the previous file against the file you just wrote. If the report says `reworded, same meaning` and `No scenario changes acceptance.`, the wording changed and the behavior did not. That is the result you want from a wording pass.

<!-- verify stdout 0
build/plan-verify
diff
test/fixtures/diff-reword-old.ears.md
test/fixtures/diff-reword-new.ears.md
-->
```text
old: test/fixtures/diff-reword-old.ears.md
new: test/fixtures/diff-reword-new.ears.md
schema:
none
added:
none
removed:
none
renamed:
none
reworded:
R1
old line 5
WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.
new line 5
When an order is submitted and inventory is available, the Order System shall fulfill the order.
reworded, same meaning
behavior:
No scenario changes acceptance.
lint:
conflicts fixed:
none
conflicts new:
none
gaps fixed:
none
gaps new:
none
```

When the edit is meant to change behavior, read the witness and confirm it is the change you intended. `--out` writes that witness. `check` on the new spec reports the requirement that now forbids it.

<!-- verify stdout 1
build/plan-verify
diff
examples/order-v1.ears.md
examples/order-v2.ears.md
--out
build/skill-diff
-->
```text
old: examples/order-v1.ears.md
new: examples/order-v2.ears.md
out: build/skill-diff
schema:
none
added:
R2 line 8
WHEN an order is submitted AND inventory is not available, THE Order System SHALL not fulfill the order.

R3 line 9
WHEN an order is not submitted, THE Order System SHALL not fulfill the order.
removed:
none
renamed:
none
reworded:
none
behavior:
The old spec accepts this scenario and the new spec rejects it.
old-accepts-new-rejects.json
{
  "order_submitted": false,
  "inventory_available": false,
  "order_fulfilled": true
}
old:
R3 is not in the old spec.
new:
R3 line 9
WHEN an order is not submitted, THE Order System SHALL not fulfill the order.
An order was not submitted, but the order was fulfilled.

No scenario is accepted by the new spec and rejected by the old spec.
lint:
conflicts fixed:
none
conflicts new:
none
gaps fixed:
order_fulfilled
Nothing says whether the order was fulfilled when an order was submitted and inventory was not available. Suggested fix: add a requirement for this situation, and ask what the system shall do. Do not choose the response.
gaps new:
none
```

<!-- verify stdout 1
build/plan-verify
check
examples/order-v2.ears.md
--input
build/skill-diff/old-accepts-new-rejects.json
-->
```text
spec: examples/order-v2.ears.md
scenario: build/skill-diff/old-accepts-new-rejects.json
violations: 1

R3 line 9
WHEN an order is not submitted, THE Order System SHALL not fulfill the order.
An order was not submitted, but the order was fulfilled.
```

## Vocabulary

Declare every name before the requirement that uses it. One name per idea, reused every time the PM comes back to that idea. Bind that name to the phrase they actually say. The requirement line uses the phrase, not the name. The name is what a JSON scenario and the SMT-LIB use.

```ears
enum Region { us, eu }
event order_submitted: Bool "The customer submits an order." phrase "an order is submitted"
state inventory_available: Bool "Enough stock is on hand to fill the order." phrase "inventory is available"
input quantity: Int 1..10 "How many units the customer asked for." phrase "the quantity"
input region: Region "The region the order ships to." phrase "the region"
output order_fulfilled: Bool "The order is fulfilled." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"
unwanted event payment_declined: Bool "The payment was declined." phrase "payment fails"
```

Keywords are case-insensitive. Names keep the case you wrote. A phrase match is case-insensitive too.

| Declaration | Form the parser accepts |
| --- | --- |
| Enum | `enum Name { variant, variant }` |
| Event | `event name: Bool "description" phrase "words"` |
| State | `state name: Bool "description" phrase "words"` |
| Input | `input name: Type "description" phrase "words"` |
| Output | `output name: Type "description" phrase "words"` |
| Unwanted event | `unwanted event name: Bool "description" phrase "words"` |

`phrase` is optional. Leave it off only when you are still naming the idea. Once it is there, write requirements with that phrase.

A Bool may also declare how a report states that fact. Put `outcome` after the phrase:

`output order_fulfilled: Bool "The order is fulfilled." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"`

One quoted string is enough. The false wording inserts `not` after the first `was`, `were`, or `is`, and prefixes `not` when none of those words is there. Two strings separated by `/` are used exactly as written. `outcome` is only for Bool. Its words follow the same punctuation rules as a phrase, and the word `not` is allowed. When no outcome is declared, a phrase that contains `is` is reported as `was` when the symbol is true and `was not` when it is false, so `an order is submitted` becomes `an order was submitted` or `an order was not submitted`. A violation then reads `An order was submitted and inventory was available, but the order was not fulfilled.`

`Type` is `Bool`, `Int min..max`, or an enum name declared above that line. Events and states are `Bool` only. An unwanted marker applies only to an event. Ranges are inclusive and both ends sit inside `-1000000..1000000`. At least one variant is required. Variant names are unique across the whole spec and cannot match a symbol name.

A description and a phrase are double-quoted strings. `\"`, `\\`, `\/`, and `\t` are the escapes. A newline is rejected, and an empty description or phrase is rejected. Extra spaces inside a phrase collapse to one space. A phrase is words: a hyphen may sit inside a word (`user-friendly`), and `+`, `=`, and other punctuation may not. A phrase cannot start with `not`, `and`, or `or`. A one-word phrase cannot be a reserved word. Two phrases that match ignoring case are an error, and a phrase cannot repeat another symbol, enum, or variant.

These words are reserved and cannot be names: `not`, `and`, `or`, `true`, `false`, `while`, `when`, `if`, `where`, `then`, `the`, `shall`, `should`, `must`, `will`, `event`, `state`, `input`, `output`, `unwanted`, `enum`, `bool`, `int`, `phrase`, `outcome`, `action`, `says`, `as`.

Blank lines, `#` headings, `//` comments, and a full-line `<!-- ...` are ignored. A requirement may continue onto the next lines until a blank line, a comment, a declaration, or the next id. The requirement's line number is the line of its id.

## Phrases

Matching is exact. The words in the sentence have to be a declared phrase, compared without regard to case. The longest phrase wins, so `an order` does not steal `an order is submitted` when both are declared. There is no fuzzy match and no stemming.

`not` in front of a phrase is the negation: `not fulfill the order`. Write that. Do not declare a second phrase for the false case. When the phrase itself contains `is`, write `is not` inside it: `the customer is not cancelling`, not `not the customer is cancelling`. Both parse as the same negation. Lint flags the second shape.

A Bool may also declare `action "start the subscription"` beside `phrase "the subscription is started"`. The action is a second phrase for the same fact, so a response can say `shall start the subscription` and a condition can say `when the subscription is started`.

An Int or enum may declare `as` and `says` after the phrase. `as` is the verb phrase a requirement uses. `{value}` is the number or the variant. `{op}` is optional and matches `at most`, `at least`, `less than`, `greater than`, `not`, or nothing when the value is exact. A pattern word with a trailing `s` also matches the word without that `s`, so `seats` matches `seat`. `says` is how a report states the result, and `{value}` is filled in: `says "{value} seats were billed"` turns 3 into `3 seats were billed` and `at most` into `at most 2 seats were billed`. `{name}` and `{symbolName}` are the same hole. `says` is skipped when the right side is another phrase, so `the number shipped was the quantity` stays a phrase. With no `says`, a singular integer reads `the quantity was 12`, and a plural or an enum reads `were set to` or `was set to`.

An unknown run of words is an error. The message names the line and up to three closest phrases, nearest edit distance first:

<!-- verify stderr 2
build/plan-verify
lint
test/fixtures/unknown-phrase.ears.md
-->
```text
error: test/fixtures/unknown-phrase.ears.md:5: unknown phrase "an order was submitted". Closest: "an order is submitted", "inventory is available", "fulfill the order".
```

When you see that, show the PM the sentence and the suggestions. Ask which declared phrase they meant, or add a phrase they just introduced. Do not silently pick one.

A name with no phrase still parses as that name. Prefer the phrase in anything the PM will read.

## Operations

A condition or a response is a boolean expression. This is the whole language. The phrase column is what you write once `phrase` is declared. The name column is the same term with no phrase bound.

| With a phrase | With only the name | What it means |
| --- | --- | --- |
| `an order is submitted` | `order_submitted` | That Bool symbol is true. |
| `not fulfill the order` | `not order_fulfilled` | That Bool symbol is false. |
| `not the quantity is 1` | `not quantity = 1` | `not` applies to the comparison: the quantity is something other than 1. |
| `a and b` | `a and b` | Both sides are true. `and` binds tighter than `or`. |
| `a or b` | `a or b` | Either side is true. |
| `true`, `false` | `true`, `false` | Boolean literals, any case. |
| `the quantity is 1`, `the quantity is not 1` | `quantity = 1`, `quantity != 1` | Equality. Both sides must be Bool, both Int, or the same enum. |
| `the quantity is less than 2`, `is at most`, `is greater than`, `is at least` | `quantity < 2`, `<=`, `>`, `>=` | Integer comparisons only. |
| `the number shipped is the quantity + 1` | `shipped = quantity + 1`, and `quantity - 1` | Integer addition and subtraction. |
| `the offset is -1` | `offset = -1` | A negative integer literal. No leading zeros. |
| `the region is us` | `region = us` | The symbol equals that enum variant. `us` is the variant name. |
| `(a or b) and c` | `(a or b) and c` | Parentheses group the expression. |

`is`, `is not`, `is at most`, `is at least`, `is less than`, and `is greater than` are the same comparisons as `=`, `!=`, `<=`, `>=`, `<`, and `>`. When the left side has a phrase, reports print the English form.

`shall the quantity` is rejected, because the response has to be a boolean. `shall the quantity is 1` still parses, and lint flags it. Bind `as "accept {value} units"` and write `shall accept 1 unit`. `+` and `-` expect integers.

`examples/order-awkward.ears.md` is the shape to stop writing. The trigger is a bare verb, and the response is `shall the lane is fulfill`. `When not start the subscription` is also a bare negation. Lint names each of those. It does not pick a lane.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-awkward.ears.md
-->
```text
spec: examples/order-awkward.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 5
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

wording line 7
"shall the ... is ..." is awkward. Write the response as a verb phrase, such as "bill at most 2 seats", and bind it with as.
When start the subscription, the Checkout shall the lane is fulfill.

wording line 7
"When" needs a condition with "is", not a bare verb. "When the subscription is started" is the form.
When start the subscription, the Checkout shall the lane is fulfill.

wording line 8
"shall the ... is ..." is awkward. Write the response as a verb phrase, such as "bill at most 2 seats", and bind it with as.
When not start the subscription, the Checkout shall the lane is hold.

wording line 8
"When" needs a condition with "is", not a bare verb. "When the subscription is started" is the form.
When not start the subscription, the Checkout shall the lane is hold.

wording line 8
The trigger is a bare negation. Write a positive condition, such as "When a non-member asks", or declare a positive event.
When not start the subscription, the Checkout shall the lane is hold.
```

`examples/order-clear.ears.md` is the same lane, written so the sentence can be read aloud. `as "route the order to the {value} lane"` binds the verb phrase, and `says` is what a later explanation uses. Lint is clean.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-clear.ears.md
-->
```text
spec: examples/order-clear.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0
```

## EARS patterns

Clauses that appear go in this order, separated by commas: `while`, `when`, `if`, `where`. `then` is required when `if` is present, and rejected when `if` is absent. The line ends with a period. The id is `R`, digits, then zero or more `.digits` groups, such as `R1` or `R1.2`. One requirement per line.

```ears
While <state>, when <trigger>, if <condition>, where <feature>, then the <system> shall <response>.
```

| Pattern | Use it for | Shape the parser accepts |
| --- | --- | --- |
| Ubiquitous | A response that is always required | `The Order System shall fulfill the order.` |
| When | The normal trigger | `When an order is submitted, the Order System shall fulfill the order.` |
| If, then | An unwanted or exceptional case | `If payment fails, then the Order System shall reject the order.` |
| While | A state that already holds | `While inventory is available, the Order System shall fulfill the order.` |
| Where | A variant, such as a region | `Where the region is us, the Order System shall fulfill the order.` |
| Combined | Any of the above, in the order above | `While inventory is available, when an order is submitted, if the quantity is at least 1, where the region is us, then the Warehouse shall ship the quantity.` |

`should`, `may`, `might`, `could`, `can`, and `will try` parse where `shall` would stand, and lint warns. `must` and a bare `will` are still rejected. The parser stops and asks for `shall`.

Each requirement with at least one clause becomes one implication. The clauses are joined with `and` in the order while, when, if, where, and that antecedent implies the response. A ubiquitous requirement is asserted as the response itself. Assertion names are the id, `_L`, and the line, such as `R1_L7`. The SMT-LIB uses the symbol names. The comment above each assertion repeats the original sentence.

An unwanted event is written with `if` ... `then`. `when` is the normal trigger. Lint flags an unwanted event used in `when` without an `if`.

The line has to be something a scenario can make true or false. Lint rejects these whole words as too vague to test, and that rejection exits 1: `as needed`, `fast`, `slow`, `large`, `small`, `appropriate`, `quickly`, `easy`, `robust`, `flexible`, `user-friendly`, `efficient`. It also rejects solution words: `database`, `api`, `algorithm`, `microservice`, `server`, `class`, `function`. A further list is a warning and exits 0 when it is the only finding: `appropriately`, `reasonable`, `etc`, `adequate`, `sufficient`, `timely`, `normally`, `usually`, `some`, `several`, `many`, `few`, `minimal`, `optimal`, plus `if possible` and `where possible`. A word that sits inside a declared phrase or action is already bound to a schema item, so that use is not a wording finding. Put the PM's phrasing in the description only after those words are gone, or say the testable fact in the requirement. Lint also flags an awkward response (`shall the lane is fulfill`), a `When` that is a bare verb (`When start the subscription`), and a `not` that sits in front of a phrase containing `is` (`not the customer is cancelling`). Those findings have kind `form`. A trigger or state that starts with bare `not`, such as `When not a member asks` or `While not a member asks`, has kind `negation`. Ask for a positive condition, such as `When a non-member asks`, or a positive event. Show the sentence and the wording line.

## Testability warnings

A warning names the requirement id, the line, the sentence, and a short fix. The count is `warnings`. `--json` puts the same findings in `warnings`, and `ok` stays true when warnings are the only findings. A redundant requirement and an uncovered output, state, or enum value are separate counts. They also leave `ok` true and exit 0 when nothing else is wrong. A conflict, a gap, misuse, a wording finding, a duplicate, a vacuous requirement, or an unused input or variant still exits 1. A word the schema does not declare is a parse error and exits 2. The warning list is scanned in requirement sentences only. A word inside a declared phrase or action is skipped.

### A vague word

`examples/order-timely.ears.md` says the system shall timely fulfill the order.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-timely.ears.md
-->
```text
spec: examples/order-timely.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 1

warning R1 line 6
"timely" is too vague to test. Replace it with a value a scenario can check.
When an order is submitted, the Order System shall timely fulfill the order.
Suggested fix: replace "timely" with a declared bound.
```

The fixed sentence drops the vague word and names the output:

```ears
When an order is submitted, the Order System shall fulfill the order.
```

### A weak modal

`examples/order-should.ears.md` uses `should` where the response needs `shall`. `may`, `might`, `could`, `can`, and `will try` are the same warning.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-should.ears.md
-->
```text
spec: examples/order-should.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 1

warning R1 line 6
R1 uses "should" instead of "shall".
When an order is submitted, the Order System should fulfill the order.
Suggested fix: write "shall" so the response is required.
```

The fixed sentence:

```ears
When an order is submitted, the Order System shall fulfill the order.
```

### An escape clause

`examples/order-escape.ears.md` lets the response slip with `where possible` and `if possible`.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-escape.ears.md
-->
```text
spec: examples/order-escape.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 2

warning R1 line 6
R1 uses "where possible", which lets the response slip.
When an order is submitted, the Order System shall fulfill the order where possible.
Suggested fix: delete "where possible" and keep "shall".

warning R2 line 7
R2 uses "if possible", which lets the response slip.
When an order is not submitted, the Order System shall not fulfill the order if possible.
Suggested fix: delete "if possible" and keep "shall".
```

The fixed sentences:

```ears
When an order is submitted, the Order System shall fulfill the order.
When an order is not submitted, the Order System shall not fulfill the order.
```

### Two outputs in one response

`examples/order-split.ears.md` joins two outputs with `and`. The same warning is raised for `or`. One output joined to an input bound stays quiet, and `not` of a single output stays quiet.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-split.ears.md
-->
```text
spec: examples/order-split.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 2

warning R1 line 7
R1 joins "fulfill the order" and "send a receipt" with "and" in one response.
When an order is submitted, the Order System shall fulfill the order and send a receipt.
Suggested fix: split this into one requirement per output.

warning R2 line 8
R2 joins "fulfill the order" and "send a receipt" with "and" in one response.
When an order is not submitted, the Order System shall not fulfill the order and not send a receipt.
Suggested fix: split this into one requirement per output.
```

The fixed sentences give each output its own requirement:

```ears
When an order is submitted, the Order System shall fulfill the order.
When an order is submitted, the Order System shall send a receipt.
When an order is not submitted, the Order System shall not fulfill the order.
When an order is not submitted, the Order System shall not send a receipt.
```

### A result no scenario can fail

`examples/order-untestable.ears.md` says the system shall not fail, and no output is constrained. `examples/order-always-work.ears.md` says the system shall always work. `shall always works` is the same warning.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-untestable.ears.md
-->
```text
spec: examples/order-untestable.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 1

warning R1 line 5
R1 says "not fail", and no output is constrained.
When an order is submitted, the Order System shall not fail.
Suggested fix: name the output the response sets.
```

<!-- verify stdout 0
build/plan-verify
lint
examples/order-always-work.ears.md
-->
```text
spec: examples/order-always-work.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 1

warning R1 line 5
R1 says "always work", and no output is constrained.
When a shipment is requested, the Order System shall always work.
Suggested fix: name the output the response sets.
```

The fixed sentences name an output:

```ears
When an order is submitted, the Order System shall fulfill the order.
When a shipment is requested, the Order System shall send a receipt.
```

### A word the schema does not declare

This is already a parse error, so lint adds no second warning. `test/fixtures/unknown-phrase.ears.md` says "an order was submitted". The declared phrase is "an order is submitted".

<!-- verify stderr 2
build/plan-verify
lint
test/fixtures/unknown-phrase.ears.md
-->
```text
error: test/fixtures/unknown-phrase.ears.md:5: unknown phrase "an order was submitted". Closest: "an order is submitted", "inventory is available", "fulfill the order".
```

The fixed sentence uses the declared phrase:

```ears
When an order is submitted, the Order System shall fulfill the order.
```

### The same rules, written so a scenario can check them

`examples/order-testable.ears.md` is those sentences after the fixes. Lint is quiet, including warnings:

<!-- verify stdout 0
build/plan-verify
lint
examples/order-testable.ears.md
-->
```text
spec: examples/order-testable.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0
```

## Workflow

1. Listen. Write down the PM's words before you translate them.
2. Add or reuse declarations. If they describe something you already named, use that name and its phrase. Bind a new phrase to the words they keep using.
3. Write one EARS line per requirement, using the phrases. Normal triggers use `when`. Unwanted conditions use `if` ... `then`.
4. Run `build/plan-verify lint <spec>`. Run `build/plan-verify report <spec>` for the logical problems in one plain-language list. Run `build/plan-verify scenarios <spec>` when you want an accepted and a rejected example of each trigger.
5. Fix what lint reports. For a conflict, tell the PM which requirements clash, the situation, and the example, then ask which requirement should win. Also show the candidate repairs: dropping one requirement in the set, and any rewritten line that adds one Bool, enum equality, or integer bound to one condition. Stop until they answer. Do not choose a requirement or a repair. If a requirement adds nothing, including a repeat that sits outside a conflict, show which requirements imply it and ask whether they meant something those requirements do not already require. Do not delete it. That finding stays exit 0. If two requirements are the same condition and the same response, show the duplicate and ask whether the later line was meant to differ. Do not delete it. If a trigger starts with bare `not`, ask for a positive condition or a positive event. If a condition can never be true, show each Blocked by line and the suggested fix, and ask them to rewrite the condition. Do not invent a response. That finding exits 1. If an input or a never-mentioned enum variant is unused, ask whether to use it or remove it. If a state, an output, or an enum value no requirement can produce is uncovered, show that warning and ask whether to constrain it or remove it. Do not choose the value. Uncovered findings stay exit 0 when they are the only findings. For a gap, read the suggested fix and ask what the system shall do in that situation. Do not choose the response. For a warning, show the requirement id, the line, the sentence, and the suggested fix. A warning by itself leaves the command at exit 0. Ask the PM for the testable wording. Do not invent a bound or an output.
6. When they describe a concrete story, write a flat JSON scenario with every declared name and run `build/plan-verify check <spec> --input <scenario>`. When they hope something is always true, write that hope as a property file of `P` requirements and run `build/plan-verify policy <spec> --property <file>`. A counterexample is a scenario the requirements allow and the property forbids. If you have no property yet, `policy <spec>` prints one allowed scenario and one forbidden scenario. The search tries false before true, so the first hit is not a recommendation.
7. Report every check violation by requirement ID, line, and sentence, then the values. A passing check can still leave a gap. If lint reported one, say which output is uncovered and in what situation.

`--json` is the same report in a stable shape, for you. Show the PM the text. Stderr stays empty. A bad file or a bad argument is exit 2 and `{ "ok": false, "error": "..." }`.

`check` returns `ok`, `spec`, `scenario`, and `violations` of `id`, `line`, `sentence`, `because`.

<!-- verify stdout 1
build/plan-verify
check
--json
examples/order.ears.md
--input
examples/order-fail.json
-->
```text
{
  "ok": false,
  "spec": "examples/order.ears.md",
  "scenario": "examples/order-fail.json",
  "violations": [
    {
      "id": "R1",
      "line": 7,
      "sentence": "WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.",
      "because": "An order was submitted and inventory was available, but the order was not fulfilled."
    }
  ]
}
```

`lint` returns `ok`, `spec`, `conflicts`, `gaps`, `misuse`, `wording`, `redundant`, `duplicate`, `vacuous`, `unused`, `uncovered`, and `warnings`. A conflict carries `ids`, `minimal`, `everySituation`, `summary`, `clash`, `requirements`, `situation`, `requires`, `example`, `keeps`, `breaks`, `fix`, and `repairs`. A repair is `kind`, `id`, `text`, and `sentence`. `kind` is `drop` or `strengthen`. Situation and example entries are `name` and `value`. Requirements are `id`, `line`, and `sentence`. Requires entries are `id` and `text`. A gap is `output`, `situation`, and `text`. Misuse is `id`, `line`, `symbols`, `sentence`, and `text`. Wording is `line`, `word`, `kind`, `text`, and `context`. Wording `kind` is `vague`, `solution`, `form`, or `negation`. A redundant requirement is `id`, `line`, `sentence`, `text`, `fix`, and `impliedBy`. An exact duplicate is `id`, `line`, `sameAs`, `sentence`, `text`, and `fix`. A vacuous requirement is `id`, `line`, `sentence`, `text`, `fix`, and `because`. An unused entry is `name`, `kind`, `text`, and `fix`. Unused `kind` is `input` or `variant`. An uncovered entry is `name`, `kind` (`state`, `output`, or `variant`), `text`, and `fix`. `ok` stays true for warnings, redundant requirements, and uncovered names. Do not delete a redundant requirement, or an exact duplicate, until the PM agrees. Do not invent a response for a condition that can never be true. Show the PM each `Blocked by` line and each `impliedBy` id.

<!-- verify stdout 1
build/plan-verify
lint
--json
examples/order-conflict.ears.md
-->
```text
{
  "ok": false,
  "spec": "examples/order-conflict.ears.md",
  "conflicts": [
    {
      "ids": [
        "R2",
        "R3"
      ],
      "minimal": true,
      "everySituation": false,
      "summary": "R2 and R3 cannot both hold.",
      "clash": "They clash when an order was submitted.",
      "requirements": [
        {
          "id": "R2",
          "line": 7,
          "sentence": "When an order is submitted, the Order System shall fulfill the order."
        },
        {
          "id": "R3",
          "line": 8,
          "sentence": "When an order is submitted, the Order System shall not fulfill the order."
        }
      ],
      "situation": [
        {
          "name": "order_submitted",
          "value": "true"
        }
      ],
      "requires": [
        {
          "id": "R2",
          "text": "that the order was fulfilled"
        },
        {
          "id": "R3",
          "text": "that the order was not fulfilled"
        }
      ],
      "example": [
        {
          "name": "order_submitted",
          "value": "true"
        },
        {
          "name": "order_fulfilled",
          "value": "true"
        }
      ],
      "keeps": [
        "R2"
      ],
      "breaks": "R3",
      "fix": "Suggested fix: ask which requirement should win. To keep R2, remove R3. To keep R3, remove R2.",
      "repairs": [
        {
          "kind": "drop",
          "id": "R2",
          "text": "One repair is to drop R2 and keep R3 as written.",
          "sentence": "When an order is submitted, the Order System shall not fulfill the order."
        },
        {
          "kind": "drop",
          "id": "R3",
          "text": "One repair is to drop R3 and keep R2 as written.",
          "sentence": "When an order is submitted, the Order System shall fulfill the order."
        }
      ]
    }
  ],
  "gaps": [],
  "misuse": [],
  "wording": [],
  "redundant": [],
  "duplicate": [],
  "vacuous": [],
  "unused": [],
  "uncovered": [],
  "warnings": []
}
```

`policy` returns `ok`, `spec`, `property`, `holds`, `note`, `acceptedFound`, `accepted`, `rejectedFound`, `rejected`, `counterexampleFound`, `counterexample`, and `breaks`. A scenario list is empty when its `Found` flag is false. Each entry is `name` and `value`. A break is `id`, `line`, `sentence`, and `because`.

<!-- verify stdout 1
build/plan-verify
policy
--json
examples/order.ears.md
--property
examples/order-always.ears.md
-->
```text
{
  "ok": false,
  "spec": "examples/order.ears.md",
  "property": "examples/order-always.ears.md",
  "holds": false,
  "note": "",
  "acceptedFound": false,
  "accepted": [],
  "rejectedFound": false,
  "rejected": [],
  "counterexampleFound": true,
  "counterexample": [
    {
      "name": "order_submitted",
      "value": "false"
    },
    {
      "name": "inventory_available",
      "value": "false"
    },
    {
      "name": "order_fulfilled",
      "value": "false"
    }
  ],
  "breaks": [
    {
      "id": "P1",
      "line": 3,
      "sentence": "The Order System shall fulfill the order.",
      "because": "The order was not fulfilled."
    }
  ]
}
```

`emit-smt --json` returns `ok`, `spec`, and `smt`. `smt` is the plain SMT-LIB text, newlines between lines, none after the last line.

<!-- verify stdout 0
build/plan-verify
emit-smt
--json
examples/order.ears.md
-->
```text
{
  "ok": true,
  "spec": "examples/order.ears.md",
  "smt": "; spec: examples/order.ears.md\n(set-logic ALL)\n; event order_submitted: Bool \"The customer submits an order.\" phrase \"an order is submitted\"\n(declare-fun order_submitted () Bool)\n; state inventory_available: Bool \"Enough stock is on hand to fill the order.\" phrase \"inventory is available\"\n(declare-fun inventory_available () Bool)\n; output order_fulfilled: Bool \"The order is fulfilled.\" phrase \"fulfill the order\" outcome \"the order was fulfilled\" / \"the order was not fulfilled\"\n(declare-fun order_fulfilled () Bool)\n; R1_L7 line 7: WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.\n(assert (! (=> (and order_submitted inventory_available) order_fulfilled) :named R1_L7))"
}
```

A scenario value is `true` or `false`, an integer inside the declared range, or an enum variant string. Every declared name is required. Extra names are rejected. Leading zeros are rejected.

## Milestone 1: one requirement, one scenario

`examples/order.ears.md` says: when an order is submitted and inventory is available, the order is fulfilled. R1 is line 7.

This scenario breaks it. Report `R1`, line 7, and the sentence below:

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

This scenario fits R1:

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

`emit-smt` prints the implication. The comment maps the assertion back to line 7 and the sentence:

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

Lint on that same spec is already useful. The check can pass while a situation is still uncovered:

<!-- verify stdout 1
build/plan-verify
lint
examples/order.ears.md
-->
```text
spec: examples/order.ears.md
conflicts: 0
gaps: 1
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

gap order_fulfilled
Nothing says whether the order was fulfilled when an order was submitted and inventory was not available. Suggested fix: add a requirement for this situation, and ask what the system shall do. Do not choose the response.
```

Ask what should happen in that situation. `examples/order-covered.ears.md` answers every situation, and lint is clean:

<!-- verify stdout 0
build/plan-verify
lint
examples/order-covered.ears.md
-->
```text
spec: examples/order-covered.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0
```

## Combined clauses

`examples/order-combined.ears.md` uses while, when, if, and where. The id is `R1.2`. The printed implication nests `and` in clause order, and the integer range is its own unnamed assertion:

<!-- verify stdout 0
build/plan-verify
emit-smt
examples/order-combined.ears.md
-->
```text
; spec: examples/order-combined.ears.md
(set-logic ALL)
; enum Region { us, eu }
(declare-datatypes ((Region 0)) (((us) (eu))))
; state inventory_available: Bool "Enough stock is on hand to fill the order." phrase "inventory is available"
(declare-fun inventory_available () Bool)
; event order_submitted: Bool "The customer submits an order." phrase "an order is submitted"
(declare-fun order_submitted () Bool)
; input quantity: Int 1..5 "How many units the customer asked for." phrase "the quantity"
(declare-fun quantity () Int)
(assert (and (>= quantity 1) (<= quantity 5)))
; input region: Region "The region the order ships to." phrase "the region"
(declare-fun region () Region)
; output shipped: Int 1..5 "How many units are shipped." phrase "the number shipped" as "ship {value}"
(declare-fun shipped () Int)
(assert (and (>= shipped 1) (<= shipped 5)))
; R1.2_L10 line 10: While inventory is available, when an order is submitted, if the quantity is at least 1, where the region is us, then the Warehouse shall ship the quantity.
(assert (! (=> (and (and (and inventory_available order_submitted) (>= quantity 1)) (= region us)) (= shipped quantity)) :named R1.2_L10))
```

## Bad: the PM has said both things

`examples/order-conflict.ears.md` records two answers for a submitted order. Lint is implemented; this is its real report:

<!-- verify stdout 1
build/plan-verify
lint
examples/order-conflict.ears.md
-->
```text
spec: examples/order-conflict.ears.md
conflicts: 1
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

conflict {R2, R3}
R2 and R3 cannot both hold.

R2 line 7
When an order is submitted, the Order System shall fulfill the order.

R3 line 8
When an order is submitted, the Order System shall not fulfill the order.

They clash when an order was submitted.
R2 requires that the order was fulfilled.
R3 requires that the order was not fulfilled.

Example scenario:
{
  "order_submitted": true,
  "order_fulfilled": true
}
This scenario keeps R2 and breaks R3.

Suggested fix: ask which requirement should win. To keep R2, remove R3. To keep R3, remove R2.

Candidate repairs follow. This report does not choose one.

repair drop R2
One repair is to drop R2 and keep R3 as written.
When an order is submitted, the Order System shall not fulfill the order.

repair drop R3
One repair is to drop R3 and keep R2 as written.
When an order is submitted, the Order System shall fulfill the order.
```

Tell the PM: when an order was submitted, R2 says the order was fulfilled and R3 says the order was not fulfilled. The example keeps R2 and breaks R3 only because R3 is the last requirement in the set. It is evidence, not a vote. Ask which requirement should win, and wait. The repairs under the clash are candidates. For this pair the only candidates are to drop R2 or to drop R3, because both lines have the same condition.

`examples/order-repair.ears.md` is a clash that a single extra condition can separate. R1 allows the loan while the copy is in the building. R2 refuses it while the copy is out on loan. Lint checks each candidate on the patched spec and keeps it only when that conflict is gone and no new conflict appears. It still asks which requirement should win.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-repair.ears.md
-->
```text
spec: examples/order-repair.ears.md
conflicts: 1
gaps: 1
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

conflict {R1, R2}
R1 and R2 cannot both hold.

R1 line 8
While the copy is in the building, when a member asks to take a copy home, the Desk shall allow the loan.

R2 line 9
While the copy is out on loan, when a member asks to take a copy home, the Desk shall not allow the loan.

They clash when the copy was in the building, the copy was out on loan, and a member asks to take a copy home.
R1 requires that the loan was allowed.
R2 requires that the loan was not allowed.

Example scenario:
{
  "copy_in_building": true,
  "copy_on_loan": true,
  "borrow_requested": true,
  "loan_allowed": true
}
This scenario keeps R1 and breaks R2.

Suggested fix: ask which requirement should win. To keep R1, remove R2. To keep R2, remove R1.

Candidate repairs follow. This report does not choose one.

repair drop R1
One repair is to drop R1 and keep R2 as written.
While the copy is out on loan, when a member asks to take a copy home, the Desk shall not allow the loan.

repair drop R2
One repair is to drop R2 and keep R1 as written.
While the copy is in the building, when a member asks to take a copy home, the Desk shall allow the loan.

repair strengthen R1
One repair is to add "and the copy is not out on loan" to the condition of R1. R2 stays as written.
While the copy is in the building, when a member asks to take a copy home and the copy is not out on loan, the Desk shall allow the loan.

repair strengthen R2
One repair is to add "and the copy is not in the building" to the condition of R2. R1 stays as written.
While the copy is out on loan, when a member asks to take a copy home and the copy is not in the building, the Desk shall not allow the loan.

gap loan_allowed
Nothing says whether the loan was allowed when the copy was in the building, the copy was out on loan, and not a member asks to take a copy home. Suggested fix: add a requirement for this situation, and ask what the system shall do. Do not choose the response.
```

## Unwanted events use if, then

`examples/payment-if.ears.md` writes a declined payment with `if` ... `then`. That shape is right for an unwanted event. `If not payment fails` is still a bare negation, so lint asks for a positive condition or a positive event.

<!-- verify stdout 1
build/plan-verify
lint
examples/payment-if.ears.md
-->
```text
spec: examples/payment-if.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 1
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

wording line 7
The trigger is a bare negation. Write a positive condition, such as "When a non-member asks", or declare a positive event.
If not payment fails, then the Order System shall not reject the order.
```

`examples/order-misuse.ears.md` uses `when` for that unwanted event. Show the finding and rewrite it with the PM as `If payment fails, then the Order System shall reject the order.`

<!-- verify stdout 1
build/plan-verify
lint
examples/order-misuse.ears.md
-->
```text
spec: examples/order-misuse.ears.md
conflicts: 0
gaps: 0
misuse: 1
wording: 0
redundant: 1
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

misuse R4 line 6
"payment fails" is an unwanted event. Write if ... then, not when.
When payment fails, the Order System shall reject the order.

redundant R4 line 6
R4 adds nothing. R5 implies it. Whenever the other requirements hold, R4 holds too.
When payment fails, the Order System shall reject the order.
Suggested fix: remove R4, or ask whether it was meant to say something the others do not already require. Do not delete it until the PM agrees.
```

## Vague words and solution words

`examples/order-wording.ears.md` says the system "responds quickly" and stores the order "in the database". Ask what a scenario can check, and what the system must guarantee. The state `saved` is uncovered, because no requirement mentions it.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-wording.ears.md
-->
```text
spec: examples/order-wording.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 2
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 1
warnings: 0

wording line 4
"quickly" is too vague to test. Replace it with something a scenario can check.
output order_fulfilled: Bool "The system responds quickly." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"

wording line 5
"database" names a solution. Say what the system must do, not how to build it.
state saved: Bool "Store the order in the database." phrase "the order is saved"

uncovered saved
No requirement constrains saved ("the order is saved").
Suggested fix: use saved in a requirement, or remove it from the schema.
```

## An event nobody handles

`examples/order-unhandled.ears.md` declares "an order is cancelled" and never says what the system shall do. Tell the PM, and ask them to add the requirement or drop the event. Do not invent the response.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-unhandled.ears.md
-->
```text
spec: examples/order-unhandled.ears.md
conflicts: 0
gaps: 1
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

gap order_cancelled
No requirement handles "an order is cancelled". Suggested fix: add a requirement that says what the system shall do, or remove the event.
```

## An error condition with no response

`examples/order-unanswered.ears.md` declares "payment fails" and no `if` ... `then` says what happens. Ask what the system shall do. Do not choose.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-unanswered.ears.md
-->
```text
spec: examples/order-unanswered.ears.md
conflicts: 0
gaps: 1
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

gap payment_declined
No requirement states a response when "payment fails". Suggested fix: add an if ... then requirement, and ask what the system shall do. Do not choose the response.
```

## Vague: fast, appropriate, user-friendly

`examples/order-vague.ears.md` describes the checkout as fast, appropriate, and user-friendly. Each word is a separate finding. Ask what a scenario can check instead.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-vague.ears.md
-->
```text
spec: examples/order-vague.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 3
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

wording line 4
"fast" is too vague to test. Replace it with something a scenario can check.
output order_fulfilled: Bool "The checkout is fast, appropriate, and user-friendly." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"

wording line 4
"appropriate" is too vague to test. Replace it with something a scenario can check.
output order_fulfilled: Bool "The checkout is fast, appropriate, and user-friendly." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"

wording line 4
"user-friendly" is too vague to test. Replace it with something a scenario can check.
output order_fulfilled: Bool "The checkout is fast, appropriate, and user-friendly." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"
```

## Integer clash

`examples/order-quantity.ears.md` says a submitted order accepts at most 10 units, and also that it accepts exactly 12. Show both sentences, the situation, and the example. The example quantity is 0 because that is the first value that keeps R4. Ask which requirement should win.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-quantity.ears.md
-->
```text
spec: examples/order-quantity.ears.md
conflicts: 1
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

conflict {R4, R5}
R4 and R5 cannot both hold.

R4 line 7
When an order is submitted, the Order System shall accept at most 10 units.

R5 line 8
When an order is submitted, the Order System shall accept 12 units.

They clash when an order was submitted.
R4 requires that at most 10 units were accepted.
R5 requires that 12 units were accepted.

Example scenario:
{
  "order_submitted": true,
  "quantity": 0
}
This scenario keeps R4 and breaks R5.

Suggested fix: ask which requirement should win. To keep R4, remove R5. To keep R5, remove R4.

Candidate repairs follow. This report does not choose one.

repair drop R4
One repair is to drop R4 and keep R5 as written.
When an order is submitted, the Order System shall accept 12 units.

repair drop R5
One repair is to drop R5 and keep R4 as written.
When an order is submitted, the Order System shall accept at most 10 units.
```

## Enum clash

`examples/order-status.ears.md` requires the status to be shipped and cancelled. They clash in every situation. Ask which requirement should win. `placed` is declared and no requirement mentions it, so it is unused.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-status.ears.md
-->
```text
spec: examples/order-status.ears.md
conflicts: 1
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 1
uncovered: 0
warnings: 0

conflict {R6, R7}
R6 and R7 cannot both hold.

R6 line 6
The Order System shall mark the order shipped.

R7 line 7
The Order System shall mark the order cancelled.

They clash in every situation.
R6 requires that the order was shipped.
R7 requires that the order was cancelled.

Example scenario:
{
  "status": "shipped"
}
This scenario keeps R6 and breaks R7.

Suggested fix: ask which requirement should win. To keep R6, remove R7. To keep R7, remove R6.

Candidate repairs follow. This report does not choose one.

repair drop R6
One repair is to drop R6 and keep R7 as written.
The Order System shall mark the order cancelled.

repair drop R7
One repair is to drop R7 and keep R6 as written.
The Order System shall mark the order shipped.

unused Status.placed
Status.placed is never mentioned.
Suggested fix: use placed in a requirement, or remove it from Status.
```

## Policy

A property file is requirement lines only. It cannot declare symbols. It uses the phrases from the spec. Ids are `P` or `R`, then digits, such as `P1`.

```ears
P1 The Order System shall fulfill the order.
```

No property. One scenario the order requirements allow, and one they forbid:

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

The allowed scenario leaves the trigger false, so R1 does not apply. Say that. It is not the behavior they asked for.

`examples/order-covered.ears.md` forbids fulfilling an order that was not submitted:

<!-- verify stdout 0
build/plan-verify
policy
examples/order-covered.ears.md
-->
```text
spec: examples/order-covered.ears.md
accepted:
{
  "order_submitted": false,
  "inventory_available": false,
  "order_fulfilled": false
}
This scenario satisfies every requirement.
rejected:
{
  "order_submitted": false,
  "inventory_available": false,
  "order_fulfilled": true
}
This scenario violates a requirement.

R3 line 9
When an order is not submitted, the Order System shall not fulfill the order.
An order was not submitted, but the order was fulfilled.
```

`examples/order-always.ears.md` says the order is always fulfilled. The requirements allow a scenario where it is not:

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

Tell the PM the requirements allow that scenario, so the property is not backed by them. Ask whether the property should become a requirement. Do not add it yourself.

`examples/order-same.ears.md` repeats R1, so no counterexample exists:

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

If lint already found that the requirements cannot all hold, policy will not invent a scenario that satisfies them:

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

Run lint for the clash, and ask which requirement should win, before you spend time on the property.

## Three requirements, no pair

`examples/order-chain.ears.md` cannot all hold, and every pair can. Tell the PM the three sentences, that removing any one of them leaves the rest consistent, and the example that keeps the first two. Ask which requirement should change. Do not pick one.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-chain.ears.md
-->
```text
spec: examples/order-chain.ears.md
conflicts: 1
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

conflict {R1, R2, R3}
R1, R2, and R3 cannot all hold.

R1 line 7
When an order is submitted, the Order System shall accept the order.

R2 line 8
When the order is accepted, the Order System shall ship the order.

R3 line 9
When an order is submitted, the Order System shall not ship the order.

They clash when an order was submitted.
R1 requires that the order was accepted.
R3 requires that the order was not shipped.

Example scenario:
{
  "order_submitted": true,
  "order_accepted": true,
  "order_shipped": true
}
This scenario keeps R1 and R2 and breaks R3.

Suggested fix: ask which requirement should win. Removing any one of R1, R2, and R3 leaves the rest consistent.

Candidate repairs follow. This report does not choose one.

repair drop R1
One repair is to drop R1 and keep R2 and R3 as written.
When the order is accepted, the Order System shall ship the order.
When an order is submitted, the Order System shall not ship the order.

repair drop R2
One repair is to drop R2 and keep R1 and R3 as written.
When an order is submitted, the Order System shall accept the order.
When an order is submitted, the Order System shall not ship the order.

repair drop R3
One repair is to drop R3 and keep R1 and R2 as written.
When an order is submitted, the Order System shall accept the order.
When the order is accepted, the Order System shall ship the order.

repair strengthen R2
One repair is to add "and an order is not submitted" to the condition of R2. R1 and R3 stay as written.
When the order is accepted and an order is not submitted, the Order System shall ship the order.
```

## A requirement that adds nothing

When lint says a requirement adds nothing, show the sentence, the requirements that imply it, and the suggested fix. Ask whether they meant something those requirements do not already require. Do not delete it. The finding stays exit 0.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-redundant.ears.md
-->
```text
spec: examples/order-redundant.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 1
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

redundant R2 line 8
R2 adds nothing. R1 implies it. Whenever the other requirements hold, R2 holds too.
When an order is submitted and inventory is available, the Order System shall fulfill the order.
Suggested fix: remove R2, or ask whether it was meant to say something the others do not already require. Do not delete it until the PM agrees.
```

A conflict does not hide a repeat that sits outside it. Show that requirement too. An exact duplicate is a separate finding: same condition, same response. Ask whether the later line was meant to differ. A bare `not` at the start of a trigger is wording kind `negation`. Ask for a positive condition or a positive event. `as needed` is too vague to test unless those words are the declared phrase.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-repeat.ears.md
-->
```text
spec: examples/order-repeat.ears.md
conflicts: 1
gaps: 0
misuse: 0
wording: 0
redundant: 1
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

conflict {R1, R2}
R1 and R2 cannot both hold.

R1 line 8
When an order is submitted, the Order System shall fulfill the order.

R2 line 9
When an order is submitted, the Order System shall not fulfill the order.

They clash when an order was submitted and inventory was not available.
R1 requires that the order was fulfilled.
R2 requires that the order was not fulfilled.

Example scenario:
{
  "order_submitted": true,
  "inventory_available": false,
  "order_fulfilled": true,
  "order_closed": false
}
This scenario keeps R1 and breaks R2.

Suggested fix: ask which requirement should win. To keep R1, remove R2. To keep R2, remove R1.

Candidate repairs follow. This report does not choose one.

repair drop R1
One repair is to drop R1 and keep R2 as written.
When an order is submitted, the Order System shall not fulfill the order.

repair drop R2
One repair is to drop R2 and keep R1 as written.
When an order is submitted, the Order System shall fulfill the order.

redundant R5 line 12
R5 adds nothing. R4 implies it. Whenever the requirements outside a conflict hold, R5 holds too.
When an order is submitted and inventory is available, the Order System shall close the order.
Suggested fix: remove R5, or ask whether it was meant to say something the others do not already require. Do not delete it until the PM agrees.
```

<!-- verify stdout 1
build/plan-verify
lint
examples/order-duplicate.ears.md
-->
```text
spec: examples/order-duplicate.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 1
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

duplicate R2 line 7
R2 duplicates R1. The condition and the response are the same.
When an order is submitted, the Order System shall fulfill the order.
Suggested fix: remove R2, or ask whether it was meant to differ from R1. Do not delete it until the PM agrees.
```

<!-- verify stdout 1
build/plan-verify
lint
examples/order-negation.ears.md
-->
```text
spec: examples/order-negation.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 1
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

wording line 6
The trigger is a bare negation. Write a positive condition, such as "When a non-member asks", or declare a positive event.
When not a member asks to take a copy home, the Desk shall not allow the loan.
```

<!-- verify stdout 1
build/plan-verify
lint
examples/order-unmeasured.ears.md
-->
```text
spec: examples/order-unmeasured.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 1
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

wording line 4
"as needed" is too vague to test. Replace it with something a scenario can check.
output order_fulfilled: Bool "Handle it as needed." phrase "fulfill the order" outcome "the order was fulfilled" / "the order was not fulfilled"
```

## A condition that can never be true

Show the requirement, each `Blocked by` line, and the suggested fix. A condition that contradicts itself, a comparison outside a declared range, or a trigger that other always-true requirements make impossible never fires. Ask the PM to rewrite the condition. Do not invent a response. Do not also call that requirement redundant or a duplicate. This finding exits 1.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-vacuous.ears.md
-->
```text
spec: examples/order-vacuous.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 2
unused: 0
uncovered: 0
warnings: 0

vacuous R1 line 7
R1 can never trigger. Its condition is impossible for every allowed value.
When the cart is open and the cart is not open, the Checkout shall accept the order.
Blocked by the condition contradicts itself.
Suggested fix: rewrite the condition in R1 so a real situation can make it true, or remove the requirement. Do not invent a response.

vacuous R2 line 8
R2 can never trigger. Its condition is impossible for every allowed value.
When the quantity is at least 9, the Checkout shall accept the order.
Blocked by the quantity is 1..5.
Suggested fix: rewrite the condition in R2 so a real situation can make it true, or remove the requirement. Do not invent a response.
```

## A trigger other requirements make impossible

Show the requirement, the sentence, and each `Blocked by` line. The list is the smallest set of always-true requirements, or the schema fact, that makes the trigger impossible. Ask the PM to rewrite the condition. Do not invent a response. This exits 1. `examples/order-reachable.ears.md` is a trigger that can happen, and lint is quiet.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-blocked.ears.md
-->
```text
spec: examples/order-blocked.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 1
unused: 0
uncovered: 0
warnings: 0

vacuous R3 line 9
R3 can never trigger. Its condition is impossible for every allowed value.
When the gate is open or the shift is open, the Desk shall finish the job.
Blocked by R1.
Blocked by R2.
Suggested fix: rewrite the condition in R3 so a real situation can make it true, or remove the requirement. Do not invent a response.
```

<!-- verify stdout 0
build/plan-verify
lint
examples/order-reachable.ears.md
-->
```text
spec: examples/order-reachable.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0
```

## An output, state, or enum value nothing produces

`uncovered` lists a state no requirement mentions, an output no response sets, and an enum value of a constrained output that no requirement can produce. Show the name and the suggested fix. Ask whether to constrain it or remove it. Do not choose the value. This stays exit 0. `examples/order-lane.ears.md` produces every declared lane value.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-uncovered.ears.md
-->
```text
spec: examples/order-uncovered.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 3
warnings: 0

uncovered loyalty
No requirement constrains loyalty ("the customer is loyal").
Suggested fix: use loyalty in a requirement, or remove it from the schema.

uncovered receipt_sent
No requirement constrains receipt_sent ("a receipt is sent").
Suggested fix: add a shall requirement that sets receipt_sent, or remove it from the schema. Do not choose the value.

uncovered Lane.refund
No requirement can set "the lane" to refund.
Suggested fix: add a requirement that produces refund, or remove it from Lane.
```

<!-- verify stdout 0
build/plan-verify
lint
examples/order-lane.ears.md
-->
```text
spec: examples/order-lane.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0
```

## Schema the requirements never use

An input that no requirement mentions, and an enum variant that no requirement mentions, are unused. That exits 1. A state no requirement mentions, an output no response sets, and an enum value a constrained output can never produce are uncovered. That is a warning and exits 0 when it is the only finding. An output that nobody mentions at all is a gap. An event that nobody handles is a gap. Do not choose a value for an output nothing sets. When the spec already conflicts, do not treat every enum value as unreachable.

<!-- verify stdout 1
build/plan-verify
lint
examples/order-unused.ears.md
-->
```text
spec: examples/order-unused.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 1
uncovered: 3
warnings: 0

unused region
region ("the region") is an input and no requirement mentions it.
Suggested fix: use region in a requirement, or remove it from the schema.

uncovered loyalty
No requirement constrains loyalty ("the customer is loyal").
Suggested fix: use loyalty in a requirement, or remove it from the schema.

uncovered receipt_sent
No requirement constrains receipt_sent ("a receipt is sent").
Suggested fix: add a shall requirement that sets receipt_sent, or remove it from the schema. Do not choose the value.

uncovered Lane.refund
No requirement can set "the lane" to refund.
Suggested fix: add a requirement that produces refund, or remove it from Lane.
```

<!-- verify stdout 1
build/plan-verify
lint
--json
examples/order-unused.ears.md
-->
```text
{
  "ok": false,
  "spec": "examples/order-unused.ears.md",
  "conflicts": [],
  "gaps": [],
  "misuse": [],
  "wording": [],
  "redundant": [],
  "duplicate": [],
  "vacuous": [],
  "unused": [
    {
      "name": "region",
      "kind": "input",
      "text": "region (\"the region\") is an input and no requirement mentions it.",
      "fix": "Suggested fix: use region in a requirement, or remove it from the schema."
    }
  ],
  "uncovered": [
    {
      "name": "loyalty",
      "kind": "state",
      "text": "No requirement constrains loyalty (\"the customer is loyal\").",
      "fix": "Suggested fix: use loyalty in a requirement, or remove it from the schema."
    },
    {
      "name": "receipt_sent",
      "kind": "output",
      "text": "No requirement constrains receipt_sent (\"a receipt is sent\").",
      "fix": "Suggested fix: add a shall requirement that sets receipt_sent, or remove it from the schema. Do not choose the value."
    },
    {
      "name": "Lane.refund",
      "kind": "variant",
      "text": "No requirement can set \"the lane\" to refund.",
      "fix": "Suggested fix: add a requirement that produces refund, or remove it from Lane."
    }
  ],
  "warnings": []
}
```

## Scenarios

`scenarios` prints accepted and rejected examples for each requirement, with the trigger true and the trigger false. Use them to check that you heard the PM correctly. Do not treat a generated scenario as the behavior they agreed to. The same assignment is printed once. A requirement with no trigger says so.

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

`--json` rows are `id`, `line`, `kind`, `trigger`, `found`, `sameAs`, `scenario`, and `text`.

<!-- verify stdout 0
build/plan-verify
scenarios
--json
examples/order.ears.md
-->
```text
{
  "ok": true,
  "spec": "examples/order.ears.md",
  "scenarios": [
    {
      "id": "R1",
      "line": 7,
      "kind": "accepted",
      "trigger": "true",
      "found": true,
      "sameAs": "",
      "scenario": [
        {
          "name": "order_submitted",
          "value": "true"
        },
        {
          "name": "inventory_available",
          "value": "true"
        },
        {
          "name": "order_fulfilled",
          "value": "true"
        }
      ],
      "text": "An order was submitted and inventory was available, and the order was fulfilled."
    },
    {
      "id": "R1",
      "line": 7,
      "kind": "accepted",
      "trigger": "false",
      "found": true,
      "sameAs": "",
      "scenario": [
        {
          "name": "order_submitted",
          "value": "false"
        },
        {
          "name": "inventory_available",
          "value": "false"
        },
        {
          "name": "order_fulfilled",
          "value": "false"
        }
      ],
      "text": "An order was not submitted and inventory was not available, and the order was not fulfilled."
    },
    {
      "id": "R1",
      "line": 7,
      "kind": "rejected",
      "trigger": "true",
      "found": true,
      "sameAs": "",
      "scenario": [
        {
          "name": "order_submitted",
          "value": "true"
        },
        {
          "name": "inventory_available",
          "value": "true"
        },
        {
          "name": "order_fulfilled",
          "value": "false"
        }
      ],
      "text": "An order was submitted and inventory was available, but the order was not fulfilled."
    }
  ]
}
```

## From a spec to scenario files

Write the requirement in EARS. `examples/order.ears.md` says that when an order is submitted and inventory is available, the Order System shall fulfill the order.

Lint that file. A gap is a situation with no response. Ask what the system shall do there.

<!-- verify stdout 1
build/plan-verify
lint
examples/order.ears.md
-->
```text
spec: examples/order.ears.md
conflicts: 0
gaps: 1
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

gap order_fulfilled
Nothing says whether the order was fulfilled when an order was submitted and inventory was not available. Suggested fix: add a requirement for this situation, and ask what the system shall do. Do not choose the response.
```

`examples/order-covered.ears.md` is the fix: the order is not fulfilled when inventory is missing, and it is not fulfilled when no order was submitted. Lint is clean.

<!-- verify stdout 0
build/plan-verify
lint
examples/order-covered.ears.md
-->
```text
spec: examples/order-covered.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 0
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0
```

Generate one file per case. `R1-accepted.json` keeps the trigger true and the response true. `R1-rejected-cond2.json` lets condition 2 decide the trigger and breaks R1 alone. `R1-accepted-cond2.json` flips that condition so the trigger is false and every requirement holds. The same names are written for R2 and R3.

<!-- verify stdout 0
build/plan-verify
scenarios
examples/order-covered.ears.md
--out
build/skill-scenarios
-->
```text
spec: examples/order-covered.ears.md
out: build/skill-scenarios
scenarios: 13
uncovered: 0

R1-accepted.json
accepted R1 line 7
An order was submitted and inventory was available, and the order was fulfilled.

R1-rejected-cond1.json
rejected R1 line 7, condition 1
An order was submitted and inventory was available, but the order was not fulfilled.

R1-accepted-cond1.json
accepted R1 line 7, condition 1
Flipping condition 1 ("an order is submitted") makes the trigger false. An order was not submitted and inventory was available, and the order was not fulfilled.

R1-rejected-cond2.json
rejected R1 line 7, condition 2
An order was submitted and inventory was available, but the order was not fulfilled.

R1-accepted-cond2.json
accepted R1 line 7, condition 2
Flipping condition 2 ("inventory is available") makes the trigger false. An order was submitted and inventory was not available, and the order was not fulfilled.

R2-accepted.json
accepted R2 line 8
An order was submitted and inventory was not available, and the order was not fulfilled.

R2-rejected-cond1.json
rejected R2 line 8, condition 1
An order was submitted and inventory was not available, but the order was fulfilled.

R2-accepted-cond1.json
accepted R2 line 8, condition 1
Flipping condition 1 ("an order is submitted") makes the trigger false. An order was not submitted and inventory was not available, and the order was not fulfilled.

R2-rejected-cond2.json
rejected R2 line 8, condition 2
An order was submitted and inventory was not available, but the order was fulfilled.

R2-accepted-cond2.json
accepted R2 line 8, condition 2
Flipping condition 2 ("not inventory is available") makes the trigger false. An order was submitted and inventory was available, and the order was fulfilled.

R3-accepted.json
accepted R3 line 9
An order was not submitted, and the order was not fulfilled.

R3-rejected-cond1.json
rejected R3 line 9, condition 1
An order was not submitted, but the order was fulfilled.

R3-accepted-cond1.json
accepted R3 line 9, condition 1
Flipping condition 1 ("not an order is submitted") makes the trigger false. An order was submitted, and the order was not fulfilled.
```

Feed a rejected file back to `check`. The report names that requirement.

<!-- verify stdout 1
build/plan-verify
check
examples/order-covered.ears.md
--input
build/skill-scenarios/R1-rejected-cond2.json
-->
```text
spec: examples/order-covered.ears.md
scenario: build/skill-scenarios/R1-rejected-cond2.json
violations: 1

R1 line 7
When an order is submitted and inventory is available, the Order System shall fulfill the order.
An order was submitted and inventory was available, but the order was not fulfilled.
```

A generated file is an example for checking what you heard. A condition listed as uncovered is one the solver could not show flipping the outcome, and the sentence says why. `examples/order-vacuous.ears.md` and `examples/order-combined.ears.md` are those reports. The file names and the manifest are in `docs/scenarios.md`.

## What you do not do

- You do not pick the winning requirement.
- You do not delete a redundant requirement until the PM agrees.
- You do not invent a response for a condition that can never be true.
- You do not choose a value for an output nothing sets.
- You do not drop a conflict and move on to a design, an API, or a schema for the build.
- You do not treat the example scenario as the behavior they agreed to.
- You do not introduce a second name for an idea that already has one.
- You do not report a check violation without its requirement ID, line, and sentence.
