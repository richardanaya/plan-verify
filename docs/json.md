# JSON

`--json` prints one object on stdout and leaves stderr empty. The keys below do not change. Wrong arguments, and a file that cannot be read or parsed, are exit 2. Plain-text findings are in [lint.md](lint.md). Grammar and the solver are in [reference.md](reference.md).

<!-- verify stdout 2
build/plan-verify
emit-smt
--json
-->
```text
{
  "ok": false,
  "error": "usage: plan-verify emit-smt [--json] <spec>"
}
```

`check` is `ok`, `spec`, `scenario`, and `violations`. Each violation is `id`, `line`, `sentence`, and `because`. `ok` is true when `violations` is empty.

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

`lint` is `ok`, `spec`, `conflicts`, `gaps`, `misuse`, `wording`, `redundant`, `duplicate`, `vacuous`, `unused`, `uncovered`, and `warnings`. A conflict is `ids`, `minimal`, `everySituation`, `summary`, `clash`, `requirements` (`id`, `line`, `sentence`), `situation` and `example` (`name`, `value`), `requires` (`id`, `text`), `keeps`, `breaks`, and `fix`. A gap is `output`, `situation`, and `text`. Misuse is `id`, `line`, `symbols`, `sentence`, and `text`. Wording is `line`, `word`, `kind`, `text`, and `context`. `kind` is `vague`, `solution`, `form`, or `negation`. A redundant requirement is `id`, `line`, `sentence`, `text`, `fix`, and `impliedBy` (the requirement ids that already require it). An exact duplicate is `id`, `line`, `sameAs`, `sentence`, `text`, and `fix`. A vacuous requirement is `id`, `line`, `sentence`, `text`, `fix`, and `because` (the requirement ids or schema facts that make the trigger impossible). An unused entry is `name`, `kind` (`input` or `variant`), `text`, and `fix`. An uncovered entry is `name`, `kind` (`state`, `output`, or `variant`), `text`, and `fix`. A warning is `id`, `line`, `sentence`, `kind` (`vague`, `modal`, `compound`, or `untestable`), `word`, `text`, and `fix`. `ok` stays true when the only findings are warnings, redundant requirements, or uncovered names, and the exit status stays 0. Conflicts, gaps, misuse, wording, duplicates, vacuous requirements, and unused names make `ok` false and exit 1.

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

`policy` is `ok`, `spec`, `property`, `holds`, `note`, `acceptedFound`, `accepted`, `rejectedFound`, `rejected`, `counterexampleFound`, `counterexample`, and `breaks`. A scenario is a list of `name` and `value`. The list is empty when the matching `Found` flag is false. A break is `id`, `line`, `sentence`, and `because`.

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

`diff` is `ok`, `old`, `new`, `out`, `schema`, `added`, `removed`, `renamed`, `reworded`, `files`, the two witness groups, `note`, `conflictsFixed`, `conflictsNew`, `gapsFixed`, and `gapsNew`. `schema` holds `onlyOld`, `onlyNew`, `changed`, and `skipped`. `ok` is true when no witness exists and `skipped` is empty. `note` is `No scenario changes acceptance.` in that case, and empty when a witness exists. An added or removed requirement is `id`, `line`, and `sentence`. A renamed row is `oldId`, `oldLine`, `newId`, `newLine`, and `sentence`. A reworded row adds `sameMeaning`. `files` names the witness files `--out` writes. A scenario row is `name` and `value`. A break is `id`, `line`, `sentence`, and `because`. A side row is `id`, `line`, `present`, `sentence`, `holds`, and `because`. `present` is false when that id is absent from that version. A conflict delta is `ids` and `summary`. A gap delta is `output` and `text`. A file that cannot be parsed is the usual error object and exit 2.

