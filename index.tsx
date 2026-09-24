/** @jsxImportSource @opentui/solid */
import { appendFileSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMemo, createSignal, onCleanup } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

const PRUNER_LOG = join(homedir(), ".config/opencode/context-pruner/decisions.jsonl")
const GATE_LOG = join(homedir(), ".config/opencode/intent-gate/decisions.jsonl")
const DEBUG_LOG = join(homedir(), ".config/opencode/hud-debug.log")
const TAIL_BYTES = 128 * 1024
const POLL_MS = 2000

type Entry = Record<string, unknown>

const debug = (message: string) => {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}\n`)
  } catch {}
}

const tail = (path: string): Entry[] => {
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - TAIL_BYTES)
    const lines = readFileSync(path).subarray(start).toString("utf8").split("\n").filter(Boolean)
    if (start > 0) lines.shift()
    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Entry]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

const last = (rows: Entry[], match: (row: Entry) => boolean): Entry | undefined => {
  for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) return rows[i]
  return undefined
}

const str = (value: unknown): string => (typeof value === "string" ? value : "")

const ago = (ts: unknown): string => {
  const at = Date.parse(str(ts))
  if (!Number.isFinite(at)) return "-"
  const min = Math.floor((Date.now() - at) / 60000)
  if (min < 1) return "now"
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

const load = (sessionID?: string) => {
  const pruner = tail(PRUNER_LOG)
  const mine = sessionID ? pruner.filter((row) => str(row.sessionID) === sessionID) : pruner
  return {
    setup: last(pruner, (row) => row.event === "setup"),
    apply: last(mine, (row) => row.event === "apply"),
    skip: last(mine, (row) => row.event === "skip"),
    decision: last(tail(GATE_LOG), (row) => ["pass", "gate", "skip", "skipped"].includes(str(row.event))),
  }
}

function View(props: { api: TuiPluginApi; sessionID?: string }) {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((value) => value + 1), POLL_MS)
  onCleanup(() => clearInterval(timer))
  const snap = createMemo(() => {
    tick()
    return load(props.sessionID)
  })
  const token = (group: string, sub: string): unknown => {
    const value = (props.api.theme as unknown as Record<string, unknown>)?.[group]
    if (!value || typeof value !== "object") return value
    const record = value as Record<string, unknown>
    return record[sub] ?? record.base
  }
  const muted = () => token("text", "muted")
  const ink = () => token("text", "base") ?? token("text", "default")
  const row = (name: string, value: string) => (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={muted() as never}>
        •
      </text>
      <text fg={ink() as never} wrapMode="word">
        {name} <span style={{ fg: muted() as never }}>{value}</span>
      </text>
    </box>
  )
  const pruner = () => {
    const setup = snap().setup
    const apply = snap().apply
    const skip = snap().skip
    const mode = str(setup?.mode) || "?"
    if (apply) {
      const changed = Number(apply.changedMessages ?? 0)
      const removed = Number(apply.removedMessages ?? 0)
      return `${mode} · -${changed}/-${removed} (${ago(apply.ts)})`
    }
    if (skip) return `${mode} · skip ${str(skip.reason)} (${ago(skip.ts)})`
    return `${mode} · no activity`
  }
  const gate = () => {
    const entry = snap().decision
    if (!entry) return "no decisions"
    const scores = entry.scores as Record<string, number> | undefined
    const work = scores ? `work ${scores.is_work_request?.toFixed(2)}` : ""
    return `${str(entry.event)} ${work} (${ago(entry.ts)})`
  }
  return (
    <box flexDirection="column">
      <text fg={ink() as never}>
        <b>HUD</b>
      </text>
      {row("pruner", pruner())}
      {row("gate", gate())}
    </box>
  )
}

const plugin = {
  id: "hud",
  setup: async (api: TuiPluginApi) => {
    const anyApi = api as unknown as { ui: { slot: (input: unknown) => unknown } }
    debug("setup: v2 (session-filtered, themed)")
    anyApi.ui.slot({
      append: "sidebar.content",
      render: (props: { sessionID?: string }) => <View api={api} sessionID={props?.sessionID} />,
    })
  },
}

export default plugin
