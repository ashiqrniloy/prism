import {
  assertHostCompositionReadiness,
  HostCompositionError,
  inspectHostComposition,
  type HostCompositionGovernance,
  type HostCompositionOptions,
  type HostCompositionProfile,
  type HostCompositionReport,
  type HostCompositionToolReport,
} from "@arnilo/prism";
import type { CreatePrismDevInspectorOptions } from "./index.js";

export {
  assertHostCompositionReadiness,
  HostCompositionError,
  inspectHostComposition,
  type HostCompositionGovernance,
  type HostCompositionOptions,
  type HostCompositionProfile,
  type HostCompositionReport,
  type HostCompositionToolReport,
};

/**
 * Inspects a dev inspector host composition in an inert, bounded, and secret-redacting manner.
 */
export function inspectDevInspector(options: CreatePrismDevInspectorOptions): HostCompositionReport {
  return inspectHostComposition({
    agent: options.agent,
    checkpoints: options.checkpoints,
    redactor: options.redactor,
  });
}
