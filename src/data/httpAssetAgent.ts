import type {
  AssetAgent,
  AssetAnalysis,
  AssetAnalysisRequest,
} from '../domain/assets'

interface HttpAssetAgentOptions {
  baseUrl?: string
}

export class HttpAssetAgent implements AssetAgent {
  private readonly baseUrl: string

  public constructor(options: HttpAssetAgentOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? ''
  }

  public async analyze(
    request: AssetAnalysisRequest,
    signal: AbortSignal,
  ): Promise<AssetAnalysis> {
    const response = await fetch(`${this.baseUrl}/api/assets/analyze`, {
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
        errorResponse?.message ?? `AI 자산 분석 요청 실패: ${response.status}`,
      )
    }

    const analysis = (await response.json()) as Omit<
      AssetAnalysis,
      'salaryAllocations'
    > & {
      salaryAllocations?: Array<
        Omit<AssetAnalysis['salaryAllocations'][number], 'id'>
      >
    }

    return {
      ...analysis,
      salaryAllocations: (analysis.salaryAllocations ?? []).map(
        (allocation) => ({
          ...allocation,
          id: crypto.randomUUID(),
        }),
      ),
    }
  }
}
