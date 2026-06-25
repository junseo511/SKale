import type {
  SpendingAgent,
  SpendingAnalysis,
  SpendingAnalysisRequest,
} from '../domain/spending'

interface OpenAiSpendingAgentOptions {
  baseUrl?: string
}

export class OpenAiSpendingAgent implements SpendingAgent {
  private readonly baseUrl: string

  public constructor(options: OpenAiSpendingAgentOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? ''
  }

  public async analyze(
    request: SpendingAnalysisRequest,
    signal: AbortSignal,
  ): Promise<SpendingAnalysis> {
    const response = await fetch(`${this.baseUrl}/api/spending/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })

    if (!response.ok) {
      const errorResponse = (await response.json().catch(() => null)) as {
        message?: string
      } | null
      throw new Error(
        errorResponse?.message ?? `AI 분석 요청 실패: ${response.status}`,
      )
    }

    return (await response.json()) as SpendingAnalysis
  }
}
