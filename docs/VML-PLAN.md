# VML Support Plan

_Draft plan for vscode-vlang. Date: 2026-10-08._
_Stays on the current branch. No code changes ship with this plan._

## What VML is

VML (V Markup Language) is a declarative UI description language
for V. A `.vml` file describes a tree of widgets with properties,
data bindings, and event handlers. At compile time the `$vml`
comptime call splices the file into the surrounding V program as
a widget-builder expression. File extension: `.vml`. Markup host:
`$vml('file.vml')` inside `.v` sources.

## The dollar-vml mechanism

Exact mechanism, read from `vlib/v/parser/vml.v` (1638 lines).

- Entry point: `Parser.parse_vml_template_expr` at line 622. Its
  own comment says the call compiles `$vml('file.vml')` into a
  direct `ui2.Element` builder.
- Steps: require `(` after `$vml`; take a compile-time string
  argument; resolve it with `resolve_veb_template_path`; read the
  file; parse with `parse_vml_source`; compile with `VmlCompiler`
  (flagged `uses_app` when the tree references `app`); splice the
  generated source via `parse_veb_template_replacement_expr`.
- Failure modes are compile errors: non-literal path, missing or
  unreadable file, markup parse error, lowering failure.
- Emitted shape (`VmlCompiler.compile`, lines 726-739): an
  immediately invoked closure returning the root element, with an
  optional `[app]` capture when bindings need it.

## Document shape

Derived from the node parser (lines 286-330) and the compiler's
tag lists (lines 1076-1078, 1094-1102).

- A document holds nested `Tag { ... }` blocks. A block holds
  `name: expression` properties, `property Type name: expression`
  declared properties, and child blocks.
- Containers: `Screen`, `View`, `Rectangle`, `Column`, `Row`,
  `Scroll`. Any other tag is also treated as a container.
- Leaf widgets: `Label`, `Image`, `Button`, `MessageBox`,
  `Checkbox`, `Dropdown`, `TextArea`, `TextField`,
  `ProgressBar`, `Slider`, `Switch`, `Spinner`.
- Data-only nodes: `MenuItem` (menu entries) and `Option`
  (dropdown choices) are consumed as data, not child widgets.
- `Repeater` requires a `model` plus a stable `key` property.
- `id` must be a literal identifier and enables cross-references.
- Geometry uses `x`, `y`, `width`, `height`; stacks also read
  `padding`. Colors accept `#rrggbb` or value expressions.
- Strings support `${...}` interpolation. `//` starts a comment.
- Two-way bindings look like `bind.text: app.field`, restricted
  to `text`, `checked`, `active`, and `value`, targeting a
  mutable top-level `app` field, at most one per element.
- Events look like `on_tap: app.action`, limited to `on_tap`,
  `on_change`, `on_active`, `on_text`, and `on_submit`. Each must
  call an `app` action with at most one argument.

## Toolchain gaps found

- `vlib/ui2` does not exist in this toolchain. The generated code
  names `ui2.Element`, `ui2.rect`, `ui2.bounds`,
  `ui2.parse_hex_color`, `ui2.BoxStyle`, `ui2.TextStyle`, and the
  `ui2.compiled_vml_event` helpers, none of which resolve here.
  No program using `$vml` can compile, and no renderer exists
  that a preview could reuse.
- No `.vml` example ships with the toolchain. A recursive search
  finds zero `.vml` files, so there is no canonical sample. Any
  grammar must be derived from `vml.v` itself, as done above.
- The only test touching VML codegen covers a string helper
  (`vml_array_literal` in `array_init_positional_test.v`), not
  markup parsing or widget output.

## Phase 0: file recognition

- Register `.vml` in `contributes.languages` with a TextMate
  grammar: tags, properties, strings with interpolation,
  numbers, booleans, comments, `bind.*`, and `on_*` names.
- Phase 0 acceptance: a fixture exercising every tag and feature
  from the Document shape section highlights cleanly, and `.vml`
  files open as VML with bracket matching.

## Phase 1: language features

- Snippets for each widget tag and for `bind.*` / `on_*` pairs.
- Diagnostics for standalone `.vml` files are limited by design:
  the compiler only reports VML errors when a `.v` file calls
  `$vml`, so the extension cannot get errors from a bare `.vml`
  file without building a host program around it.
- Recommended start: surface the compiler's `$vml` errors from
  the host build against the `.vml` file, plus snippets and
  folding. A formatter is a later spike: `v fmt` coverage of
  `.vml` is unverified, so do not promise one.
- Phase 1 acceptance: snippets expand for all tags; a broken
  `.vml` file referenced by `$vml` shows the compiler message on
  the `.vml` file; nothing is promised for unreferenced files.

## WYSIWYG feasibility verdict

Verdict: not feasible now. Defer pixel preview until the
renderer it depends on exists.

- A faithful preview must run the compiler's own lowering and
  then rasterize real `ui2` widgets. With no `ui2` present, step
  one of that pipeline is missing, so any pixel output today
  would render a guess, not the user's UI.
- What a real preview would need, in order: upstream `ui2`
  matching what `VmlCompiler` emits; a headless renderer that
  rasterizes a `ui2` tree offscreen; or a screenshot pipeline
  that builds a small host app embedding the `$vml` builder,
  runs it, and captures pixels. All three need a display story,
  rebuild-on-keystroke throttling, and sandboxing of arbitrary
  `app` code. None exists today.
- A lossy HTML approximation in TypeScript is possible but would
  diverge from `ui2` on layout, fonts, and widgets. Do not ship
  it labeled as a preview; divergence bugs would read as ours.

## Fallback milestones instead of pixels

- Milestone A: syntax highlighting (Phase 0 above). Cheap and
  fully within extension control.
- Milestone B: outline view. Parse the block tree in TypeScript
  and show tags, ids, and bindings in a tree view with go-to.
  No pixels, no divergence claims, genuinely useful.
- Milestone C: revisit true preview only after `ui2` lands
  upstream and a headless render path is demonstrated. Gate the
  work on those two facts, not on a calendar date.

## Explicitly out of scope

- Any pixel preview before `ui2` exists in the toolchain.
- A TypeScript re-implementation of the `ui2` widget set.
- `.vml` formatting until `v fmt` behavior is verified.
- Two-way editing between preview and markup.
