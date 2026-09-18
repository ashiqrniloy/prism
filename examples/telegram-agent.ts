// Explicit host composition for plan 079 Task 5. Calling this function (not importing it)
// verifies the Bot API token, acquires the receiver lease and begins long polling.
// Private DMs are always admitted; set `telegram.allowGroups` to also parse group/topic text
// (the host `authorize` still decides per chat, topic and sender — see plan 080 Task 4).
import { createMessagingRuntime, type MessagingRuntime, type MessagingRuntimeOptions } from "@arnilo/prism-channels";
import {
  createTelegramAdapter,
  createTelegramWebhookHandler,
  type TelegramAdapterOptions,
  type TelegramWebhookHandler,
  type TelegramWebhookHandlerOptions,
} from "@arnilo/prism-channels/telegram";

export async function startTelegramChannel(options: {
  readonly telegram: TelegramAdapterOptions;
  readonly runtime: Omit<MessagingRuntimeOptions, "deliver" | "onAssistantDelta" | "fetchAttachment"> & {
    /** Optional override: by default the adapter's opt-in `sendDrafts` handles previews. */
    readonly onAssistantDelta?: MessagingRuntimeOptions["onAssistantDelta"];
    /** Optional override: by default the adapter's bounded `fetchAttachment` supplies image bytes. */
    readonly fetchAttachment?: MessagingRuntimeOptions["fetchAttachment"];
  };
}) {
  const adapter = createTelegramAdapter(options.telegram);
  const runtime = createMessagingRuntime({
    ...options.runtime,
    deliver: (reply) => adapter.send(reply),
    // Drafts stay opt-in through `telegram.sendDrafts`: `sendDraft` is a no-op unless it is set.
    onAssistantDelta: options.runtime.onAssistantDelta ?? ((delta) => adapter.sendDraft(delta)),
    // Images reach a model that declares image input; voice/documents were resolved before admit.
    fetchAttachment: options.runtime.fetchAttachment ?? ((ref) => adapter.fetchAttachment(ref)),
  });
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

/** Host-mounted webhook ingress. Prism does not create a listener or call setWebhook. */
export function mountTelegramWebhook(options: {
  readonly webhook: Omit<TelegramWebhookHandlerOptions, "admit">;
  readonly runtime: MessagingRuntime;
}): TelegramWebhookHandler {
  return createTelegramWebhookHandler({ ...options.webhook, admit: (event) => options.runtime.admit(event) });
}
