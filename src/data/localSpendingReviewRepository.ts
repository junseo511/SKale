import type {
  ConfirmedSpendingAnalysis,
  SpendingReviewRepository,
} from '../domain/spending'

const STORAGE_KEY = 'skale.confirmed-spending-analysis'

export class LocalSpendingReviewRepository implements SpendingReviewRepository {
  public loadLatest(): ConfirmedSpendingAnalysis | null {
    const serializedAnalysis = window.localStorage.getItem(STORAGE_KEY)

    if (!serializedAnalysis) {
      return null
    }

    try {
      return JSON.parse(serializedAnalysis) as ConfirmedSpendingAnalysis
    } catch {
      return null
    }
  }

  public save(analysis: ConfirmedSpendingAnalysis): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(analysis))
  }
}
