import type { HostUi, HostUiRequestKind, OwnershipScope } from "@arnilo/prism";
import { policyDefault, routeHostUi, type ResumeAuthority, type RoutedHostUi } from "@arnilo/prism-headless";
import type { CheckpointStore } from "@arnilo/prism-workflows";

/**
 * The attached client answers every human request the kernel can raise. `secret` is not here:
 * the credentials slot owns it, so no route ever sees a secret value.
 */
export const CLIENT_KINDS: readonly HostUiRequestKind[] = ["confirm", "select", "input", "notify", "terminal"];

/** The channel route answers approvals only. `secret` and `terminal` never reach it (roadmap §2.13.4). */
export const CHANNEL_KINDS: readonly HostUiRequestKind[] = ["confirm", "select", "input"];

export interface HostUiOptions {
  /** The attached client: `createScriptedHostUi` in scenarios, the ACP host in `acp` mode. */
  readonly client: HostUi;
  /** A paired channel (`channelHostUi(...)`). Absent: an approval never leaves the machine. */
  readonly channel?: HostUi;
  /** Per-route timeout for the channel. A resume offer ignores it; the host's signal bounds that wait. */
  readonly channelTimeoutMs?: number;
  /** Durable answer log. Records route/kind/status only, never a value. */
  readonly answerLog?: CheckpointStore;
  readonly ownership?: OwnershipScope;
  /** Required to `resumeWhenAnswered`. */
  readonly resumeAuthority?: ResumeAuthority;
  readonly maxAnswers?: number;
}

/** The host's UI: client, then channel, then the fail-closed policy default. No routing logic lives here. */
export function buildHostUi(options: HostUiOptions): RoutedHostUi {
  return routeHostUi(
    [
      { name: "client", ui: options.client, kinds: [...CLIENT_KINDS] },
      ...(options.channel === undefined
        ? []
        : [
            {
              name: "channel",
              ui: options.channel,
              kinds: [...CHANNEL_KINDS],
              ...(options.channelTimeoutMs === undefined ? {} : { timeoutMs: options.channelTimeoutMs }),
            },
          ]),
      policyDefault(),
    ],
    {
      ...(options.answerLog === undefined ? {} : { answerLog: options.answerLog }),
      ...(options.ownership === undefined ? {} : { ownership: options.ownership }),
      ...(options.resumeAuthority === undefined ? {} : { resumeAuthority: options.resumeAuthority }),
      ...(options.maxAnswers === undefined ? {} : { limits: { maxAnswers: options.maxAnswers } }),
    },
  );
}
