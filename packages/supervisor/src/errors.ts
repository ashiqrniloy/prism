export class SupervisorError extends Error {
  constructor(message: string, readonly code = "ERR_PRISM_SUPERVISOR") {
    super(message);
    this.name = "SupervisorError";
  }
}

export class SupervisorValidationError extends SupervisorError {
  constructor(message: string) { super(message, "ERR_PRISM_SUPERVISOR_VALIDATION"); this.name = "SupervisorValidationError"; }
}

export class SupervisorLimitError extends SupervisorError {
  constructor(message: string) { super(message, "ERR_PRISM_SUPERVISOR_LIMIT"); this.name = "SupervisorLimitError"; }
}

export class SupervisorDeniedError extends SupervisorError {
  constructor(message = "Delegation denied") { super(message, "ERR_PRISM_SUPERVISOR_DENIED"); this.name = "SupervisorDeniedError"; }
}

export class A2AError extends SupervisorError {
  constructor(message: string, readonly status = 400, code = "ERR_PRISM_A2A") { super(message, code); this.name = "A2AError"; }
}
