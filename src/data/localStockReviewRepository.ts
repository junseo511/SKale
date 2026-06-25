import type {
  ConfirmedStockAnalysis,
  StockReviewRepository,
} from '../domain/stock'

const STORAGE_KEY = 'skale.confirmed-stock-analysis'

export class LocalStockReviewRepository implements StockReviewRepository {
  public loadLatest(): ConfirmedStockAnalysis | null {
    const serialized = window.localStorage.getItem(STORAGE_KEY)
    if (!serialized) {
      return null
    }
    try {
      return JSON.parse(serialized) as ConfirmedStockAnalysis
    } catch {
      return null
    }
  }

  public save(analysis: ConfirmedStockAnalysis): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(analysis))
  }
}
