export type StockVerdict =
  | '핵심 검토 후보'
  | '좋은 후보'
  | '관찰 후보'
  | '보류'
  | '제외'
  | '데이터 부족'

export type StockDecision = 'pending' | 'accepted' | 'rejected'

export interface StockAnalysisRequest {
  companyName: string
  ticker?: string
  industryDescription: string
  businessDescription: string
  financialData: string
  valuationData: string
  managementNotes: string
  userConcern: string
  userFeedback?: string
}

export interface StockScoreBreakdown {
  industryStructure: number | null
  competitiveAdvantage: number | null
  financialQuality: number | null
  valuation: number | null
  managementCapitalAllocation: number | null
  riskControl: number | null
}

export interface StockAnalysis {
  id: string
  createdAt: string
  companyName: string
  ticker?: string
  verdict: StockVerdict
  totalScore: number | null
  scoreBreakdown: StockScoreBreakdown
  oneSentenceThesis: string
  strengths: string[]
  weaknesses: string[]
  fatalFlags: string[]
  missingData: string[]
  assumptions: string[]
  questionsToCheck: string[]
  monitoringMetrics: string[]
  nextAction: string
  disclaimer: string
  decision: StockDecision
  appliedFeedback?: string
}

export interface ConfirmedStockAnalysis extends StockAnalysis {
  confirmedAt: string
}

export interface StockAgent {
  analyze(
    request: StockAnalysisRequest,
    signal: AbortSignal,
  ): Promise<StockAnalysis>
}

export interface StockReviewRepository {
  loadLatest(): ConfirmedStockAnalysis | null
  save(analysis: ConfirmedStockAnalysis): void
}

export const stockScoreMaximums: Record<keyof StockScoreBreakdown, number> = {
  industryStructure: 25,
  competitiveAdvantage: 20,
  financialQuality: 25,
  valuation: 15,
  managementCapitalAllocation: 10,
  riskControl: 5,
}

export function calculateStockScore(
  scoreBreakdown: StockScoreBreakdown,
): number | null {
  const scores = Object.values(scoreBreakdown)
  if (scores.some((score) => score === null)) {
    return null
  }
  return scores.reduce<number>((total, score) => total + (score ?? 0), 0)
}

export function isStockScoreValid(analysis: StockAnalysis): boolean {
  const calculatedScore = calculateStockScore(analysis.scoreBreakdown)
  return calculatedScore === analysis.totalScore
}
