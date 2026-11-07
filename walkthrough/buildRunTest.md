# Build, run, and test

Open a folder containing a `v.mod` file, or a single `.v` file.

**V: Build**, **V: Run** and **V: Test** operate on the whole workspace. When a V
file is open, Run runs that module or script, and Test runs that `_test.v` file.
Modified V files are saved before anything runs.

VLS CodeLens actions — **Run Main**, **Run File**, **Run Test** — use the same
tasks, so the buttons above a `fn main()` and above a `test_` function do exactly
what the palette commands do.

Test runs collect coverage by default. Covered executable lines are highlighted
green and uncovered lines red. Click the coverage status item, or run
**V: Clear Test Coverage**, to remove the highlights.
