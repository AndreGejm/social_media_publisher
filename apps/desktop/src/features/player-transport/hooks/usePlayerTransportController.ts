import { usePlayerTransportRuntimeState } from "./usePlayerTransportRuntimeState";

export type UsePlayerTransportControllerArgs = Parameters<typeof usePlayerTransportRuntimeState>[0];
export type PlayerTransportController = ReturnType<typeof usePlayerTransportRuntimeState>;

export function usePlayerTransportController(
  args: UsePlayerTransportControllerArgs
): PlayerTransportController {
  return usePlayerTransportRuntimeState(args);
}