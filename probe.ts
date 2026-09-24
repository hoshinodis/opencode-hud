import { appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async () => {
  try {
    appendFileSync(join(homedir(), ".config/opencode/hud-debug.log"), `${new Date().toISOString()} probe loaded\n`)
  } catch {}
}

const plugin: TuiPluginModule & { id: string } = { id: "hud-probe", tui }

export default plugin
