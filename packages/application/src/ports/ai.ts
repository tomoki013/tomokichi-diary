/**
 * Provider-neutral AI boundary. No use case names a vendor, and the public site
 * must keep working when no provider is configured at all (instruction §41).
 */
export interface AICompletionRequest {
  readonly instruction: string;
  readonly input: string;
  readonly maxOutputTokens?: number;
}

export interface AICompletionResult {
  readonly text: string;
  /** Opaque label recorded on the artifact, e.g. `internal-link-suggester@3`. */
  readonly generator: string;
}

export interface AIProvider {
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
}

export const NO_AI_PROVIDER: AIProvider | null = null;
