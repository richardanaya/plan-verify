# Explain

`explain` reads a spec and one scenario. For each requirement the scenario breaks, it prints the id, the line, and the sentence, then which atomic trigger conditions were true and which were false, the response values the scenario assigned, and one line that ties those values together. It also looks for the smallest change to declared inputs, states, and events that makes every requirement hold. Output values stay as the scenario gave them. When that change exists, the report prints it. `--out <dir>` writes `<id>.json`, and `check --input` accepts that file. When no such change exists, the report says `flip: none`.

Exit codes match `check`: 0 when the scenario passes, 1 when a requirement fails, 2 when a file or argument is wrong. `check --explain` prints the usual violations, then the same account. `--json` adds an `explanations` array. The fields are in [json.md](json.md).

## One violation

`examples/order-fail.json` submits an order, has inventory, and leaves the order unfulfilled.

<!-- verify stdout 1
build/plan-verify
explain
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
conditions:
  order_submitted: true
  inventory_available: true
shall:
  order_fulfilled: false
because: trigger held because order_submitted=true and inventory_available=true; SHALL failed because order_fulfilled stayed false
flip:
  order_submitted: true -> false
```

`check --explain` prints the violation, then that account.

<!-- verify stdout 1
build/plan-verify
check
examples/order.ears.md
--input
examples/order-fail.json
--explain
-->
```text
spec: examples/order.ears.md
scenario: examples/order-fail.json
violations: 1

R1 line 7
WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.
An order was submitted and inventory was available, but the order was not fulfilled.

R1 line 7
WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.
conditions:
  order_submitted: true
  inventory_available: true
shall:
  order_fulfilled: false
because: trigger held because order_submitted=true and inventory_available=true; SHALL failed because order_fulfilled stayed false
flip:
  order_submitted: true -> false
```

`--out` writes the flipped scenario. A later `check` exits 0.

<!-- verify stdout 1
build/plan-verify
explain
examples/order.ears.md
--input
examples/order-fail.json
--out
build/explain-doc
-->
```text
spec: examples/order.ears.md
scenario: examples/order-fail.json
violations: 1

R1 line 7
WHEN an order is submitted AND inventory is available, THE Order System SHALL fulfill the order.
conditions:
  order_submitted: true
  inventory_available: true
shall:
  order_fulfilled: false
because: trigger held because order_submitted=true and inventory_available=true; SHALL failed because order_fulfilled stayed false
flip:
  order_submitted: true -> false
wrote: build/explain-doc/R1.json
```

<!-- verify stdout 0
build/plan-verify
check
examples/order.ears.md
--input
build/explain-doc/R1.json
-->
```text
spec: examples/order.ears.md
scenario: build/explain-doc/R1.json
violations: 0
```

## Several violations

`examples/order-chain.ears.md` accepts an order when it is submitted, and refuses to ship a submitted order. `test/fixtures/explain-chain-two.json` submits the order, leaves it unaccepted, and ships it. Both R1 and R3 fail. One event change clears both.

<!-- verify stdout 1
build/plan-verify
explain
examples/order-chain.ears.md
--input
test/fixtures/explain-chain-two.json
-->
```text
spec: examples/order-chain.ears.md
scenario: test/fixtures/explain-chain-two.json
violations: 2

R1 line 7
When an order is submitted, the Order System shall accept the order.
conditions:
  order_submitted: true
shall:
  order_accepted: false
because: trigger held because order_submitted=true; SHALL failed because order_accepted stayed false
flip:
  order_submitted: true -> false

R3 line 9
When an order is submitted, the Order System shall not ship the order.
conditions:
  order_submitted: true
shall:
  order_shipped: true
because: trigger held because order_submitted=true; SHALL failed because order_shipped stayed true
flip:
  order_submitted: true -> false
```

## A passing scenario

`examples/order-pass.json` fulfills a submitted order that has inventory. There is nothing to explain.

<!-- verify stdout 0
build/plan-verify
explain
examples/order.ears.md
--input
examples/order-pass.json
-->
```text
spec: examples/order.ears.md
scenario: examples/order-pass.json
violations: 0
```

## No flip

`test/fixtures/explain-chain-stuck.json` accepts the order and does not ship it. R2 requires the shipment because the order is accepted, and acceptance is an output, so it stays true. Changing the only event still leaves R2 broken.

<!-- verify stdout 1
build/plan-verify
explain
examples/order-chain.ears.md
--input
test/fixtures/explain-chain-stuck.json
-->
```text
spec: examples/order-chain.ears.md
scenario: test/fixtures/explain-chain-stuck.json
violations: 1

R2 line 8
When the order is accepted, the Order System shall ship the order.
conditions:
  order_accepted: true
shall:
  order_shipped: false
because: trigger held because order_accepted=true; SHALL failed because order_shipped stayed false
flip: none
```

`examples/order-status.ears.md` has the same result for another reason: both requirements are always true, and they demand different statuses. With no input, state, or event to change, the flip is `none`.

<!-- verify stdout 1
build/plan-verify
explain
examples/order-status.ears.md
--input
test/fixtures/explain-status.json
-->
```text
spec: examples/order-status.ears.md
scenario: test/fixtures/explain-status.json
violations: 2

R6 line 6
The Order System shall mark the order shipped.
conditions:
  none
shall:
  status: placed
because: SHALL failed because status stayed placed
flip: none

R7 line 7
The Order System shall mark the order cancelled.
conditions:
  none
shall:
  status: placed
because: SHALL failed because status stayed placed
flip: none
```
