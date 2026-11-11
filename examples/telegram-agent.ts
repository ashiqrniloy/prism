// Explicit host composition for Phase 10 Channels. Calling this function (not importing it)
// verifies the Bot API token, acquires the receiver lease and begins long polling.
// Private DMs are always admitted; set `options.allowGroups` to also parse group/topic text
// (the host `authorize` still decides per chat, topic and sender).
import type { Agent } from "@arnilo/prism";
import {
  connectTelegram,
  type ChannelConnectionHandle,
  type TelegramConnectOptions,
  createTelegramWebhookHandler,
  type TelegramWebhookHandler,
  type TelegramWebhookHandlerOptions,
} from "@arnilo/prism-hosts/channels/telegram";

export async function startTelegramChannel(agent: Agent, options: TelegramConnectOptions): Promise<ChannelConnectionHandle> {
  const handle = await connectTelegram(agent, options);
  await handle.start();
  return handle;
}

/** Host-mounted webhook ingress. Prism does not create a listener or call setWebhook. */
export function mountTelegramWebhook(options: {
  readonly webhook: Omit<TelegramWebhookHandlerOptions, "admit">;
  readonly handle: ChannelConnectionHandle;
}): TelegramWebhookHandler {
  return createTelegramWebhookHandler({
    ...options.webhook,
    admit: (event) => options.handle.handle(event) as any,
  });
}
