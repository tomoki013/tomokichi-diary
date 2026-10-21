export const publicationStages = ["data", "images", "site", "checks", "deploy", "verify"] as const;
export type PublicationStage = (typeof publicationStages)[number];
export interface PublicationStageResult {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  state: "running" | "completed" | "skipped" | "failed";
}
export interface SitePublicationStatus {
  state: "deployed" | "queued" | "building" | "failed" | "unconfigured";
  configured: boolean;
  requestId: string | null;
  buildId: string | null;
  stage: PublicationStage | null;
  requestedAt: string | null;
  startedAt: string | null;
  stageStartedAt: string | null;
  deployedAt: string | null;
  durationMs: number | null;
  elapsedMs: number | null;
  errorCode: string | null;
  buildUrl: string | null;
  error: string | null;
  stages: Partial<Record<PublicationStage, PublicationStageResult>>;
}
