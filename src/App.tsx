import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  ChevronRight,
  CircleAlert,
  Landmark,
  LockKeyhole,
  PiggyBank,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  WalletCards,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { LocalPaydayPlanRepository } from './data/localPaydayPlanRepository'
import {
  createPaydayPlan,
  isBalancedPlan,
  replaceAllocationAmount,
  type AllocationRole,
  type InvestmentHorizon,
  type PaydayInput,
  type PaydayPlan,
  type RiskProfile,
} from './domain/paydayPlan'
import './App.css'

const EXAMPLE_INPUT: PaydayInput = {
  monthlySalary: 3_200_000,
  essentialExpense: 1_250_000,
  debtPayment: 420_000,
  currentEmergencyFund: 1_200_000,
  targetEmergencyFund: 4_500_000,
  goalName: '가을 여행',
  goalMonthlyAmount: 300_000,
  flexibleSpending: 450_000,
  riskProfile: '균형형',
  investmentHorizon: '3년 이상',
}

const repository = new LocalPaydayPlanRepository()

function App(): ReactNode {
  const savedPlan = useMemo(() => repository.load(), [])
  const [input, setInput] = useState<PaydayInput>(
    savedPlan?.input ?? EXAMPLE_INPUT,
  )
  const [plan, setPlan] = useState<PaydayPlan | null>(savedPlan)
  const [isSaved, setIsSaved] = useState(Boolean(savedPlan))

  function buildPlan(): void {
    setPlan(createPaydayPlan(input))
    setIsSaved(false)
    window.requestAnimationFrame(() => {
      document
        .querySelector('#plan-result')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function updateAllocation(role: AllocationRole, amount: number): void {
    setPlan((currentPlan) =>
      currentPlan
        ? replaceAllocationAmount(currentPlan, role, amount)
        : currentPlan,
    )
    setIsSaved(false)
  }

  function savePlan(): void {
    if (!plan || !isBalancedPlan(plan)) {
      return
    }
    repository.save(plan)
    setIsSaved(true)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="SKale 처음으로">
          <span className="brand-symbol">S</span>
          <span>SKale</span>
        </a>
        <div className="header-status">
          <span className="status-dot" />
          Gemini 호출 꺼짐
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={15} />
              Payday decision agent
            </div>
            <h1>
              월급을 받았다.
              <br />
              <em>이제 어떻게 하지?</em>
            </h1>
            <p>
              먼저 지켜야 할 돈을 분리하고, 남은 돈만 투자하세요.
              SKale이 월급 한 번의 결정을 끝까지 연결합니다.
            </p>
            <a className="hero-button" href="#planner">
              이번 월급 배분하기
              <ArrowRight size={18} />
            </a>
          </div>

          <div className="hero-visual" aria-label="월급 배분 원칙">
            <div className="salary-ticket">
              <div>
                <span>이번 달 월급</span>
                <strong>{formatWon(input.monthlySalary)}</strong>
              </div>
              <Banknote size={30} />
            </div>
            <div className="priority-flow">
              <FlowItem icon={<LockKeyhole />} label="생활" value="먼저" />
              <ChevronRight size={18} />
              <FlowItem icon={<ShieldCheck />} label="안전망" value="다음" />
              <ChevronRight size={18} />
              <FlowItem icon={<PiggyBank />} label="투자" value="마지막" />
            </div>
          </div>
        </section>

        <section className="principle-strip" aria-label="서비스 원칙">
          <Principle number="01" title="쓸 돈" text="필수 생활비와 결제액" />
          <Principle number="02" title="지킬 돈" text="비상금과 가까운 목표" />
          <Principle number="03" title="키울 돈" text="남은 장기 투자금" />
        </section>

        <section className="planner-section" id="planner">
          <div className="section-heading">
            <div>
              <span>STEP 1</span>
              <h2>이번 월급의 조건을 알려주세요</h2>
              <p>정확히 모르는 값은 현재 알고 있는 범위까지만 입력해도 괜찮아요.</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setInput(EXAMPLE_INPUT)
                setPlan(null)
                setIsSaved(false)
              }}
            >
              <RotateCcw size={15} />
              예시로 초기화
            </button>
          </div>

          <div className="planner-grid">
            <section className="form-card">
              <div className="form-group">
                <FormTitle
                  icon={<Banknote />}
                  title="들어온 돈"
                  description="통장에 실제 입금된 월급을 기준으로 해요."
                />
                <MoneyField
                  label="월 실수령액"
                  value={input.monthlySalary}
                  onChange={(monthlySalary) =>
                    setInput({ ...input, monthlySalary })
                  }
                />
              </div>

              <div className="form-group">
                <FormTitle
                  icon={<WalletCards />}
                  title="이번 달 반드시 나갈 돈"
                  description="생활과 신용을 지키는 돈부터 확보해요."
                />
                <div className="two-fields">
                  <MoneyField
                    label="필수 생활비"
                    hint="월세·통신·보험·식비"
                    value={input.essentialExpense}
                    onChange={(essentialExpense) =>
                      setInput({ ...input, essentialExpense })
                    }
                  />
                  <MoneyField
                    label="카드·부채 결제"
                    hint="이번 달 실제 납부액"
                    value={input.debtPayment}
                    onChange={(debtPayment) =>
                      setInput({ ...input, debtPayment })
                    }
                  />
                </div>
              </div>

              <div className="form-group">
                <FormTitle
                  icon={<ShieldCheck />}
                  title="생활의 안전망"
                  description="예상치 못한 달에도 투자를 깨지 않도록 준비해요."
                />
                <div className="two-fields">
                  <MoneyField
                    label="현재 비상금"
                    value={input.currentEmergencyFund}
                    onChange={(currentEmergencyFund) =>
                      setInput({ ...input, currentEmergencyFund })
                    }
                  />
                  <MoneyField
                    label="비상금 목표"
                    value={input.targetEmergencyFund}
                    onChange={(targetEmergencyFund) =>
                      setInput({ ...input, targetEmergencyFund })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="form-card">
              <div className="form-group">
                <FormTitle
                  icon={<Target />}
                  title="가까운 목표와 여유"
                  description="곧 쓸 돈은 투자하지 않고 따로 모아요."
                />
                <label>
                  목표 이름
                  <input
                    value={input.goalName}
                    onChange={(event) =>
                      setInput({ ...input, goalName: event.target.value })
                    }
                  />
                </label>
                <div className="two-fields">
                  <MoneyField
                    label="이번 달 목표 저축"
                    value={input.goalMonthlyAmount}
                    onChange={(goalMonthlyAmount) =>
                      setInput({ ...input, goalMonthlyAmount })
                    }
                  />
                  <MoneyField
                    label="여유 생활비"
                    value={input.flexibleSpending}
                    onChange={(flexibleSpending) =>
                      setInput({ ...input, flexibleSpending })
                    }
                  />
                </div>
              </div>

              <div className="form-group">
                <FormTitle
                  icon={<Landmark />}
                  title="투자 조건"
                  description="남는 투자금을 어떤 성격으로 나눌지 결정해요."
                />
                <div className="choice-group">
                  <span>투자 성향</span>
                  <div className="segmented-control">
                    {(['안정형', '균형형', '성장형'] as RiskProfile[]).map(
                      (profile) => (
                        <button
                          className={
                            input.riskProfile === profile ? 'selected' : ''
                          }
                          type="button"
                          key={profile}
                          onClick={() =>
                            setInput({ ...input, riskProfile: profile })
                          }
                        >
                          {profile}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <label>
                  투자 기간
                  <select
                    value={input.investmentHorizon}
                    onChange={(event) =>
                      setInput({
                        ...input,
                        investmentHorizon: event.target
                          .value as InvestmentHorizon,
                      })
                    }
                  >
                    <option>1년 미만</option>
                    <option>1~3년</option>
                    <option>3년 이상</option>
                  </select>
                </label>
              </div>

              <div className="privacy-note">
                <LockKeyhole size={17} />
                <div>
                  <strong>계좌번호와 개인정보는 입력하지 마세요.</strong>
                  <span>현재 계산은 브라우저 안에서만 수행되며 Gemini를 호출하지 않습니다.</span>
                </div>
              </div>

              <button className="primary-button" type="button" onClick={buildPlan}>
                내 월급에 역할 주기
                <ArrowRight size={18} />
              </button>
            </section>
          </div>
        </section>

        {plan && (
          <section className="result-section" id="plan-result">
            <div className="result-hero">
              <div>
                <span className="result-status">{plan.safetyStatus}</span>
                <h2>{plan.headline}</h2>
                <p>금액을 직접 바꾸면 남은 금액과 투자안도 즉시 다시 계산됩니다.</p>
              </div>
              <div className="investment-answer">
                <span>이번 달 투자 가능 금액</span>
                <strong>{formatWon(plan.availableInvestmentAmount)}</strong>
              </div>
            </div>

            <div className="result-grid">
              <section className="allocation-card">
                <div className="card-heading">
                  <div>
                    <span>STEP 2</span>
                    <h3>월급 사용처 확정하기</h3>
                  </div>
                  <strong
                    className={
                      plan.remainingAmount === 0
                        ? 'balance valid'
                        : 'balance invalid'
                    }
                  >
                    {plan.remainingAmount === 0
                      ? '딱 맞게 배분됨'
                      : `${formatSignedWon(plan.remainingAmount)} 남음`}
                  </strong>
                </div>

                <div className="allocation-list">
                  {plan.allocations.map((allocation) => (
                    <article
                      className={`allocation-row ${allocation.role}`}
                      key={allocation.role}
                    >
                      <span className="priority-number">
                        {String(allocation.priority).padStart(2, '0')}
                      </span>
                      <div className="allocation-copy">
                        <strong>{allocation.label}</strong>
                        <p>{allocation.reason}</p>
                      </div>
                      <MoneyInput
                        ariaLabel={`${allocation.label} 배분 금액`}
                        value={allocation.amount}
                        onChange={(amount) =>
                          updateAllocation(allocation.role, amount)
                        }
                      />
                    </article>
                  ))}
                </div>

                {!isBalancedPlan(plan) && (
                  <div className="balance-warning" role="alert">
                    <CircleAlert size={17} />
                    배분 합계가 월급과 같아야 저장할 수 있어요.
                  </div>
                )}
              </section>

              <aside className="guidance-card">
                <div className="card-heading">
                  <div>
                    <span>AGENT NOTE</span>
                    <h3>이번 월급의 우선순위</h3>
                  </div>
                </div>
                <ol>
                  {plan.guidance.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
                <div className="rule-box">
                  <ShieldCheck size={19} />
                  <p>
                    투자금은 목표가 아닙니다. 생활비·결제·비상금을 지키고 난 뒤의
                    결과예요.
                  </p>
                </div>
              </aside>
            </div>

            <section className="portfolio-card">
              <div className="card-heading">
                <div>
                  <span>STEP 3</span>
                  <h3>남은 투자금 나누기</h3>
                  <p>
                    {input.riskProfile} · {input.investmentHorizon} 기준의 자산군
                    배분 예시예요.
                  </p>
                </div>
              </div>

              {plan.portfolio.length > 0 ? (
                <>
                  <div className="portfolio-bar" aria-label="투자 자산 배분">
                    {plan.portfolio.map((allocation, index) => (
                      <span
                        className={`portfolio-segment segment-${index + 1}`}
                        style={{ width: `${allocation.percentage}%` }}
                        key={allocation.label}
                      />
                    ))}
                  </div>
                  <div className="portfolio-grid">
                    {plan.portfolio.map((allocation, index) => (
                      <article key={allocation.label}>
                        <i className={`legend-color segment-${index + 1}`} />
                        <span>{allocation.label}</span>
                        <strong>{allocation.percentage}%</strong>
                        <b>{formatWon(allocation.amount)}</b>
                        <p>{allocation.description}</p>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="portfolio-empty">
                  <PiggyBank size={28} />
                  <strong>이번 달 투자금은 0원이에요.</strong>
                  <p>안전망을 먼저 채운 뒤 다음 월급에서 다시 계산해 보세요.</p>
                </div>
              )}

              <div className="portfolio-footer">
                <p>
                  종목 매수 지시가 아닌 자산군 배분 예시입니다. 실제 상품 선택과
                  투자 판단은 사용자가 결정해야 합니다.
                </p>
                <button
                  className="save-button"
                  type="button"
                  disabled={!isBalancedPlan(plan)}
                  onClick={savePlan}
                >
                  {isSaved ? <BadgeCheck size={18} /> : <Check size={18} />}
                  {isSaved ? '이번 월급 계획 저장됨' : '이번 월급 계획 확정'}
                </button>
              </div>
            </section>
          </section>
        )}
      </main>

      <footer>
        <div className="brand footer-brand">
          <span className="brand-symbol">S</span>
          <span>SKale</span>
        </div>
        <p>월급의 모든 원화에 역할을 주는 의사결정 Agent</p>
        <span>계산 결과는 참고용이며 금융 자문이 아닙니다.</span>
      </footer>
    </div>
  )
}

function Principle({
  number,
  title,
  text,
}: {
  number: string
  title: string
  text: string
}): ReactNode {
  return (
    <article>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </article>
  )
}

function FlowItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}): ReactNode {
  return (
    <div className="flow-item">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function FormTitle({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}): ReactNode {
  return (
    <div className="form-title">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  )
}

function MoneyField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <label>
      <span className="label-row">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <div className="money-field">
        <input
          inputMode="numeric"
          value={value === 0 ? '' : value.toLocaleString()}
          placeholder="0"
          onChange={(event) => onChange(parseMoney(event.target.value))}
        />
        <span>원</span>
      </div>
    </label>
  )
}

function MoneyInput({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string
  value: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <div className="allocation-input">
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        value={value === 0 ? '' : value.toLocaleString()}
        onChange={(event) => onChange(parseMoney(event.target.value))}
      />
      <span>원</span>
    </div>
  )
}

function parseMoney(value: string): number {
  return Number(value.replaceAll(',', '').replace(/\D/g, '')) || 0
}

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString()}원`
}

function formatSignedWon(value: number): string {
  return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}원`
}

export default App
