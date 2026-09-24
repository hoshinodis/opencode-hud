/** @jsxImportSource @opentui/solid */
import { appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const debug = (message: string) => {
  try {
    appendFileSync(join(homedir(), ".config/opencode/hud-debug.log"), `${new Date().toISOString()} ${message}\n`)
  } catch {}
}

const tui: TuiPlugin = async () => {
  debug("min-test tui() called")
}

const plugin: TuiPluginModule & { id: string } = { id: "hud-min", tui }

export default plugin
