import type {
  StockAgent,
  StockAnalysis,
  StockAnalysisRequest,
} from '../domain/stock'
import { calculateStockScore } from '../domain/stock'

interface HttpStockAgentOptions {
  baseUrl?: string
}

export class HttpStockAgent implements StockAgent {
  private readonly baseUrl: string

  public constructor(options: HttpStockAgentOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? ''
  }

  public async analyze(
    request: StockAnalysisRequest,
    signal: AbortSignal,
  ): Promise<StockAnalysis> {
    const response = await fetch(`${this.baseUrl}/api/stocks/analyze`, {
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
        errorResponse?.message ?? `AI 종목 분석 요청 실패: ${response.status}`,
      )
    }

    const analysis = (await response.json()) as StockAnalysis
    return {
      ...analysis,
      totalScore: calculateStockScore(analysis.scoreBreakdown),
    }
  }
}
