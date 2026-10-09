import { useQuery } from "@tanstack/react-query";
import { getApi } from "./client";

export const useHealth = () =>
  useQuery({
    queryKey: ["health"],
    queryFn: async () => (await getApi()).health(),
    retry: false,
    // poll quickly while the backend is down so the banner clears as soon as it is back
    refetchInterval: (query) => (query.state.status === "error" ? 3000 : 8000),
  });

export const useGraph = () =>
  useQuery({ queryKey: ["graph"], queryFn: async () => (await getApi()).graph(), staleTime: Infinity });

export const useModels = () =>
  useQuery({ queryKey: ["models"], queryFn: async () => (await getApi()).models(), staleTime: 60_000 });

export const useRuns = () =>
  useQuery({ queryKey: ["runs"], queryFn: async () => (await getApi()).listRuns() });

export const useRunDetail = (runId: string | undefined) =>
  useQuery({
    queryKey: ["run", runId],
    queryFn: async () => (await getApi()).getRun(runId!),
    enabled: !!runId,
    retry: false,
  });

export const useReportOf = (runId: string | null | undefined) =>
  useQuery({
    queryKey: ["report", runId],
    queryFn: async () => (await getApi()).getReport(runId!),
    enabled: !!runId,
    retry: false,
    staleTime: 60_000,
  });

export const useEvidenceDetail = (evidenceId: string, enabled = true) =>
  useQuery({
    queryKey: ["evidence", evidenceId],
    queryFn: async () => (await getApi()).getEvidence(evidenceId),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

export const useDeckScript = (runId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ["deck", runId],
    queryFn: async () => (await getApi()).postDeck(runId!),
    enabled: enabled && !!runId,
    staleTime: Infinity,
    retry: false,
  });

export const useNode = (runId: string, nodeId: string | undefined, version: string) =>
  useQuery({
    queryKey: ["node", runId, nodeId, version],
    queryFn: async () => (await getApi()).getNode(runId, nodeId!),
    enabled: !!nodeId,
    retry: false,
  });

export const useDiff = (parentId: string | null | undefined, runId: string, ready: boolean) =>
  useQuery({
    queryKey: ["diff", parentId, runId],
    queryFn: async () => (await getApi()).getDiff(parentId!, runId),
    enabled: !!parentId && ready,
    retry: false,
  });

export const useMessages = (runId: string, enabled = true) =>
  useQuery({
    queryKey: ["messages", runId],
    queryFn: async () => (await getApi()).getMessages(runId),
    enabled,
    retry: false,
  });

/** The read-out of a finished run. The backend writes it on the first ask and returns it as stored after that. */
export const useSummary = (runId: string, enabled: boolean) =>
  useQuery({
    queryKey: ["summary", runId],
    queryFn: async () => (await getApi()).postSummary(runId),
    enabled,
    retry: false,
    staleTime: Infinity,
  });
