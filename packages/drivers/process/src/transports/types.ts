import type { JsonlItem } from "@arnilo/prism/driver-kit";
import type { Decoded, OutboundFrame } from "../adapter.js";
export type TransportItem =
  | JsonlItem
  | { readonly kind: "decoded"; readonly value: Decoded; readonly raw: import("@arnilo/prism").JsonValue };
export interface Transport {
  open?(frame: OutboundFrame): Promise<readonly TransportItem[] | undefined>;
  send(frame: OutboundFrame): Promise<void>;
  readonly frames: AsyncIterable<TransportItem>;
  close(): Promise<void>;
}
