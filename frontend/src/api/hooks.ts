import { useQuery } from "@tanstack/react-query";
import { getApi } from "./client";

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
