# Repair

`repair` runs the same analysis as `lint`, then proposes one edit for each minimal conflict, each vacuous requirement, and each completeness gap lint already reports. It prints the proposals. `--apply` writes them to `<spec>.repaired.ears.md`, or to `--out <path>`. A path that ends in `.ears.md` gets `.repaired` inserted before that suffix. `--json` lists each proposal. The object is in [json.md](json.md).

Exit 0 means there is nothing to propose. Exit 1 means proposals were printed, including when `--apply` wrote a file. Exit 2 is a missing file, a parse error, or a usage error. `--out` without `--apply` is an error.

A conflict prefers, in order, a narrower WHEN or IF, dropping one always-true SHALL, then a new WHERE or IF guard. The new words use only declared schema names. A vacuous requirement is rewritten so its trigger can be true, or removed, and the report names what blocked it. A gap gets one new WHEN or IF requirement that covers that output or event. Each proposal is checked on its own. The whole set is checked together. `--apply` writes the file when that set has no conflict, gap, vacuous requirement, or other hard finding. A redundant requirement can remain, and lint still exits 0.

## Conflict

`examples/order-conflict.ears.md` has two answers for a submitted order. The smallest change that restores consistency is to drop R3.

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

`--apply` writes the edited spec. A later `lint` of that file exits 0.

<!-- verify stdout 1
build/plan-verify
repair
examples/order-conflict.ears.md
--apply
--out
build/repair-doc-conflict.ears.md
-->
```text
spec: examples/order-conflict.ears.md
proposals: 1
wrote: build/repair-doc-conflict.ears.md

proposal conflict R2, R3
Drop R3.
clears R2, R3
before:
When an order is submitted, the Order System shall not fulfill the order.
after:
dropped
```

<!-- verify stdout 0
build/plan-verify
lint
build/repair-doc-conflict.ears.md
-->
```text
spec: build/repair-doc-conflict.ears.md
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

## Vacuous

`examples/order-vacuous.ears.md` has a trigger that contradicts itself and a quantity outside the declared range. Each requirement is rewritten so the trigger can be true. The blockers are named.

<!-- verify stdout 1
build/plan-verify
repair
examples/order-vacuous.ears.md
-->
```text
spec: examples/order-vacuous.ears.md
proposals: 2

proposal vacuous R1
Rewrite R1.
clears R1
Blocked by the condition contradicts itself.
before:
When the cart is open and the cart is not open, the Checkout shall accept the order.
after:
When the cart is open, the Checkout shall accept the order.

proposal vacuous R2
Rewrite R2.
clears R2
Blocked by the quantity is 1..5.
before:
When the quantity is at least 9, the Checkout shall accept the order.
after:
When the quantity is at least 5, the Checkout shall accept the order.
```

The written file lints with exit 0. The rewritten requirements add nothing beyond R3, so lint reports them as redundant.

<!-- verify stdout 1
build/plan-verify
repair
examples/order-vacuous.ears.md
--apply
--out
build/repair-doc-vacuous.ears.md
-->
```text
spec: examples/order-vacuous.ears.md
proposals: 2
wrote: build/repair-doc-vacuous.ears.md

proposal vacuous R1
Rewrite R1.
clears R1
Blocked by the condition contradicts itself.
before:
When the cart is open and the cart is not open, the Checkout shall accept the order.
after:
When the cart is open, the Checkout shall accept the order.

proposal vacuous R2
Rewrite R2.
clears R2
Blocked by the quantity is 1..5.
before:
When the quantity is at least 9, the Checkout shall accept the order.
after:
When the quantity is at least 5, the Checkout shall accept the order.
```

<!-- verify stdout 0
build/plan-verify
lint
build/repair-doc-vacuous.ears.md
-->
```text
spec: build/repair-doc-vacuous.ears.md
conflicts: 0
gaps: 0
misuse: 0
wording: 0
redundant: 2
duplicate: 0
vacuous: 0
unused: 0
uncovered: 0
warnings: 0

redundant R1 line 7
R1 adds nothing. R3 implies it. Whenever the other requirements hold, R1 holds too.
When the cart is open, the Checkout shall accept the order.
Suggested fix: remove R1, or ask whether it was meant to say something the others do not already require. Do not delete it until the PM agrees.

redundant R2 line 8
R2 adds nothing. R3 implies it. Whenever the other requirements hold, R2 holds too.
When the quantity is at least 5, the Checkout shall accept the order.
Suggested fix: remove R2, or ask whether it was meant to say something the others do not already require. Do not delete it until the PM agrees.
```

`examples/order-blocked.ears.md` cannot be rewritten inside the declared names, so the proposal drops the requirement and names the requirements that block it.

<!-- verify stdout 1
build/plan-verify
repair
examples/order-blocked.ears.md
-->
```text
spec: examples/order-blocked.ears.md
proposals: 1

proposal vacuous R3
Drop R3.
clears R3
Blocked by R1.
Blocked by R2.
before:
When the gate is open or the shift is open, the Desk shall finish the job.
after:
dropped
```

## Completeness gap

`examples/order.ears.md` says when the order is fulfilled and leaves the other situations open. The proposal adds one requirement that covers the hole, using the declared names.

<!-- verify stdout 1
build/plan-verify
repair
examples/order.ears.md
-->
```text
spec: examples/order.ears.md
proposals: 1

proposal gap order_fulfilled
Add R2.
clears order_fulfilled
before:
none
after:
When an order is not submitted or inventory is not available, the Order System shall not fulfill the order.
```

An event with no requirement is the same kind of gap. `examples/order-unhandled.ears.md` gets one new requirement that mentions the event.

<!-- verify stdout 1
build/plan-verify
repair
examples/order-unhandled.ears.md
-->
```text
spec: examples/order-unhandled.ears.md
proposals: 1

proposal gap order_cancelled
Add R3.
clears order_cancelled
before:
none
after:
When an order is cancelled and an order is submitted, the Order System shall fulfill the order.
```

## Clean spec

`examples/order-covered.ears.md` already gives every situation a response. `repair` prints no proposals and exits 0.

<!-- verify stdout 0
build/plan-verify
repair
examples/order-covered.ears.md
-->
```text
spec: examples/order-covered.ears.md
proposals: 0
```
