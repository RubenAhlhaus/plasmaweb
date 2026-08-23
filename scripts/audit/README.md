# Machine audit

Two scripts that drive a **running** machine and report PASS/FAIL per check. They are not unit
tests: they need LinuxCNC up, the backend serving on `127.0.0.1:8765`, and they move the table.

```bash
# on the machine (or the sim VM), with the backend running
venv/bin/python scripts/audit/milestones.py    # every milestone's happy path, including a cut
venv/bin/python scripts/audit/adversarial.py   # bad input, file round-trips, edge cases
```

`milestones.py` powers the machine on, homes it, runs a real program and fires the torch. Run it
on a sim or a table with the torch isolated — not on a loaded machine.

Both leave the machine as they found it: the parameters they change are restored, the material
they add is deleted, and they abort whatever is running on the way out.

## What they are for

The unit tests prove the code does what it says against fakes. These prove the machine does what
the code says — the gap where every real bug in this project has been found: a pin that exists
in one LinuxCNC and not another, a value that reads back fine and reaches nothing, an interlock
that only exists in the realtime component.
