# opencode-hud

Personal TUI HUD for [OpenCode](https://opencode.ai) V2: shows the state of the
[opencode-context-pruner](https://github.com/hoshinodis/opencode-context-pruner) and
[opencode-intent-gate](https://github.com/hoshinodis/opencode-intent-gate) plugins in the sidebar.

## What it shows

```
Pruner
• per-request · -123/-0 (51m)

Gate
• pass work 0.23 (2m)
• today gate 12 · pass 36 · skip 26

Cache
• 89% hit · read 303M / in 35.6M
• out 340k · reason 733k
```

- **Pruner / Gate** read the plugins' `decisions.jsonl` (session-scoped)
- **Cache** computes the prompt-cache hit rate from `session_v2` usage (`bun:sqlite`, read-only)
- An error line is shown only while it is the newest event in its log

## Install

```sh
opencode plugin add github:hoshinodis/opencode-hud
```

Requires OpenCode V2 (2.0.x). Registers with `ui.slot({ append: "sidebar.content" })`.

## Notes

- The V2 TUI plugin module shape is `export default { id, setup(api) }` (the dev-branch spec's `{ id, tui }` is rejected at load)
- JSX requires the `/** @jsxImportSource @opentui/solid */` pragma
- Peer deps: `solid-js@1.9.12`, `@opentui/solid@0.5.12`

## License

MIT
