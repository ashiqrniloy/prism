// Explicit, externally supervised signal-cli composition.
import type { Agent } from "@arnilo/prism";
import { connectSignal, type ChannelConnectionHandle, type SignalConnectOptions } from "@arnilo/prism-hosts/channels/signal";

export async function startSignalChannel(agent: Agent, options: SignalConnectOptions): Promise<ChannelConnectionHandle> {
  const handle = await connectSignal(agent, options);
  await handle.start();
  return handle;
}
