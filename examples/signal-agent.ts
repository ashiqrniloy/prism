// Plan 079 Task 7: explicit, externally supervised signal-cli composition.
import { createMessagingRuntime, type MessagingRuntimeOptions } from "@arnilo/prism-channels";
import { createSignalAdapter, type SignalAdapterOptions } from "@arnilo/prism-channels/signal";

export async function startSignalChannel(options: {
  readonly signal: SignalAdapterOptions;
  readonly runtime: Omit<MessagingRuntimeOptions, "deliver">;
}) {
  const adapter = createSignalAdapter(options.signal);
  const runtime = createMessagingRuntime({ ...options.runtime, deliver: (reply) => adapter.send(reply) });
  await adapter.start((event) => runtime.admit(event));
  return {
    adapter,
    runtime,
    async stop() {
      await adapter.stop();
      await runtime.stop();
    },
  };
}