<!-- verify stdout 1
build/plan-verify
diff
--json
examples/order-v1.ears.md
examples/order-v2.ears.md
-->
```text
{
  "ok": false,
  "old": "examples/order-v1.ears.md",
  "new": "examples/order-v2.ears.md",
  "out": "",
  "schema": {
    "onlyOld": [],
    "onlyNew": [],
    "changed": [],
    "skipped": []
  },
  "added": [
    {
      "id": "R2",
      "line": 8,
      "sentence": "WHEN an order is submitted AND inventory is not available, THE Order System SHALL not fulfill the order."
    },
    {
      "id": "R3",
      "line": 9,
      "sentence": "WHEN an order is not submitted, THE Order System SHALL not fulfill the order."
    }
  ],
  "removed": [],
  "renamed": [],
  "reworded": [],
  "files": [
    {
      "file": "old-accepts-new-rejects.json",
      "kind": "old-accepts-new-rejects"
    }
  ],
  "oldAcceptsNewRejectsFound": true,
  "oldAcceptsNewRejects": [
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
      "value": "true"
    }
  ],
  "oldAcceptsBreaks": [
    {
      "id": "R3",
      "line": 9,
      "sentence": "WHEN an order is not submitted, THE Order System SHALL not fulfill the order.",
      "because": "An order was not submitted, but the order was fulfilled."
    }
  ],
  "oldAcceptsOldSides": [
    {
      "id": "R3",
      "line": 0,
      "present": false,
      "sentence": "",
      "holds": false,
      "because": ""
    }
  ],
  "newAcceptsOldRejectsFound": false,
  "newAcceptsOldRejects": [],
  "newAcceptsBreaks": [],
  "newAcceptsNewSides": [],
  "note": "",
  "conflictsFixed": [],
  "conflictsNew": [],
  "gapsFixed": [
    {
      "output": "order_fulfilled",
      "text": "Nothing says whether the order was fulfilled when an order was submitted and inventory was not available. Suggested fix: add a requirement for this situation, and ask what the system shall do. Do not choose the response."
    }
  ],
  "gapsNew": []
}
```

<!-- verify stdout 1
build/plan-verify
diff
--json
test/fixtures/diff-type-old.ears.md
test/fixtures/diff-type-new.ears.md
-->
```text
{
  "ok": false,
  "old": "test/fixtures/diff-type-old.ears.md",
  "new": "test/fixtures/diff-type-new.ears.md",
  "out": "",
  "schema": {
    "onlyOld": [],
    "onlyNew": [],
    "changed": [],
    "skipped": [
      {
        "name": "order_fulfilled",
        "text": "order_fulfilled is Bool in test/fixtures/diff-type-old.ears.md and Int in test/fixtures/diff-type-new.ears.md. Left out of the comparison."
      }
    ]
  },
  "added": [],
  "removed": [],
  "renamed": [],
  "reworded": [
    {
      "id": "R1",
      "oldLine": 3,
      "oldSentence": "The Order System shall fulfill the order.",
      "newLine": 3,
      "newSentence": "The Order System shall fulfill 1 orders.",
      "sameMeaning": false
    }
  ],
  "files": [],
  "oldAcceptsNewRejectsFound": false,
  "oldAcceptsNewRejects": [],
  "oldAcceptsBreaks": [],
  "oldAcceptsOldSides": [],
  "newAcceptsOldRejectsFound": false,
  "newAcceptsOldRejects": [],
  "newAcceptsBreaks": [],
  "newAcceptsNewSides": [],
  "note": "No scenario changes acceptance.",
  "conflictsFixed": [],
  "conflictsNew": [],
  "gapsFixed": [],
  "gapsNew": []
}
```

<!-- verify stdout 2
build/plan-verify
diff
--json
test/fixtures/malformed.ears.md
examples/order-v1.ears.md
-->
```text
{
  "ok": false,
  "error": "test/fixtures/malformed.ears.md:3: expected \"shall\""
}
```

`emit-smt` is `ok`, `spec`, and `smt`. `smt` is the same SMT-LIB text as the plain command, with a newline between lines and none after the last line.

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

## Unused schema

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

## Unreachable, redundant, and uncovered

A vacuous object carries `because`. A redundant object carries `impliedBy`. Uncovered names sit in `uncovered`. `ok` is false for an unreachable requirement. `ok` stays true when the only findings are redundant requirements or uncovered names.

<!-- verify stdout 1
build/plan-verify
lint
--json
examples/order-blocked.ears.md
-->
```text
{
  "ok": false,
  "spec": "examples/order-blocked.ears.md",
  "conflicts": [],
  "gaps": [],
  "misuse": [],
  "wording": [],
  "redundant": [],
  "duplicate": [],
  "vacuous": [
    {
      "id": "R3",
      "line": 9,
      "sentence": "When the gate is open or the shift is open, the Desk shall finish the job.",
      "text": "R3 can never trigger. Its condition is impossible for every allowed value.",
      "fix": "Suggested fix: rewrite the condition in R3 so a real situation can make it true, or remove the requirement. Do not invent a response.",
      "because": [
        "R1",
        "R2"
      ]
    }
  ],
  "unused": [],
  "uncovered": [],
  "warnings": []
}
```

