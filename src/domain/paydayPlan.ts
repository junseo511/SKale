export type RiskProfile = '안정형' | '균형형' | '공격형'
export type InvestmentHorizon = '1년 미만' | '1~3년' | '3년 이상'
export type CustomSalaryUseBucket = 'essential' | 'goal' | 'flexible'

export interface CustomSalaryUse {
  name: string
  amount: number
  bucket: CustomSalaryUseBucket
  note: string
}

export interface PaydayInput {
  monthlySalary: number
  essentialExpense: number
  debtPayment: number
  currentEmergencyFund: number
  targetEmergencyFund: number
  goalName: string
  goalMonthlyAmount: number
  flexibleSpending: number
  riskProfile: RiskProfile
  investmentHorizon: InvestmentHorizon
  customUses: CustomSalaryUse[]
}

export type AllocationRole =
  | 'essential'
  | 'debt'
  | 'emergency'
  | 'goal'
  | 'flexible'
  | 'investment'

export interface SalaryAllocation {
  role: AllocationRole
  label: string
  amount: number
  reason: string
  priority: number
  details: CustomSalaryUse[]
}

export interface PortfolioAllocation {
  label: string
  percentage: number
  amount: number
  description: string
}

export interface PaydayPlan {
  input: PaydayInput
  allocations: SalaryAllocation[]
  portfolio: PortfolioAllocation[]
  availableInvestmentAmount: number
  remainingAmount: number
  safetyStatus: '안전망 우선' | '균형 배분' | '투자 가능'
  headline: string
  guidance: string[]
}

const EMERGENCY_CONTRIBUTION_RATIO = 0.2

export function createPaydayPlan(input: PaydayInput): PaydayPlan {
  const salary = positive(input.monthlySalary)
  const essentialExpense = Math.min(positive(input.essentialExpense), salary)
  const afterEssential = salary - essentialExpense
  const debtPayment = Math.min(positive(input.debtPayment), afterEssential)
  const afterDebt = afterEssential - debtPayment
  const emergencyFundGap = Math.max(
    positive(input.targetEmergencyFund) - positive(input.currentEmergencyFund),
    0,
  )
  const recommendedEmergencyContribution = Math.round(
    salary * EMERGENCY_CONTRIBUTION_RATIO,
  )
  const emergencyFund = Math.min(
    emergencyFundGap,
    recommendedEmergencyContribution,
    afterDebt,
  )
  const afterEmergencyFund = afterDebt - emergencyFund
  const goalAmount = Math.min(
    positive(input.goalMonthlyAmount),
    afterEmergencyFund,
  )
  const afterGoal = afterEmergencyFund - goalAmount
  const flexibleSpending = Math.min(
    positive(input.flexibleSpending),
    afterGoal,
  )
  const investmentAmount = Math.max(afterGoal - flexibleSpending, 0)

  const allocations: SalaryAllocation[] = [
    {
      role: 'essential',
      label: '필수 생활비',
      amount: essentialExpense,
      reason: '주거비·통신비처럼 이번 달 반드시 지켜야 할 지출이에요.',
      priority: 1,
      details: usesFor(input.customUses, 'essential'),
    },
    {
      role: 'debt',
      label: '부채·카드 결제',
      amount: debtPayment,
      reason: '연체와 이자 부담을 피하기 위해 투자보다 먼저 확보해요.',
      priority: 2,
      details: [],
    },
    {
      role: 'emergency',
      label: '비상금',
      amount: emergencyFund,
      reason:
        emergencyFundGap > 0
          ? '목표 비상금까지의 부족분을 월급의 20% 한도에서 채워요.'
          : '비상금 목표를 이미 달성해 이번 달 추가 배분은 생략했어요.',
      priority: 3,
      details: [],
    },
    {
      role: 'goal',
      label: input.goalName.trim() || '목표 자금',
      amount: goalAmount,
      reason: '가까운 시일에 쓸 돈은 투자금과 분리해 변동성을 피해야 해요.',
      priority: 4,
      details: usesFor(input.customUses, 'goal'),
    },
    {
      role: 'flexible',
      label: '여유 생활비',
      amount: flexibleSpending,
      reason: '계획을 오래 유지할 수 있도록 자유롭게 쓸 한도를 남겨요.',
      priority: 5,
      details: usesFor(input.customUses, 'flexible'),
    },
    {
      role: 'investment',
      label: '장기 투자',
      amount: investmentAmount,
      reason: '앞선 안전장치를 모두 반영하고 실제로 남은 금액만 투자해요.',
      priority: 6,
      details: [],
    },
  ]

  const safetyStatus = determineSafetyStatus(
    emergencyFundGap,
    debtPayment,
    investmentAmount,
  )

  return {
    input,
    allocations,
    portfolio: createPortfolio(
      investmentAmount,
      input.riskProfile,
      input.investmentHorizon,
    ),
    availableInvestmentAmount: investmentAmount,
    remainingAmount:
      salary -
      allocations.reduce(
        (total, allocation) => total + allocation.amount,
        0,
      ),
    safetyStatus,
    headline: createHeadline(safetyStatus, investmentAmount),
    guidance: createGuidance(input, emergencyFundGap, investmentAmount),
  }
}

