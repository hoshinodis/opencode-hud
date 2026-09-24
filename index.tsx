/** @jsxImportSource @opentui/solid */
import { appendFileSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMemo, createSignal, onCleanup } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

const PRUNER_LOG = join(homedir(), ".config/opencode/context-pruner/decisions.jsonl")
const GATE_LOG = join(homedir(), ".config/opencode/intent-gate/decisions.jsonl")
const DEBUG_LOG = join(homedir(), ".config/opencode/hud-debug.log")
const DB_PATH = join(homedir(), ".local/share/opencode/opencode.db")
const TAIL_BYTES = 128 * 1024
const POLL_MS = 2000

type Entry = Record<string, unknown>
type Usage = { cost?: number; input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }

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

const fmt = (value?: number): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`
  return String(Math.round(value))
}

const load = (sessionID: string | undefined, usage: (id: string) => Usage | undefined) => {
  const pruner = tail(PRUNER_LOG)
  const mine = sessionID ? pruner.filter((row) => str(row.sessionID) === sessionID) : pruner
  return {
    setup: last(pruner, (row) => row.event === "setup"),
    apply: last(mine, (row) => row.event === "apply"),
    skip: last(mine, (row) => row.event === "skip"),
    decision: last(tail(GATE_LOG), (row) => ["pass", "gate", "skip", "skipped"].includes(str(row.event))),
    usage: sessionID ? usage(sessionID) : undefined,
  }
}

function View(props: { api: TuiPluginApi; sessionID?: string; usage: (id: string) => Usage | undefined }) {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((value) => value + 1), POLL_MS)
  onCleanup(() => clearInterval(timer))
  const snap = createMemo(() => {
    tick()
    return load(props.sessionID, props.usage)
  })
  const token = (group: string, sub: string): unknown => {
    const value = (props.api.theme as unknown as Record<string, unknown>)?.[group]
    if (!value || typeof value !== "object") return value
    const record = value as Record<string, unknown>
    return record[sub] ?? record.base
  }
  const muted = () => token("text", "muted")
  const ink = () => token("text", "base") ?? token("text", "default")
  const bullet = (value: string) => (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={muted() as never}>
        •
      </text>
      <text fg={ink() as never} wrapMode="word">
        {value}
      </text>
    </box>
  )
  const heading = (label: string) => (
    <text fg={ink() as never}>
      <b>{label}</b>
    </text>
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
  const gateRate = () => {
    const today = new Date().toDateString()
    const counts = { gate: 0, pass: 0, skip: 0 }
    for (const row of tail(GATE_LOG)) {
      const at = new Date(str(row.ts))
      if (Number.isNaN(at.getTime()) || at.toDateString() !== today) continue
      const event = str(row.event)
      if (event === "gate") counts.gate += 1
      else if (event === "pass") counts.pass += 1
      else if (event === "skip" || event === "skipped") counts.skip += 1
    }
    return `today gate ${counts.gate} · pass ${counts.pass} · skip ${counts.skip}`
  }
  const cache = () => {
    const usage = snap().usage
    if (!usage) return "no data"
    const input = usage.input ?? 0
    const read = usage.cacheRead ?? 0
    if (input + read === 0) return "no data"
    const pct = Math.round((read / (input + read)) * 100)
    return `${pct}% hit · read ${fmt(read)} / in ${fmt(input)}`
  }
  const tokens = () => {
    const usage = snap().usage
    if (!usage) return "no data"
    return `out ${fmt(usage.output)} · reason ${fmt(usage.reasoning)}`
  }
  return (
    <box flexDirection="column">
      {heading("Pruner")}
      {bullet(pruner())}
      <box height={1} flexShrink={0} />
      {heading("Gate")}
      {bullet(gate())}
      {bullet(gateRate())}
      <box height={1} flexShrink={0} />
      {heading("Cache")}
      {bullet(cache())}
      {bullet(tokens())}
    </box>
  )
}

const plugin = {
  id: "hud",
  setup: async (api: TuiPluginApi) => {
    const anyApi = api as unknown as { ui: { slot: (input: unknown) => unknown } }
    let query: (id: string) => Usage | undefined = () => undefined
    try {
      const { Database } = (await import("bun:sqlite")) as typeof import("bun:sqlite")
      const db = new Database(DB_PATH, { readonly: true })
      query = (id: string) => {
        try {
          return (db
            .query(
              "SELECT tokens_input AS input, tokens_output AS output, tokens_reasoning AS reasoning, tokens_cache_read AS cacheRead, tokens_cache_write AS cacheWrite, cost FROM session_v2 WHERE id = ?",
            )
            .get(id) ?? undefined) as Usage | undefined
        } catch {
          return undefined
        }
      }
      debug("setup: bun:sqlite ok")
    } catch (error) {
      debug("setup: bun:sqlite unavailable: " + String(error))
    }
    anyApi.ui.slot({
      append: "sidebar.content",
      render: (props: { sessionID?: string }) => <View api={api} sessionID={props?.sessionID} usage={query} />,
    })
  },
}

export default plugin
