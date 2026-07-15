export class WorkflowDefinitionError extends Error {
  readonly code = "ERR_PRISM_WORKFLOW_DEFINITION";
  constructor(message: string) {
    super(message);
    this.name = "WorkflowDefinitionError";
  }
}

export class WorkflowRuntimeError extends Error {
  readonly code: string | number;
  constructor(message: string, code: string | number = "ERR_PRISM_WORKFLOW_RUNTIME") {
    super(message);
    this.name = "WorkflowRuntimeError";
    this.code = code;
  }
}

export class WorkflowCheckpointError extends Error {
  readonly code = "ERR_PRISM_WORKFLOW_CHECKPOINT";
  constructor(message: string) {
    super(message);
    this.name = "WorkflowCheckpointError";
  }
}

export class WorkflowAbortError extends Error {
  readonly code = "ERR_PRISM_WORKFLOW_ABORTED";
  constructor(message = "Workflow aborted") {
    super(message);
    this.name = "WorkflowAbortError";
  }
}
