import type { LoopStrategy, RunController } from "./types.js";

/**
 * The kernel default loop (roadmap §2.5): provider turns until the model stops calling tools, then
 * a natural `run.end`. A `turn.before` stop or a tool-round ceiling ends the run without `run.end`.
 */
export const defaultLoop: LoopStrategy = {
  name: "default",
  revision: "1",
  async run(run: RunController): Promise<void> {
    for (;;) {
      for (;;) {
        const turn = await run.turn();
        if (turn.stopped) return;
        if (turn.toolCalls.length > 0) {
          await run.executeTools(turn.toolCalls);
          continue;
        }
        // Soft interrupt / late steer: keep the same run going while the queue has text.
        if (turn.steered) continue;
        break;
      }
      const end = await run.end();
      if (!end.continue) return;
    }
  },
};
