import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { harness } from "./fixtures/harness.js";

for (const throwing of [false, true])
  test(`signal_process_stops_once_${throwing}`, async () => {
    let starts = 0;
    const h = await harness({
      source: `import {appendFileSync} from 'node:fs'; import {createInterface} from 'node:readline';
appendFileSync(process.argv[2], 'spawn\\n'); process.on('SIGTERM',()=>{appendFileSync(process.argv[2], 'term\\n');process.exit(0)});
createInterface({input:process.stdin}).once('line',()=>console.log(JSON.stringify({kind:'notice',level:'error',code:'quota',message:'quota'})));`,
      adapter: (a) => ({
        ...a,
        configure: () => {
          starts++;
          return { args: [`${h.root}/signal-record`] };
        },
        notices: () => {
          if (throwing) throw Error("classifier failed");
          return { code: "quota", deferUntil: "2030-01-01T00:00:00Z" };
        },
      }),
    });
    try {
      const result = await h.session.run("go");
      expect(result.error?.message).toContain(throwing ? "classifier failed" : "vendor_limit: quota");
      expect(starts).toBe(1);
      expect(readFileSync(`${h.root}/signal-record`, "utf8").match(/spawn/g)).toHaveLength(1);
    } finally {
      await h.close();
    }
  });
