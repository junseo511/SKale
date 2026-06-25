import type {
  PortfolioAgent,
  PortfolioAnalysis,
  PortfolioAnalysisRequest,
} from '../domain/portfolio'

interface HttpPortfolioAgentOptions {
  baseUrl?: string
}

export class HttpPortfolioAgent implements PortfolioAgent {
  private readonly baseUrl: string

  public constructor(options: HttpPortfolioAgentOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? ''
  }

  public async analyze(
    request: PortfolioAnalysisRequest,
    signal: AbortSignal,
  ): Promise<PortfolioAnalysis> {
    const response = await fetch(`${this.baseUrl}/api/portfolio/analyze`, {
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
        errorResponse?.message ?? `AI 포트폴리오 요청 실패: ${response.status}`,
      )
    }

    const analysis = (await response.json()) as Omit<
      PortfolioAnalysis,
      'allocations'
    > & {
      allocations: Array<Omit<PortfolioAnalysis['allocations'][number], 'id'>>
    }

    return {
      ...analysis,
      allocations: analysis.allocations.map((allocation) => ({
        ...allocation,
        id: crypto.randomUUID(),
      })),
    }
  }
}
