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

export class WorkflowLoopLimitError extends WorkflowRuntimeError {
  readonly nodeId: string;
  readonly iterations: number;
  readonly lastOutput: unknown;

  constructor(nodeId: string, iterations: number, lastOutput: unknown) {
    super(`Loop node "${nodeId}" exceeded maxIterations (${iterations})`, "ERR_PRISM_WORKFLOW_LOOP_LIMIT");
    this.name = "WorkflowLoopLimitError";
    this.nodeId = nodeId;
    this.iterations = iterations;
    this.lastOutput = lastOutput;
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
