# Check, vet, and format

Three tasks run the gates that the rest of a change hangs on. Each works on the
open file when there is one, and on the workspace otherwise.

| Task                | Command         | What it tells you                                  |
| ------------------- | --------------- | -------------------------------------------------- |
| **V: Check**        | `v -check`      | Whether it type-checks, without producing a binary |
| **V: Vet**          | `v vet -W`      | Suspicious constructs, with warnings as errors     |
| **V: Format Check** | `v fmt -verify` | Whether the formatter would change anything        |

All three surface through the problem matcher, so a failure lands in the Problems
panel at the right line rather than only in the task output.

`v vet -W` is the one to use in CI, because `-W` makes warnings fatal. A green
test run does not imply a formatted file, and a formatted file does not imply it
compiles — these three are the cheap checks that catch the difference.