<!-- verify stdout 0
build/plan-verify
lint
--json
examples/order-redundant.ears.md
-->
```text
{
  "ok": true,
  "spec": "examples/order-redundant.ears.md",
  "conflicts": [],
  "gaps": [],
  "misuse": [],
  "wording": [],
  "redundant": [
    {
      "id": "R2",
      "line": 8,
      "sentence": "When an order is submitted and inventory is available, the Order System shall fulfill the order.",
      "text": "R2 adds nothing. R1 implies it. Whenever the other requirements hold, R2 holds too.",
      "fix": "Suggested fix: remove R2, or ask whether it was meant to say something the others do not already require. Do not delete it until the PM agrees.",
      "impliedBy": [
        "R1"
      ]
    }
  ],
  "duplicate": [],
  "vacuous": [],
  "unused": [],
  "uncovered": [],
  "warnings": []
}
```

<!-- verify stdout 0
build/plan-verify
lint
--json
examples/order-uncovered.ears.md
-->
```text
{
  "ok": true,
  "spec": "examples/order-uncovered.ears.md",
  "conflicts": [],
  "gaps": [],
  "misuse": [],
  "wording": [],
  "redundant": [],
  "duplicate": [],
  "vacuous": [],
  "unused": [],
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

## Warnings

`examples/order-timely.ears.md` has one vague-word warning. `ok` stays true, and the exit status is 0.

<!-- verify stdout 0
build/plan-verify
lint
--json
examples/order-timely.ears.md
-->
```text
{
  "ok": true,
  "spec": "examples/order-timely.ears.md",
  "conflicts": [],
  "gaps": [],
  "misuse": [],
  "wording": [],
  "redundant": [],
  "duplicate": [],
  "vacuous": [],
  "unused": [],
  "uncovered": [],
  "warnings": [
    {
      "id": "R1",
      "line": 6,
      "sentence": "When an order is submitted, the Order System shall timely fulfill the order.",
      "kind": "vague",
      "word": "timely",
      "text": "\"timely\" is too vague to test. Replace it with a value a scenario can check.",
      "fix": "Suggested fix: replace \"timely\" with a declared bound."
    }
  ]
}
```

## Scenarios

`--json` is `ok`, `spec`, and `scenarios`. Each row is `id`, `line`, `kind` (`accepted` or `rejected`), `trigger` (`true` or `false`), `found`, `sameAs`, `scenario` (`name` and `value`), and `text`. `scenario` is empty when `found` is false. `sameAs` names an earlier row when the assignment was already listed.

`scenarios --out <dir> --json` writes those scenario files and prints a different object: `ok`, `spec`, `out`, `scenarios`, and `uncovered`. Each scenario row is `file`, `id`, `line`, `kind`, `condition`, `conditionText`, and `text`. `ok` is true when `uncovered` is empty. That manifest is in [scenarios.md](scenarios.md).

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

## Repair

`repair --json` is `ok`, `spec`, `wrote`, and `proposals`. `ok` is true when `proposals` is empty. `wrote` is the path `--apply` wrote, or `""` when nothing was written. Each proposal is `id`, `kind`, `before`, `after`, `cleared`, and `because`. `kind` is `conflict`, `vacuous`, or `gap`. `before` is `""` when the proposal adds a requirement. `after` is `""` when the proposal drops one. `cleared` names the finding ids the edit removes. `because` names what made a vacuous requirement unreachable, and is empty for the other kinds.

<!-- verify stdout 1
build/plan-verify
repair
--json
examples/order-conflict.ears.md
-->
```text
{
  "ok": false,
  "spec": "examples/order-conflict.ears.md",
  "wrote": "",
  "proposals": [
    {
      "id": "R2, R3",
      "kind": "conflict",
      "before": "When an order is submitted, the Order System shall not fulfill the order.",
      "after": "",
      "cleared": [
        "R2",
        "R3"
      ],
      "because": []
    }
  ]
}
```

A spec with nothing to change exits 0.

<!-- verify stdout 0
build/plan-verify
repair
--json
examples/order-covered.ears.md
-->
```text
{
  "ok": true,
  "spec": "examples/order-covered.ears.md",
  "wrote": "",
  "proposals": []
}
```