export function replaceAllocationAmount(
  plan: PaydayPlan,
  role: AllocationRole,
  amount: number,
): PaydayPlan {
  const normalizedAmount = positive(amount)
  const allocations = plan.allocations.map((allocation) =>
    allocation.role === role
      ? { ...allocation, amount: normalizedAmount }
      : allocation,
  )
  const allocatedAmount = allocations.reduce(
    (total, allocation) => total + allocation.amount,
    0,
  )
  const investmentAmount =
    allocations.find((allocation) => allocation.role === 'investment')
      ?.amount ?? 0

  return {
    ...plan,
    allocations,
    availableInvestmentAmount: investmentAmount,
    remainingAmount: plan.input.monthlySalary - allocatedAmount,
    portfolio: createPortfolio(
      investmentAmount,
      plan.input.riskProfile,
      plan.input.investmentHorizon,
    ),
  }
}

export function isBalancedPlan(plan: PaydayPlan): boolean {
  return Math.abs(plan.remainingAmount) < 1
}

function createPortfolio(
  investmentAmount: number,
  riskProfile: RiskProfile,
  investmentHorizon: InvestmentHorizon,
): PortfolioAllocation[] {
  if (investmentAmount <= 0) {
    return []
  }

  const base =
    riskProfile === '안정형'
      ? [
          ['현금성·단기채', 50, '가격 변동을 낮추는 방어 자산'],
          ['광범위 주식 ETF', 40, '시장 전체에 분산하는 핵심 자산'],
          ['성장 자산', 10, '장기 성장 기회를 위한 제한된 비중'],
        ]
      : riskProfile === '공격형'
        ? [
            ['현금성·단기채', 10, '하락 시 대응할 최소 대기 자금'],
            ['광범위 주식 ETF', 55, '포트폴리오의 분산된 중심'],
            ['성장 자산', 35, '높은 변동성을 감수하는 성장 비중'],
          ]
        : [
            ['현금성·단기채', 25, '변동성을 완충하는 안전 자산'],
            ['광범위 주식 ETF', 55, '장기 투자의 분산된 중심'],
            ['성장 자산', 20, '성장 기회를 위한 위성 자산'],
          ]

  const shortTermAdjustment = investmentHorizon === '1년 미만' ? 20 : 0
  const mediumTermAdjustment = investmentHorizon === '1~3년' ? 10 : 0
  const defensiveAdjustment = shortTermAdjustment || mediumTermAdjustment
  const adjusted = base.map(([label, percentage, description], index) => {
    const numericPercentage = Number(percentage)
    if (index === 0) {
      return [label, numericPercentage + defensiveAdjustment, description] as const
    }
    const reducibleTotal = 100 - Number(base[0][1])
    const reduction =
      defensiveAdjustment * (numericPercentage / Math.max(reducibleTotal, 1))
    return [label, numericPercentage - reduction, description] as const
  })

  const roundedPercentages = adjusted.map((item) => Math.round(item[1]))
  roundedPercentages[roundedPercentages.length - 1] +=
    100 - roundedPercentages.reduce((total, value) => total + value, 0)

  let allocatedAmount = 0
  return adjusted.map(([label, , description], index) => {
    const isLast = index === adjusted.length - 1
    const amount = isLast
      ? investmentAmount - allocatedAmount
      : Math.round((investmentAmount * roundedPercentages[index]) / 100)
    allocatedAmount += amount

    return {
      label: String(label),
      percentage: roundedPercentages[index],
      amount,
      description: String(description),
    }
  })
}

function determineSafetyStatus(
  emergencyFundGap: number,
  debtPayment: number,
  investmentAmount: number,
): PaydayPlan['safetyStatus'] {
  if (emergencyFundGap > 0 || debtPayment > 0) {
    return '안전망 우선'
  }
  if (investmentAmount > 0) {
    return '투자 가능'
  }
  return '균형 배분'
}

function createHeadline(
  safetyStatus: PaydayPlan['safetyStatus'],
  investmentAmount: number,
): string {
  if (safetyStatus === '안전망 우선') {
    return '이번 달은 투자보다 비상금과 카드값을 먼저 챙기는 편이 좋아요.'
  }
  if (investmentAmount > 0) {
    return `${investmentAmount.toLocaleString()}원을 무리 없이 장기 투자에 배분할 수 있어요.`
  }
  return '이번 달은 모든 돈에 역할을 주는 것만으로도 충분해요.'
}

function createGuidance(
  input: PaydayInput,
  emergencyFundGap: number,
  investmentAmount: number,
): string[] {
  const guidance: string[] = []
  if (input.debtPayment > 0) {
    guidance.push('카드 결제와 부채 상환액은 월급일에 바로 분리하세요.')
  }
  if (emergencyFundGap > 0) {
    guidance.push(
      `비상금 목표까지 ${emergencyFundGap.toLocaleString()}원이 남아 있어 투자 확대보다 먼저 채우는 편이 안전해요.`,
    )
  }
  if (input.goalMonthlyAmount > 0) {
    guidance.push(
      `${input.goalName.trim() || '목표 자금'}은 별도 계좌로 옮겨 투자금과 섞이지 않게 하세요.`,
    )
  }
  if (investmentAmount > 0) {
    guidance.push('투자금은 한 번에 예측하기보다 같은 날 정기적으로 분산 투자하세요.')
  }
  return guidance.slice(0, 3)
}

function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(Math.round(value), 0) : 0
}

function usesFor(
  customUses: CustomSalaryUse[],
  bucket: CustomSalaryUseBucket,
): CustomSalaryUse[] {
  return customUses.filter((use) => use.bucket === bucket)
}
