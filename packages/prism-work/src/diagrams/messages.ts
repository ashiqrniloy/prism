export type DrawioExportFormat = "xml" | "xmlsvg" | "xmlpng" | "json" | "png" | "svg";

export interface DrawioExportBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Inbound Editor-to-Host Events
export interface DrawioInitEvent {
  readonly event: "init";
}

export interface DrawioLoadEvent {
  readonly event: "load";
}

export interface DrawioSaveEvent {
  readonly event: "save";
  readonly xml: string;
  readonly exit?: boolean;
}

export interface DrawioAutosaveEvent {
  readonly event: "autosave";
  readonly xml: string;
}

export interface DrawioExitEvent {
  readonly event: "exit";
  readonly modified: boolean;
}

export interface DrawioConfigureEvent {
  readonly event: "configure";
}

export interface DrawioExportEvent {
  readonly event: "export";
  readonly format: string;
  readonly data: string;
  readonly xml?: string;
  readonly bounds?: DrawioExportBounds;
}

export interface DrawioErrorEvent {
  readonly event: "error";
  readonly message: string;
}

export type DrawioInboundEvent =
  | DrawioInitEvent
  | DrawioLoadEvent
  | DrawioSaveEvent
  | DrawioAutosaveEvent
  | DrawioExitEvent
  | DrawioConfigureEvent
  | DrawioExportEvent
  | DrawioErrorEvent;

// Outbound Host-to-Editor Actions
export interface DrawioLoadAction {
  readonly action: "load";
  readonly xml: string;
  readonly autosave?: boolean | 0 | 1;
  readonly saveAndExit?: boolean | 0 | 1;
  readonly noSaveBtn?: boolean | 0 | 1;
  readonly noExitBtn?: boolean | 0 | 1;
  readonly title?: string;
}

export interface DrawioConfigureAction {
  readonly action: "configure";
  readonly config: Readonly<Record<string, unknown>>;
}

export interface DrawioExportAction {
  readonly action: "export";
  readonly format: DrawioExportFormat;
  readonly scale?: number;
  readonly border?: number;
  readonly xml?: string;
  readonly embedImages?: boolean;
}

export interface DrawioMergeAction {
  readonly action: "merge";
  readonly xml: string;
}

export interface DrawioDialogAction {
  readonly action: "dialog";
  readonly title: string;
  readonly message: string;
  readonly button: string;
}

export interface DrawioPromptAction {
  readonly action: "prompt";
  readonly title: string;
  readonly defaultValue?: string;
  readonly ok: string;
}

export interface DrawioTemplateAction {
  readonly action: "template";
  readonly xml?: string;
  readonly name?: string;
}

export interface DrawioDraftAction {
  readonly action: "draft";
  readonly xml: string;
  readonly editKey?: string;
}

export interface DrawioStatusAction {
  readonly action: "status";
  readonly message: string;
  readonly modified?: boolean;
}

export interface DrawioSpinnerAction {
  readonly action: "spinner";
  readonly show: boolean;
  readonly message?: string;
}

export interface DrawioFitAction {
  readonly action: "fit";
}

export interface DrawioResetEditorAction {
  readonly action: "resetEditor";
}

export type DrawioOutboundAction =
  | DrawioLoadAction
  | DrawioConfigureAction
  | DrawioExportAction
  | DrawioMergeAction
  | DrawioDialogAction
  | DrawioPromptAction
  | DrawioTemplateAction
  | DrawioDraftAction
  | DrawioStatusAction
  | DrawioSpinnerAction
  | DrawioFitAction
  | DrawioResetEditorAction;
