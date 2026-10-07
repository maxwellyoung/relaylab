import { Client, type CallOptions, type ClientOptions, type ClientUnaryCall, type ChannelCredentials, type ServiceDefinition, type ServiceError } from "@grpc/grpc-js";

export type ExecuteRunRequest = {
  operationId: string; correlationId: string; experimentRef: string;
  behavior: string; payloadJson: string;
};
export type GetExecutionRequest = { operationId: string };
export type Execution = {
  executionId: string; operationId: string; experimentRef: string;
  state: "RUNNING" | "COMPLETED" | "INTERRUPTED";
  outcome: string; resultJson: string; startedAt: string; completedAt: string;
};
export class RunnerClient extends Client {
  constructor(target: string, credentials: ChannelCredentials, options?: ClientOptions);
  executeRun(request: ExecuteRunRequest, options: CallOptions, callback: (error: ServiceError | null, response?: Execution) => void): ClientUnaryCall;
  getExecution(request: GetExecutionRequest, options: CallOptions, callback: (error: ServiceError | null, response?: Execution) => void): ClientUnaryCall;
}
export const runnerDefinition: ServiceDefinition;
