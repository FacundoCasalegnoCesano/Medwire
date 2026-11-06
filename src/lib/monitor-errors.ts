export class MonitorNotFoundError extends Error {}
export class MonitorConflictError extends Error {}
export class MonitorCapacityError extends Error {
  constructor(readonly limit: number) { super("The workspace has reached its active monitor limit."); }
}
