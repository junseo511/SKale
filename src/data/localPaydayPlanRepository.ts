import type { PaydayPlan } from '../domain/paydayPlan'

const STORAGE_KEY = 'skale.payday-plan'

export interface PaydayPlanRepository {
  load(): PaydayPlan | null
  save(plan: PaydayPlan): void
}

export class LocalPaydayPlanRepository implements PaydayPlanRepository {
  public load(): PaydayPlan | null {
    const serializedPlan = window.localStorage.getItem(STORAGE_KEY)
    if (!serializedPlan) {
      return null
    }

    try {
      return JSON.parse(serializedPlan) as PaydayPlan
    } catch {
      return null
    }
  }

  public save(plan: PaydayPlan): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
  }
}
