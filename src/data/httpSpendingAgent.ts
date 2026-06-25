import type {
  SpendingAgent,
  SpendingAnalysis,
  SpendingAnalysisRequest,
} from '../domain/spending'
import { deduplicateSpendingProposals } from '../domain/spending'

interface HttpSpendingAgentOptions {
  baseUrl?: string
}

export class HttpSpendingAgent implements SpendingAgent {
  private readonly baseUrl: string

  public constructor(options: HttpSpendingAgentOptions = {}) {
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

    const analysis = (await response.json()) as SpendingAnalysis
    const deduplicated = deduplicateSpendingProposals(analysis.proposals)

    return {
      ...analysis,
      proposals: deduplicated.proposals,
      duplicateCount: analysis.duplicateCount + deduplicated.duplicateCount,
    }
  }
}
