import {
  ArrowUp,
  Bot,
  Calculator,
  CalendarDays,
  ChartLine as LineChartIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  ImagePlus,
  LockKeyhole,
  MessageCircleMore,
  Minus,
  Paperclip,
  PiggyBank,
  Plus,
  RotateCcw,
  Sparkles,
  SquarePen,
  TrendingUp,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { HttpPaydayConversationAgent } from './data/httpPaydayConversationAgent'
import { LocalPaydayPlanRepository } from './data/localPaydayPlanRepository'
import { LocalPaydayWorkspaceRepository } from './data/localPaydayWorkspaceRepository'
import {
  applyFinancialProfilePatch,
  countCompletedProfileFields,
  EMPTY_FINANCIAL_PROFILE,
  INITIAL_AGENT_MESSAGE,
  toPaydayInput,
  type ConversationAttachment,
  type PaydayConversationAppContext,
  type ConversationMessage,
  type FinancialProfile,
  type FinancialProfilePatch,
  type MonthlySpendingSummary,
  type NextActionRecommendation,
  type PaydayConversationResponse,
  type SpendingCategoryAmount,
} from './domain/paydayConversation'
import {
  estimateNetSalary,
  type NetSalaryEstimate,
  type NetSalaryInput,
  type SalaryUnit,
} from './domain/netSalary'
import {
  createPaydayPlan,
  type PaydayPlan,
  type PortfolioAllocation,
  type RiskProfile,
  type SalaryAllocation,
} from './domain/paydayPlan'
import './App.css'

type SpendingMonthMode = 'auto' | 'manual'
type ServerStatus = 'checking' | 'online' | 'offline'
type NextActionKind = 'salary' | 'message' | 'plan'
type EditableProfileField = keyof Pick<
  FinancialProfile,
  | 'monthlySalary'
  | 'essentialExpense'
  | 'debtPayment'
  | 'currentEmergencyFund'
  | 'targetEmergencyFund'
  | 'goalName'
  | 'goalMonthlyAmount'
  | 'flexibleSpending'
  | 'riskProfile'
  | 'investmentHorizon'
>

interface FinancialProfileItem {
  field: EditableProfileField
  label: string
  value: string
  isComplete: boolean
  isDefault: boolean
}

interface NextAction {
  kind: NextActionKind
  title: string
  description: string
  primaryLabel: string
  draft?: string
}

interface SecondaryNextAction {
  label: string
  message: string
  icon: ReactNode
}

type ConversationActionIntent =
  | 'salary'
  | 'spending_distribution'
  | 'fixed_costs'
  | 'safety_check'
  | 'detail_plan'
  | 'detail_compare'
  | 'detail_adjust'
  | 'investment_research'
  | 'preference_adjust'

interface SpendingTrendPoint {
  monthLabel: string
  totalExpense: number
  essentialExpense: number
  flexibleExpense: number
}

const MAX_IMAGE_COUNT = 4
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const PROFILE_FIELD_COUNT = 1
const CHART_COLORS = [
  '#ea002c',
  '#ff7a00',
  '#a43c2d',
  '#f05267',
  '#ffb057',
  '#6f6466',
]
const agent = new HttpPaydayConversationAgent({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})
const workspaceRepository = new LocalPaydayWorkspaceRepository()
const planRepository = new LocalPaydayPlanRepository()

function App(): ReactNode {
  const savedWorkspace = useMemo(() => workspaceRepository.load(), [])
  const [messages, setMessages] = useState<ConversationMessage[]>(
    savedWorkspace?.messages.length
      ? normalizeConversationMessages(savedWorkspace.messages)
      : [INITIAL_AGENT_MESSAGE],
  )
  const [profile, setProfile] = useState<FinancialProfile>(() => {
    const savedProfile = savedWorkspace?.profile
    return normalizeFinancialProfile({
      ...EMPTY_FINANCIAL_PROFILE,
      ...savedProfile,
      goalName: savedProfile?.goalName ?? EMPTY_FINANCIAL_PROFILE.goalName,
      preferences: savedProfile?.preferences ?? [],
      customUses: savedProfile?.customUses ?? [],
    })
  })
  const [monthlySpending, setMonthlySpending] = useState<
    MonthlySpendingSummary[]
  >((savedWorkspace?.monthlySpending ?? []).map(normalizeMonthlySpendingSummary))
  const [draft, setDraft] = useState('')
  const [spendingMonthMode, setSpendingMonthMode] =
    useState<SpendingMonthMode>('auto')
  const [targetMonth, setTargetMonth] = useState(previousMonth())
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking')
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([])
  const [pendingResponse, setPendingResponse] =
    useState<PaydayConversationResponse | null>(null)
  const [latestRecommendedAction, setLatestRecommendedAction] =
    useState<NextAction | null>(null)
  const [
    latestSecondaryRecommendedActions,
    setLatestSecondaryRecommendedActions,
  ] = useState<NextActionRecommendation[]>([])
  const [isReplying, setIsReplying] = useState(false)
  const [replyWaitNotice, setReplyWaitNotice] = useState(
    '내용을 정리하고 있어요. 최대 1분 까지 걸릴 수 있어요.',
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [isSalaryCalculatorOpen, setIsSalaryCalculatorOpen] =
    useState(false)
  const [editingProfileField, setEditingProfileField] =
    useState<EditableProfileField | null>(null)
  const abortControllerReference = useRef<AbortController | null>(null)
  const scrollPositionBeforeModalReference = useRef(0)
  const messageListReference = useRef<HTMLDivElement | null>(null)
  const composerTextAreaReference = useRef<HTMLTextAreaElement | null>(null)
  const responseFocusReference = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    workspaceRepository.save({ messages, profile, monthlySpending })
  }, [messages, profile, monthlySpending])

  useEffect(() => () => abortControllerReference.current?.abort(), [])

  useEffect(() => {
    const messageList = messageListReference.current
    if (!messageList) {
      return
    }
    requestAnimationFrame(() => {
      if (!isReplying && responseFocusReference.current) {
        responseFocusReference.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
        return
      }
      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [messages.length, pendingResponse, isReplying])

  useEffect(() => {
    let isMounted = true

    async function checkServerHealth(): Promise<void> {
      try {
        const status = await fetchServerHealth(import.meta.env.VITE_API_BASE_URL)
        if (isMounted) {
          setServerStatus(status)
        }
      } catch {
        if (isMounted) {
          setServerStatus('offline')
        }
      }
    }

    void checkServerHealth()
    const intervalId = window.setInterval(() => {
      void checkServerHealth()
    }, 15_000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  const paydayInput = useMemo(() => toPaydayInput(profile), [profile])
  const plan = useMemo(
    () => (paydayInput ? createPaydayPlan(paydayInput) : null),
    [paydayInput],
  )
  useEffect(() => {
    if (plan) {
      planRepository.save(plan)
    }
  }, [plan])
  const completedProfileFields = countCompletedProfileFields(profile)
  const hasSpendingHistory = monthlySpending.length > 0
  const completedActionIntents = useMemo(
    () => createCompletedActionIntents(messages, profile, monthlySpending),
    [messages, profile, monthlySpending],
  )
  const nextAction = getNextAction(profile, plan, hasSpendingHistory)
  const recommendedAction = resolveRecommendedAction(
    latestRecommendedAction,
    nextAction,
    profile,
    hasSpendingHistory,
    messages,
    completedActionIntents,
  )
  const recommendedSecondaryActions = resolveSecondaryRecommendedActions(
    latestSecondaryRecommendedActions,
    recommendedAction,
    profile,
    hasSpendingHistory,
    messages,
    completedActionIntents,
  )
  const shouldShowQuickMessages = completedProfileFields > 0
  const shouldShowNextAction = !isReplying
  const effectiveTargetMonth =
    spendingMonthMode === 'manual' ? targetMonth : undefined
  const spendingSummaryPrompt = effectiveTargetMonth
    ? `${Number(effectiveTargetMonth.split('-')[1])}월 카드 내역을 카테고리별 지출 분포로 분석해 주세요.`
    : '카드 내역을 보고 자료 월을 먼저 판단한 뒤 카테고리별 지출 분포로 분석해 주세요.'
  const usPortfolioPrompt =
    plan && plan.availableInvestmentAmount > 0
      ? `${formatWon(plan.availableInvestmentAmount)}으로 미국 주식을 위주로 투자 포트폴리오를 구성해 주세요. ETF와 개별 종목 후보는 실제 티커로 적고, 역할별로 나눠 주세요. 현재가와 재무 데이터는 출처가 있을 때만 사용하고, 출처가 없으면 확인 필요로 표시해 주세요.`
      : '미국 주식을 위주로 투자 포트폴리오를 구성해 주세요. 먼저 내 상황에서 투자 가능한 금액과 투자 성향을 확인한 뒤, ETF와 개별 종목 후보를 실제 티커 중심으로 역할별로 나눠 주세요.'
  const quickMessages = [
    {
      label: effectiveTargetMonth
        ? `${Number(effectiveTargetMonth.split('-')[1])}월 지출 분포를 분석해 주세요.`
        : '사용내역 지출 분포를 분석해 주세요.',
      prompt: spendingSummaryPrompt,
      icon: <CalendarDays size={16} />,
    },
    {
      label: '월급날 월세 60만원을 먼저 빼두고 싶습니다.',
      prompt: '월급날 월세 60만원을 따로 빼두고 싶습니다.',
      icon: <WalletCards size={16} />,
    },
    {
      label: '투자 전에 비상금·카드값부터 점검해 주세요.',
      prompt:
        '이번 달은 투자보다 비상금과 카드값을 먼저 챙겨야 하는지 우선순위를 점검해 주세요.',
      icon: <PiggyBank size={16} />,
    },
    {
      label: '외식·여행은 지키고 다른 지출을 줄이고 싶습니다.',
      prompt: '외식과 여행은 줄이고 싶지 않은데, 다른 지출에서 균형을 맞춰 주세요.',
      icon: <MessageCircleMore size={16} />,
    },
    {
      label: '미국 주식 위주로 포트폴리오를 구성해 주세요.',
      prompt: usPortfolioPrompt,
      icon: <LineChartIcon size={16} />,
    },
  ]
  const stockResearchRequest = usPortfolioPrompt

  async function sendMessage(): Promise<void> {
    const normalizedDraft = draft.trim()
    if (!normalizedDraft && attachments.length === 0) {
      setErrorMessage('메시지를 입력하거나 사용내역 사진을 첨부해 주세요.')
      return
    }

    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content:
        normalizedDraft ||
        (effectiveTargetMonth
          ? `${effectiveTargetMonth} 사용내역 이미지 ${attachments.length}장을 보냈어요.`
          : `사용내역 이미지 ${attachments.length}장을 보냈어요. 자료 월은 이미지에서 판단해 주세요.`),
      createdAt: new Date().toISOString(),
      status: 'sent',
      attachments,
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setDraft('')
    setAttachments([])
    setPendingResponse(null)
    setErrorMessage('')
    setReplyWaitNotice(
      createReplyWaitNotice(normalizedDraft, attachments.length),
    )
    setIsReplying(true)

    abortControllerReference.current?.abort()
    const abortController = new AbortController()
    abortControllerReference.current = abortController

    try {
      const response = await agent.reply(
        {
          message: normalizedDraft,
          targetMonth: effectiveTargetMonth,
          attachments: attachments.map(({ name, mimeType, data }) => ({
            name,
            mimeType,
            data,
          })),
          profile,
          monthlySpending,
          appContext: createConversationAppContext({
            profile,
            plan,
            monthlySpending,
            hasSpendingHistory,
            completedActionIntents,
          }),
          recentMessages: nextMessages.slice(-8).map((message) => ({
            role: message.role,
            content: compactConversationContent(message.content),
          })),
        },
        abortController.signal,
      )
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          content: response.reply,
          createdAt: new Date().toISOString(),
          status: 'sent',
          attachments: [],
        },
      ])
      setLatestRecommendedAction(
        toNextAction(response.nextActionRecommendation),
      )
      setLatestSecondaryRecommendedActions(
        response.secondaryActionRecommendations ?? [],
      )
      const nextMonthlySpending =
        response.monthlySpendingProposal &&
        hasReadableMonthlySpendingAmount(response.monthlySpendingProposal)
          ? stageMonthlySpendingProposal(
              monthlySpending,
              response.monthlySpendingProposal,
            )
          : monthlySpending
      if (nextMonthlySpending !== monthlySpending) {
        setMonthlySpending(nextMonthlySpending)
      }
      const visibleResponse = createVisiblePendingResponse(
        response,
        profile,
        nextMonthlySpending,
      )
      setPendingResponse(visibleResponse)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === userMessage.id
            ? { ...message, status: 'failed' }
            : message,
        ),
      )
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '답변을 가져오지 못했어요. 다시 시도해 주세요.',
      )
    } finally {
      setIsReplying(false)
    }
  }

  function openSalaryCalculator(): void {
    scrollPositionBeforeModalReference.current = window.scrollY
    setIsSalaryCalculatorOpen(true)
  }

  function closeSalaryCalculator(): void {
    setIsSalaryCalculatorOpen(false)
    const restoreScrollPosition = () =>
      window.scrollTo(0, scrollPositionBeforeModalReference.current)
    requestAnimationFrame(restoreScrollPosition)
    window.setTimeout(restoreScrollPosition, 80)
  }

  function applyProfileProposal(): void {
    if (!pendingResponse) {
      return
    }
    setProfile((currentProfile) =>
      applyFinancialProfilePatch(
        currentProfile,
        pendingResponse.profilePatch,
      ),
    )
    setPendingResponse((currentResponse) =>
      currentResponse
        ? { ...currentResponse, profilePatch: {} }
        : currentResponse,
    )
    setLatestRecommendedAction(null)
    setLatestSecondaryRecommendedActions([])
  }

  function applyMonthlySpendingProposal(isReviewed = false): void {
    const proposal = pendingResponse?.monthlySpendingProposal
    if (!proposal || !hasReadableMonthlySpendingAmount(proposal)) {
      return
    }
    setMonthlySpending((currentSummaries) => [
      ...currentSummaries.filter(
        (summary) => summary.month !== proposal.month,
      ),
      {
        ...proposal,
        id: crypto.randomUUID(),
        needReview: proposal.needReview && !isReviewed,
      },
    ])
    setPendingResponse((currentResponse) =>
      currentResponse
        ? { ...currentResponse, monthlySpendingProposal: undefined }
        : currentResponse,
    )
    setLatestRecommendedAction(null)
    setLatestSecondaryRecommendedActions([])
  }

  function updateMonthlySpendingSummary(
    summaryId: string,
    patch: Partial<MonthlySpendingSummary>,
  ): void {
    setMonthlySpending((currentSummaries) =>
      currentSummaries.map((summary) =>
        summary.id === summaryId ? { ...summary, ...patch } : summary,
      ),
    )
  }

  function markMonthlySpendingReviewed(summaryId: string): void {
    updateMonthlySpendingSummary(summaryId, { needReview: false })
  }

  function startMonthlySpendingClarification(
    summary: Omit<MonthlySpendingSummary, 'id'>,
  ): void {
    setDraft(createMonthlySpendingClarification(summary))
    requestAnimationFrame(() => composerTextAreaReference.current?.focus())
  }

  function resetWorkspace(): void {
    abortControllerReference.current?.abort()
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    setMessages([INITIAL_AGENT_MESSAGE])
    setProfile(EMPTY_FINANCIAL_PROFILE)
    setMonthlySpending([])
    setDraft('')
    setAttachments([])
    setPendingResponse(null)
    setLatestRecommendedAction(null)
    setLatestSecondaryRecommendedActions([])
    setErrorMessage('')
  }

  async function addAttachments(files: FileList | null): Promise<void> {
    if (!files) {
      return
    }
    const availableCount = Math.max(
      MAX_IMAGE_COUNT - attachments.length,
      0,
    )
    const selectedFiles = [...files].slice(0, availableCount)

    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map(readAttachment),
      )
      setAttachments((currentAttachments) => [
        ...currentAttachments,
        ...nextAttachments,
      ])
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '이미지를 읽지 못했어요. 글자가 잘 보이는 사진으로 다시 올려주세요.',
      )
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="SKale 홈으로">
          <span className="brand-symbol">S</span>
          <span>SKale</span>
        </a>
        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="대화와 입력 내용 초기화"
            onClick={resetWorkspace}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </header>

      <main id="top">
        <section className="intro-section">
          <div>
            <span className="eyebrow">
              <WalletCards size={15} />
              월급 관리, 한 번에
            </span>
            <h1>
              이번 월급,
              <br />
              <em>어떻게 나눌까요?</em>
            </h1>
            <p>
              월급과 지난 소비를 알려주세요. 생활비부터 저축, 투자까지
              지금 상황에 맞게 정리해 드릴게요.
            </p>
          </div>
          <div className="intro-principles">
            <Principle
              icon={<FileText />}
              title="지난 소비 보기"
              text="카드 내역을 정리해요"
            />
            <ChevronRight size={18} />
            <Principle
              icon={<UserRound />}
              title="내 기준 정하기"
              text="꼭 필요한 지출은 남겨요"
            />
            <ChevronRight size={18} />
            <Principle
              icon={<PiggyBank />}
              title="월급 나누기"
              text="앞으로의 지출을 계획해요"
            />
          </div>
        </section>

        <section className="workspace">
          <section className="conversation-panel">
            <div className="panel-heading">
              <div>
                <span className="agent-avatar">
                  <Bot size={19} />
                </span>
                <div>
                  <strong>월급 플래너</strong>
                  <p>한 가지씩 알려주시면 돼요</p>
                </div>
              </div>
              <span
                className={`server-status-dot ${serverStatus}`}
                aria-label={getServerStatusLabel(serverStatus)}
                title={getServerStatusLabel(serverStatus)}
              />
            </div>

            <div
              className="message-list"
              aria-live="polite"
              ref={messageListReference}
            >
              {messages.map((message) => (
                <MessageBubble message={message} key={message.id} />
              ))}
              {isReplying && (
                <div className="message-row agent">
                  <span className="message-avatar">
                    <Bot size={16} />
                  </span>
                  <div className="typing-bubble">
                    <i />
                    <i />
                    <i />
                    {replyWaitNotice}
                  </div>
                </div>
              )}

              {pendingResponse && (
                <div ref={responseFocusReference}>
                  <ProposalCards
                    response={pendingResponse}
                    onApplyProfile={applyProfileProposal}
                    onApplyMonthlySpending={applyMonthlySpendingProposal}
                    onStartMonthlySpendingReview={
                      startMonthlySpendingClarification
                    }
                  />
                </div>
              )}
              {shouldShowNextAction && (
                <NextActionPanel
                  action={recommendedAction}
                  aiSecondaryActions={recommendedSecondaryActions}
                  profile={profile}
                  hasSpendingHistory={hasSpendingHistory}
                  completedActionIntents={completedActionIntents}
                  plan={plan}
                  stockResearchRequest={stockResearchRequest}
                  targetMonth={effectiveTargetMonth}
                  onOpenSalaryCalculator={openSalaryCalculator}
                  onUseDraft={(message) => {
                    setDraft(message)
                    requestAnimationFrame(() =>
                      composerTextAreaReference.current?.focus(),
                    )
                  }}
                />
              )}
            </div>

            {shouldShowQuickMessages && (
              <div className="suggestion-section open">
                <div className="starter-heading" id="starter-card-heading">
                  <span>이렇게도 질문해 보세요</span>
                  <small>추천 문장</small>
                </div>
                <div
                  id="starter-card-list"
                  className="starter-content"
                  aria-labelledby="starter-card-heading"
                  aria-hidden="false"
                >
                  <div className="quick-message-list" aria-label="시작 카드">
                    <button
                      className="starter-card calculator-quick-button"
                      type="button"
                      onClick={openSalaryCalculator}
                    >
                      <span>
                        <Calculator size={16} />
                      </span>
                      <small>실수령액을 계산해 주세요.</small>
                    </button>
                    {quickMessages.map((message) => (
                      <button
                        className="starter-card"
                        type="button"
                        key={message.prompt}
                        onClick={() => setDraft(message.prompt)}
                      >
                        <span>{message.icon}</span>
                        <small>{message.label}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="attachment-preview-list">
                {attachments.map((attachment) => (
                  <div className="attachment-preview" key={attachment.id}>
                    <img src={attachment.previewUrl} alt="" />
                    <span>{attachment.name}</span>
                    <button
                      type="button"
                      aria-label={`${attachment.name} 첨부 취소`}
                      onClick={() => {
                        if (attachment.previewUrl) {
                          URL.revokeObjectURL(attachment.previewUrl)
                        }
                        setAttachments((currentAttachments) =>
                          currentAttachments.filter(
                            (item) => item.id !== attachment.id,
                          ),
                        )
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {errorMessage && (
              <div className="conversation-error" role="alert">
                <CircleAlert size={16} />
                {errorMessage}
              </div>
            )}

            <div className="composer">
              <textarea
                ref={composerTextAreaReference}
                aria-label="SKale Agent에게 보낼 메시지"
                value={draft}
                placeholder="궁금한 점이나 내 상황을 편하게 적어주세요"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    void sendMessage()
                  }
                }}
              />
              <div className="composer-footer">
                <div className="attachment-actions">
                  <label className="attach-button">
                    <ImagePlus size={17} />
                    사용내역 사진
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      multiple
                      onChange={(event) => {
                        void addAttachments(event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <label className="month-field">
                    사용내역 자료 월
                    <span className="month-control">
                      <select
                        aria-label="사용내역 자료 월 선택 방식"
                        value={spendingMonthMode}
                        onChange={(event) =>
                          setSpendingMonthMode(
                            event.target.value as SpendingMonthMode,
                          )
                        }
                      >
                        <option value="auto">자동</option>
                        <option value="manual">직접 선택</option>
                      </select>
                      {spendingMonthMode === 'manual' && (
                        <input
                          type="month"
                          value={targetMonth}
                          onChange={(event) =>
                            setTargetMonth(event.target.value)
                          }
                        />
                      )}
                    </span>
                  </label>
                </div>
                <button
                  className="send-button"
                  type="button"
                  disabled={
                    isReplying ||
                    (!draft.trim() && attachments.length === 0)
                  }
                  onClick={() => void sendMessage()}
                >
                  <ArrowUp size={18} />
                  보내기
                </button>
              </div>
            </div>

            <p className="privacy-copy">
              <LockKeyhole size={13} />
              사진을 올릴 땐 민감한 개인정보를 가려주세요.
            </p>
          </section>

          <aside className="context-panel">
            <PlanSnapshotCard
              plan={plan}
              stockResearchRequest={stockResearchRequest}
              onUseDraft={(message) => {
                setDraft(message)
                requestAnimationFrame(() =>
                  composerTextAreaReference.current?.focus(),
                )
              }}
            />
            <ProfileCard
              profile={profile}
              completed={completedProfileFields}
              onEdit={setEditingProfileField}
            />
            <MonthlyHistoryCard
              summaries={monthlySpending}
              onUpdate={updateMonthlySpendingSummary}
              onMarkReviewed={markMonthlySpendingReviewed}
              onRequestClarification={startMonthlySpendingClarification}
              onDelete={(summaryId) =>
                setMonthlySpending((currentSummaries) =>
                  currentSummaries.filter(
                    (summary) => summary.id !== summaryId,
                  ),
                )
              }
            />
          </aside>
        </section>

        <PlanSection
          plan={plan}
          stockResearchRequest={stockResearchRequest}
          onUseDraft={(message) => {
            setDraft(message)
            requestAnimationFrame(() =>
              composerTextAreaReference.current?.focus(),
            )
          }}
        />
      </main>

      {isSalaryCalculatorOpen && (
        <NetSalaryCalculator
          onClose={closeSalaryCalculator}
          onApply={(monthlyNetSalary) => {
            setProfile((currentProfile) => ({
              ...currentProfile,
              monthlySalary: monthlyNetSalary,
            }))
            setLatestRecommendedAction(null)
            setLatestSecondaryRecommendedActions([])
            setMessages((currentMessages) => [
              ...currentMessages,
              {
                id: crypto.randomUUID(),
                role: 'user',
                content: `월 실수령액 ${formatWon(monthlyNetSalary)}`,
                createdAt: new Date().toISOString(),
                status: 'sent',
                attachments: [],
              },
              {
                id: crypto.randomUUID(),
                role: 'agent',
                content: `계산한 예상 월 실수령액 ${formatWon(monthlyNetSalary)}을 내 정보에 반영했어요.`,
                createdAt: new Date().toISOString(),
                status: 'sent',
                attachments: [],
              },
            ])
            closeSalaryCalculator()
          }}
        />
      )}

      {editingProfileField && (
        <ProfileEditModal
          field={editingProfileField}
          profile={profile}
          onClose={() => setEditingProfileField(null)}
          onSave={(patch) => {
            setProfile((currentProfile) => ({ ...currentProfile, ...patch }))
            setEditingProfileField(null)
          }}
        />
      )}

      <footer>
        <div className="brand footer-brand">
          <span className="brand-symbol">S</span>
          <span>SKale</span>
        </div>
        <p>내 상황에 맞게 월급을 나눠보세요.</p>
        <span>본 자료의 정보는 참고용이며, 투자에 대한 책임은 본인에게 있습니다.</span>
      </footer>
    </div>
  )
}

function NextActionPanel({
  action,
  aiSecondaryActions,
  profile,
  hasSpendingHistory,
  completedActionIntents,
  plan,
  stockResearchRequest,
  targetMonth,
  onOpenSalaryCalculator,
  onUseDraft,
}: {
  action: NextAction
  aiSecondaryActions: SecondaryNextAction[]
  profile: FinancialProfile
  hasSpendingHistory: boolean
  completedActionIntents: ConversationActionIntent[]
  plan: PaydayPlan | null
  stockResearchRequest: string
  targetMonth: string | undefined
  onOpenSalaryCalculator: () => void
  onUseDraft: (message: string) => void
}): ReactNode {
  const secondaryActions = createSecondaryNextActions({
    targetMonth,
    profile,
    hasSpendingHistory,
    completedActionIntents,
    plan,
    stockResearchRequest,
    primaryDraft: action.draft,
    primaryText: `${action.title} ${action.primaryLabel}`,
    aiSecondaryActions,
  })

  function runPrimaryAction(): void {
    if (action.kind === 'salary') {
      onOpenSalaryCalculator()
      return
    }
    if (action.kind === 'plan') {
      document.getElementById('payday-plan')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
      return
    }
    if (action.draft) {
      onUseDraft(action.draft)
    }
  }

  return (
    <div className="message-row agent next-action-row">
      <span className="message-avatar">
        <Bot size={16} />
      </span>
      <div className="next-action-panel" aria-label="지금 할 일">
        <div className="next-action-copy">
          <span>지금 할 일</span>
          <h2>{action.title}</h2>
          <p>{action.description}</p>
        </div>
        <div className="next-action-buttons">
          <button className="primary-next-action" type="button" onClick={runPrimaryAction}>
            {action.kind === 'salary' ? <Calculator size={16} /> : <ArrowUp size={16} />}
            {action.primaryLabel}
          </button>
          {secondaryActions.map((item) => (
            <button
              className="secondary-next-action"
              type="button"
              key={item.label}
              onClick={() => onUseDraft(item.message)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function createSecondaryNextActions({
  targetMonth,
  profile,
  hasSpendingHistory,
  completedActionIntents,
  plan,
  stockResearchRequest,
  primaryDraft,
  primaryText,
  aiSecondaryActions,
}: {
  targetMonth: string | undefined
  profile: FinancialProfile
  hasSpendingHistory: boolean
  completedActionIntents: ConversationActionIntent[]
  plan: PaydayPlan | null
  stockResearchRequest: string
  primaryDraft: string | undefined
  primaryText: string
  aiSecondaryActions: SecondaryNextAction[]
}): SecondaryNextAction[] {
  const monthLabel = targetMonth
    ? `${Number(targetMonth.split('-')[1])}월`
    : '사용내역'
  const hasInvestmentRoom = plan !== null && plan.availableInvestmentAmount > 0
  const shouldStartWithSpending = hasOnlyMonthlySalary(profile)
  const canSuggestInvestment = canPrioritizeInvestment(profile, hasSpendingHistory)
  const needsEmergencyFund =
    plan !== null &&
    plan.input.currentEmergencyFund < plan.input.targetEmergencyFund
  const hasCustomUses = plan !== null && plan.input.customUses.length > 0

  const spendingAction: SecondaryNextAction = {
    label: `${monthLabel} 분포`,
    message: targetMonth
      ? `${Number(targetMonth.split('-')[1])}월 카드 내역을 카테고리별 지출 분포로 분석해 주세요.`
      : '카드 내역을 보고 자료 월을 먼저 판단한 뒤 카테고리별 지출 분포로 분석해 주세요.',
    icon: <CalendarDays size={15} />,
  }
  const fixedCostAction: SecondaryNextAction = {
    label: '고정비 점검',
    message:
      '이번 월급 계획에서 줄이기 어려운 고정비와 조정 가능한 지출을 나눠서 개선안을 제안해 주세요.',
    icon: <FileText size={15} />,
  }
  const detailAction: SecondaryNextAction = hasCustomUses
    ? {
        label: '사용처 보완',
        message:
          '저장된 세부 사용처를 기준으로 누락되었거나 금액이 과한 항목을 찾아 보완안을 제안해 주세요.',
        icon: <WalletCards size={15} />,
      }
    : {
        label: '세부 계획',
        message:
          '이번 월급 계획의 각 범주별로 실제 어디에 얼마를 쓸지 세부 계획을 같이 세워 주세요.',
        icon: <WalletCards size={15} />,
      }
  const investmentAction: SecondaryNextAction = hasInvestmentRoom && canSuggestInvestment
    ? {
        label: '투자 후보',
        message: stockResearchRequest,
        icon: <TrendingUp size={15} />,
      }
    : {
        label: '투자 여력',
        message:
          '이번 월급 계획에서 장기 투자금을 만들려면 어떤 항목을 조정해야 하는지 우선순위로 제안해 주세요.',
        icon: <TrendingUp size={15} />,
      }
  const emergencyOrPortfolioAction: SecondaryNextAction = needsEmergencyFund
    ? {
        label: '비상금 점검',
        message:
          '현재 비상금과 목표 비상금을 기준으로 이번 달 비상금, 생활비, 투자금의 우선순위를 다시 점검해 주세요.',
        icon: <PiggyBank size={15} />,
      }
    : {
        label: '포트폴리오',
        message:
          '이번 달 투자 가능 금액으로 ETF 중심 포트폴리오 초안을 만들어 주세요. 현재가와 최신 데이터는 출처가 있을 때만 사용해 주세요.',
        icon: <TrendingUp size={15} />,
      }
  const preferenceAction: SecondaryNextAction = {
    label: '취향 반영',
    message:
      '외식과 여행은 지키면서 다른 지출에서 균형을 맞추는 월급 조정안을 제안해 주세요.',
    icon: <MessageCircleMore size={15} />,
  }

  if (profile.monthlySalary === null) {
    return [
      spendingAction,
      {
        label: '고정비 정리',
        message:
          '월세, 보험료, 통신비처럼 매달 고정적으로 나가는 비용을 정리해 주세요.',
        icon: <FileText size={15} />,
      },
      {
        label: '비상금 점검',
        message:
          '현재 비상금과 카드값, 대출 여부를 기준으로 월급 계획 전에 챙길 정보를 정리해 주세요.',
        icon: <PiggyBank size={15} />,
      },
    ]
  }

  const candidates: SecondaryNextAction[] = shouldStartWithSpending
    ? [
        spendingAction,
        fixedCostAction,
        detailAction,
        emergencyOrPortfolioAction,
        preferenceAction,
      ]
    : canSuggestInvestment && hasInvestmentRoom
      ? [
          investmentAction,
          emergencyOrPortfolioAction,
          spendingAction,
          detailAction,
          fixedCostAction,
          preferenceAction,
        ]
      : [
          emergencyOrPortfolioAction,
          spendingAction,
          detailAction,
          fixedCostAction,
          preferenceAction,
        ]

  const localSecondaryActions = uniqueNextActions(
    candidates,
    primaryDraft,
    primaryText,
    completedActionIntents,
  )

  return uniqueSecondaryActionMessages([
    ...aiSecondaryActions,
    ...localSecondaryActions,
  ]).slice(0, 3)
}

function uniqueNextActions(
  actions: SecondaryNextAction[],
  excludedMessage: string | undefined,
  primaryText: string,
  completedActionIntents: ConversationActionIntent[],
): SecondaryNextAction[] {
  const seen = new Set<string>()
  return actions.filter((action) => {
    if (
      action.message === excludedMessage ||
      seen.has(action.message) ||
      isSimilarNextAction(action, primaryText) ||
      isCompletedActionMessage(action.message, completedActionIntents)
    ) {
      return false
    }
    seen.add(action.message)
    return true
  })
}

function uniqueSecondaryActionMessages(
  actions: SecondaryNextAction[],
): SecondaryNextAction[] {
  const seen = new Set<string>()
  return actions.filter((action) => {
    if (seen.has(action.message)) {
      return false
    }
    seen.add(action.message)
    return true
  })
}

function isSimilarNextAction(action: SecondaryNextAction, primaryText: string): boolean {
  const groups = [
    ['투자', '종목', '포트폴리오'],
    ['비상금', '카드값', '부채'],
    ['사용내역', '지출', '분포'],
    ['세부', '사용처'],
  ]

  return groups.some((group) => {
    const primaryHasGroup = group.some((keyword) => primaryText.includes(keyword))
    const actionHasGroup = group.some((keyword) =>
      `${action.label} ${action.message}`.includes(keyword),
    )
    return primaryHasGroup && actionHasGroup
  })
}

function MessageBubble({
  message,
}: {
  message: ConversationMessage
}): ReactNode {
  const renderedContent =
    message.role === 'agent'
      ? renderAgentMessageContent(message.content)
      : message.content

  return (
    <div className={`message-row ${message.role}`}>
      <span className="message-avatar">
        {message.role === 'agent' ? <Bot size={16} /> : <UserRound size={16} />}
      </span>
      <div>
        {message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((attachment) =>
              attachment.previewUrl ? (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  key={attachment.id}
                />
              ) : (
                <span key={attachment.id}>
                  <Paperclip size={13} />
                  {attachment.name}
                </span>
              ),
            )}
          </div>
        )}
        <div className="message-bubble">{renderedContent}</div>
        {message.status === 'failed' && (
          <small className="failed-message">전송 결과를 받지 못했어요.</small>
        )}
      </div>
    </div>
  )
}

function ProposalCards({
  response,
  onApplyProfile,
  onApplyMonthlySpending,
  onStartMonthlySpendingReview,
}: {
  response: PaydayConversationResponse
  onApplyProfile: () => void
  onApplyMonthlySpending: (isReviewed?: boolean) => void
  onStartMonthlySpendingReview: (
    summary: Omit<MonthlySpendingSummary, 'id'>,
  ) => void
}): ReactNode {
  const profileEntries = getProfilePatchEntries(response.profilePatch)
  const customUses = response.profilePatch.customUses
  const spendingProposal = response.monthlySpendingProposal
  const isEmptySpendingProposal =
    spendingProposal !== undefined &&
    !hasReadableMonthlySpendingAmount(spendingProposal)

  if (
    profileEntries.length === 0 &&
    customUses === undefined &&
    !spendingProposal
  ) {
    return null
  }

  return (
    <div className="proposal-stack">
      {(profileEntries.length > 0 || customUses !== undefined) && (
        <article className="agent-proposal">
          <div className="proposal-heading">
            <span>
              <Sparkles size={15} />
              프로필 반영 제안
            </span>
            <button type="button" onClick={onApplyProfile}>
              <Check size={14} />
              적용
            </button>
          </div>
          <ul>
            {profileEntries.map(([label, value]) => (
              <li key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
          {customUses !== undefined && (
            <div className="custom-use-proposal">
              <strong>매달 먼저 나눠둘 사용처</strong>
              {customUses.length > 0 ? (
                <div>
                  {customUses.map((use) => (
                    <article key={`${use.bucket}-${use.name}`}>
                      <span>
                        <b>{use.name}</b>
                        <small>{formatCustomUseBucket(use.bucket)}</small>
                      </span>
                      <strong>{formatWon(use.amount)}</strong>
                      {use.note && <p>{use.note}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p>등록된 사용처를 모두 비우는 제안이에요.</p>
              )}
            </div>
          )}
        </article>
      )}

      {spendingProposal && (
        <article
          className={`agent-proposal spending-proposal${isEmptySpendingProposal ? ' empty-spending-proposal' : ''}`}
        >
          <div className="proposal-heading">
            <span>
              <CalendarDays size={15} />
              {formatMonth(spendingProposal.month)} 사용 요약
            </span>
            {!isEmptySpendingProposal && !spendingProposal.needReview && (
              <button type="button" onClick={() => onApplyMonthlySpending()}>
                <Check size={14} />
                기록 추가
              </button>
            )}
          </div>
          {!isEmptySpendingProposal && (
            <div className="spending-proposal-grid">
              <SummaryValue
                label="총소비"
                value={formatNullableWon(spendingProposal.totalExpense)}
              />
              <SummaryValue
                label="필수지출"
                value={formatNullableWon(spendingProposal.essentialExpense)}
              />
              <SummaryValue
                label="선택지출"
                value={formatNullableWon(spendingProposal.flexibleExpense)}
              />
            </div>
          )}
          <p>{spendingProposal.insight}</p>
          {spendingProposal.categoryBreakdown.length > 0 && (
            <CategoryBreakdownList
              breakdown={spendingProposal.categoryBreakdown}
              totalExpense={spendingProposal.totalExpense}
            />
          )}
          {spendingProposal.notableCategories.length > 0 && (
            <div className="proposal-tags">
              {spendingProposal.notableCategories.map((category) => (
                <span key={category}>{category}</span>
              ))}
            </div>
          )}
          {isEmptySpendingProposal && (
            <div className="proposal-review-assist">
              <div>
                <CircleAlert size={14} />
                <span>확인할 사용내역이 없어 금액을 기록할 수 없습니다.</span>
              </div>
              <button
                type="button"
                onClick={() => onStartMonthlySpendingReview(spendingProposal)}
              >
                <MessageCircleMore size={13} />
                자료 다시 보내기
              </button>
            </div>
          )}
          {spendingProposal.needReview && !isEmptySpendingProposal && (
            <div className="proposal-review-assist">
              <div>
                <CircleAlert size={14} />
                <span>읽은 금액이 맞는지만 확인해 주세요.</span>
              </div>
              <button type="button" onClick={() => onApplyMonthlySpending(true)}>
                <Check size={13} />
                맞아요
              </button>
              <button
                type="button"
                onClick={() => onStartMonthlySpendingReview(spendingProposal)}
              >
                <MessageCircleMore size={13} />
                고쳐서 보내기
              </button>
            </div>
          )}
        </article>
      )}
    </div>
  )
}

function renderAgentMessageContent(content: string): ReactNode {
  const table = parseMarkdownTable(content)
  if (!table) {
    return <p>{renderInlineMarkdown(content)}</p>
  }

  return (
    <>
      {table.before && <p>{renderInlineMarkdown(table.before)}</p>}
      <div className="message-table-cards">
        {table.rows.map((row, rowIndex) => (
          <article key={`${row[0] ?? 'row'}-${rowIndex}`}>
            {table.headers.map((header, headerIndex) => (
              <div key={`${header}-${headerIndex}`}>
                <span>{stripInlineMarkdown(header)}</span>
                <strong>{stripInlineMarkdown(row[headerIndex] || '-')}</strong>
              </div>
            ))}
          </article>
        ))}
      </div>
      {table.after && <p>{renderInlineMarkdown(table.after)}</p>}
    </>
  )
}

function renderInlineMarkdown(content: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const emphasisPattern = /\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = emphasisPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index))
    }
    nodes.push(
      <strong key={`strong-${match.index}`}>
        {match[1]}
      </strong>,
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex))
  }

  return nodes
}

function stripInlineMarkdown(content: string): string {
  return content.replace(/\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/g, '$1')
}

function parseMarkdownTable(content: string): {
  before: string
  after: string
  headers: string[]
  rows: string[][]
} | null {
  const lines = content.split('\n')
  const separatorIndex = lines.findIndex((line, index) => {
    if (index === 0 || !isMarkdownTableSeparator(line)) {
      return false
    }
    return splitMarkdownTableRow(lines[index - 1]).length >= 2
  })

  if (separatorIndex <= 0) {
    return null
  }

  const headers = splitMarkdownTableRow(lines[separatorIndex - 1])
  const rowLines: string[] = []
  for (let index = separatorIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (splitMarkdownTableRow(line).length !== headers.length) {
      break
    }
    rowLines.push(line)
  }

  if (rowLines.length === 0) {
    return null
  }

  const before = lines.slice(0, separatorIndex - 1).join('\n').trim()
  const after = lines.slice(separatorIndex + 1 + rowLines.length).join('\n').trim()
  return {
    before,
    after,
    headers,
    rows: rowLines.map(splitMarkdownTableRow),
  }
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmedLine = line.trim()
  if (!trimmedLine.includes('|')) {
    return []
  }

  return trimmedLine
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function ProfileCard({
  profile,
  completed,
  onEdit,
}: {
  profile: FinancialProfile
  completed: number
  onEdit: (field: EditableProfileField) => void
}): ReactNode {
  const estimatedInput = toPaydayInput(profile)
  const items = getFinancialProfileItems(profile, estimatedInput)
  const progressPercent = Math.round((completed / PROFILE_FIELD_COUNT) * 100)

  return (
    <section className="context-card profile-card">
      <div className="context-heading">
        <div>
          <span>내 정보</span>
          <h2>지금까지 입력한 내용</h2>
        </div>
        <strong>{progressPercent}%</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="profile-next-summary">
        <span>{profile.monthlySalary === null ? '입력 현황' : '월급 기준 준비'}</span>
        <strong>
          {profile.monthlySalary === null
            ? '월급만 알려주세요'
            : '추천 금액을 채워뒀어요'}
        </strong>
        <p>
          {profile.monthlySalary === null
            ? '월급을 입력하면 쓸 돈, 모을 돈, 투자할 돈을 먼저 나눠볼 수 있어요.'
            : '생활비, 목표, 투자 조건은 여기서 바로 수정할 수 있어요.'}
        </p>
      </div>
      <div className="profile-check-list">
        {items.map((item) => (
          <div
            className={
              item.isComplete
                ? item.isDefault
                  ? 'complete defaulted'
                  : 'complete'
                : 'missing'
            }
            key={item.label}
          >
            <i aria-hidden="true" />
            <span>{item.label}</span>
            <strong aria-label={item.isComplete ? undefined : '미입력'}>
              {item.isComplete ? item.value : ''}
            </strong>
            <button
              className="profile-edit-button"
              type="button"
              aria-label={`${item.label} 수정`}
              onClick={() => onEdit(item.field)}
            >
              <SquarePen size={14} />
            </button>
          </div>
        ))}
      </div>
      {profile.preferences.length > 0 && (
        <div className="preference-section">
          <span>지키고 싶은 취향</span>
          <div>
            {profile.preferences.map((preference) => (
              <i key={preference}>{preference}</i>
            ))}
          </div>
        </div>
      )}
      {profile.customUses.length > 0 && (
        <div className="profile-custom-uses">
          <div>
            <span>매달 먼저 나눠둘 사용처</span>
            <small>필요하면 위 항목에서 바로 수정할 수 있어요.</small>
          </div>
          <ul>
            {profile.customUses.map((use) => (
              <li key={`${use.bucket}-${use.name}`}>
                <span>
                  <strong>{use.name}</strong>
                  <small>{formatCustomUseBucket(use.bucket)}</small>
                </span>
                <b>{formatWon(use.amount)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ProfileEditModal({
  field,
  profile,
  onClose,
  onSave,
}: {
  field: EditableProfileField
  profile: FinancialProfile
  onClose: () => void
  onSave: (patch: Partial<FinancialProfile>) => void
}): ReactNode {
  const isInvestmentField =
    field === 'riskProfile' || field === 'investmentHorizon'
  const [moneyValue, setMoneyValue] = useState(() =>
    typeof profile[field] === 'number' ? String(profile[field]) : '',
  )
  const [textValue, setTextValue] = useState(() =>
    typeof profile[field] === 'string' ? String(profile[field]) : '',
  )
  const [riskProfile, setRiskProfile] = useState<RiskProfile>(
    profile.riskProfile ?? '균형형',
  )
  const [investmentHorizon, setInvestmentHorizon] = useState<
    FinancialProfile['investmentHorizon']
  >(profile.investmentHorizon ?? '3년 이상')
  const config = getProfileEditConfig(field)

  function save(): void {
    if (isInvestmentField) {
      onSave({ riskProfile, investmentHorizon })
      return
    }
    if (field === 'goalName') {
      onSave({ goalName: textValue.trim() })
      return
    }
    onSave({ [field]: moneyValue.trim() ? parseMoney(moneyValue) : null })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="profile-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-edit-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>직접 입력</span>
            <h2 id="profile-edit-title">{config.title}</h2>
            <p>{config.description}</p>
          </div>
          <button type="button" aria-label="수정 닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {isInvestmentField ? (
          <div className="profile-edit-body">
            <label>
              투자 성향
              <select
                value={riskProfile}
                onChange={(event) =>
                  setRiskProfile(event.target.value as RiskProfile)
                }
              >
                <option value="안정형">안정형</option>
                <option value="균형형">균형형</option>
                <option value="공격형">공격형</option>
              </select>
            </label>
            <label>
              투자 기간
              <select
                value={investmentHorizon ?? '3년 이상'}
                onChange={(event) =>
                  setInvestmentHorizon(
                    event.target.value as NonNullable<
                      FinancialProfile['investmentHorizon']
                    >,
                  )
                }
              >
                <option value="1년 미만">1년 미만</option>
                <option value="1~3년">1~3년</option>
                <option value="3년 이상">3년 이상</option>
              </select>
            </label>
          </div>
        ) : field === 'goalName' ? (
          <div className="profile-edit-body">
            <label>
              목표 이름
              <input
                value={textValue}
                placeholder="예: 여행 자금"
                onChange={(event) => setTextValue(event.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="profile-edit-body">
            <label>
              금액
              <div className="profile-money-input">
                <input
                  inputMode="numeric"
                  value={moneyValue ? Number(moneyValue).toLocaleString() : ''}
                  placeholder="0"
                  onChange={(event) =>
                    setMoneyValue(
                      event.target.value.trim()
                        ? String(parseMoney(event.target.value))
                        : '',
                    )
                  }
                />
                <span>원</span>
              </div>
            </label>
          </div>
        )}

        <div className="profile-edit-footer">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="button" onClick={save}>
            <Check size={15} />
            저장
          </button>
        </div>
      </section>
    </div>
  )
}

function MonthlyHistoryCard({
  summaries,
  onUpdate,
  onMarkReviewed,
  onRequestClarification,
  onDelete,
}: {
  summaries: MonthlySpendingSummary[]
  onUpdate: (
    summaryId: string,
    patch: Partial<MonthlySpendingSummary>,
  ) => void
  onMarkReviewed: (summaryId: string) => void
  onRequestClarification: (summary: MonthlySpendingSummary) => void
  onDelete: (summaryId: string) => void
}): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const sortedSummaries = useMemo(
    () =>
      [...summaries].sort((left, right) =>
        right.month.localeCompare(left.month),
      ),
    [summaries],
  )
  const safeSelectedIndex = Math.min(
    selectedIndex,
    Math.max(sortedSummaries.length - 1, 0),
  )
  const selectedSummary = sortedSummaries[safeSelectedIndex]
  const spendingTrend = createSpendingTrend(sortedSummaries)

  return (
    <section className="context-card history-card">
      <div className="context-heading">
        <div>
          <span>월별 소비</span>
          <h2>지난 사용 내역</h2>
        </div>
        <strong>{summaries.length}개월</strong>
      </div>
      {selectedSummary ? (
        <div className="history-carousel">
          <div className="history-navigation">
            <button
              type="button"
              aria-label="더 최근 월 보기"
              disabled={safeSelectedIndex === 0}
              onClick={() =>
                setSelectedIndex((currentIndex) =>
                  Math.max(currentIndex - 1, 0),
                )
              }
            >
              <ChevronLeft size={16} />
            </button>
            <div>
              <strong>{formatMonth(selectedSummary.month)}</strong>
              <span>
                {safeSelectedIndex + 1} / {sortedSummaries.length}
              </span>
            </div>
            <button
              type="button"
              aria-label="더 이전 월 보기"
              disabled={
                safeSelectedIndex === sortedSummaries.length - 1
              }
              onClick={() =>
                setSelectedIndex((currentIndex) =>
                  Math.min(
                    currentIndex + 1,
                    sortedSummaries.length - 1,
                  ),
                )
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <article className="history-slide">
            <div className="history-amounts">
              <SummaryValue
                label="총소비"
                value={formatNullableWon(selectedSummary.totalExpense)}
              />
              <SummaryValue
                label="필수지출"
                value={formatNullableWon(
                  selectedSummary.essentialExpense,
                )}
              />
              <SummaryValue
                label="선택지출"
                value={formatNullableWon(
                  selectedSummary.flexibleExpense,
                )}
              />
            </div>
            {spendingTrend.length >= 2 && (
              <SpendingTrendChart summaries={spendingTrend} />
            )}
            <p>{selectedSummary.insight}</p>
            {selectedSummary.categoryBreakdown.length > 0 && (
              <CategoryBreakdownList
                breakdown={selectedSummary.categoryBreakdown}
                totalExpense={selectedSummary.totalExpense}
              />
            )}
            {selectedSummary.notableCategories.length > 0 && (
              <div className="history-categories">
                {selectedSummary.notableCategories.map((category) => (
                  <span key={category}>{category}</span>
                ))}
              </div>
            )}
            {selectedSummary.needReview && (
              <div className="history-review-panel">
                <div className="history-review-heading">
                  <CircleAlert size={15} />
                  <div>
                    <strong>읽은 금액을 확인해 주세요</strong>
                    <p>맞으면 완료하고, 다르면 금액을 바로 고치거나 이어서 물어볼 수 있어요.</p>
                  </div>
                </div>
                <div className="history-review-fields">
                  <MoneyReviewField
                    label="총소비"
                    value={selectedSummary.totalExpense}
                    onChange={(totalExpense) =>
                      onUpdate(selectedSummary.id, { totalExpense })
                    }
                  />
                  <MoneyReviewField
                    label="필수지출"
                    value={selectedSummary.essentialExpense}
                    onChange={(essentialExpense) =>
                      onUpdate(selectedSummary.id, { essentialExpense })
                    }
                  />
                  <MoneyReviewField
                    label="선택지출"
                    value={selectedSummary.flexibleExpense}
                    onChange={(flexibleExpense) =>
                      onUpdate(selectedSummary.id, { flexibleExpense })
                    }
                  />
                </div>
                <div className="history-review-actions">
                  <button
                    type="button"
                    onClick={() => onMarkReviewed(selectedSummary.id)}
                  >
                    <Check size={14} />
                    맞아요
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestClarification(selectedSummary)}
                  >
                    <MessageCircleMore size={14} />
                    고쳐서 보내기
                  </button>
                </div>
              </div>
            )}
            <div className="history-meta">
              {selectedSummary.needReview && <span>확인 필요</span>}
              <button
                type="button"
                aria-label={`${formatMonth(selectedSummary.month)} 기록 삭제`}
                onClick={() => {
                  onDelete(selectedSummary.id)
                  setSelectedIndex((currentIndex) =>
                    Math.max(currentIndex - 1, 0),
                  )
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        </div>
      ) : (
        <div className="history-empty">
          <ImagePlus size={23} />
          <strong>아직 불러온 내역이 없어요</strong>
          <p>확인할 달을 고르고 카드 내역 사진이나 텍스트를 보내주세요.</p>
        </div>
      )}
    </section>
  )
}

function MoneyReviewField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}): ReactNode {
  return (
    <label>
      <span>{label}</span>
      <div>
        <input
          inputMode="numeric"
          value={value === null ? '' : value.toLocaleString()}
          placeholder="모름"
          onChange={(event) => {
            const normalizedValue = event.target.value.trim()
            onChange(normalizedValue ? parseMoney(normalizedValue) : null)
          }}
        />
        <small>원</small>
      </div>
    </label>
  )
}

function NetSalaryCalculator({
  onClose,
  onApply,
}: {
  onClose: () => void
  onApply: (monthlyNetSalary: number) => void
}): ReactNode {
  const [inputMethod, setInputMethod] = useState<'direct' | 'estimate'>(
    'direct',
  )
  const [directMonthlySalary, setDirectMonthlySalary] = useState(3_200_000)
  const [input, setInput] = useState<NetSalaryInput>({
    salaryUnit: 'annual',
    salaryAmount: 40_000_000,
    severanceIncluded: false,
    dependents: 1,
    childrenUnderTwenty: 0,
    monthlyNonTaxableAmount: 200_000,
  })
  const estimate = useMemo(() => estimateNetSalary(input), [input])
  const amountToApply =
    inputMethod === 'direct'
      ? directMonthlySalary
      : estimate.monthlyNetSalary

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="salary-calculator-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="salary-calculator-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>월급 입력</span>
            <h2 id="salary-calculator-title">실수령액을 알려주세요</h2>
            <p>알고 있는 금액을 바로 입력하거나 연봉으로 계산할 수 있어요.</p>
          </div>
          <button type="button" aria-label="계산기 닫기" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className="salary-method-tabs">
          <button
            className={inputMethod === 'direct' ? 'selected' : ''}
            type="button"
            onClick={() => setInputMethod('direct')}
          >
            실수령액 직접 입력
          </button>
          <button
            className={inputMethod === 'estimate' ? 'selected' : ''}
            type="button"
            onClick={() => setInputMethod('estimate')}
          >
            연봉으로 계산
          </button>
        </div>

        {inputMethod === 'direct' ? (
          <div className="direct-salary-panel">
            <MoneyCalculatorField
              label="한 달 실수령액"
              value={directMonthlySalary}
              onChange={setDirectMonthlySalary}
            />
            <p>
              급여명세서나 통장에 들어온 금액을 적어주세요. 이 금액을 기준으로
              월급 계획을 만들어요.
            </p>
          </div>
        ) : (
          <div className="salary-calculator-layout">
            <div className="salary-input-panel">
            <div className="salary-unit-control">
              {(['annual', 'monthly'] as SalaryUnit[]).map((unit) => (
                <button
                  className={input.salaryUnit === unit ? 'selected' : ''}
                  type="button"
                  key={unit}
                  onClick={() => setInput({ ...input, salaryUnit: unit })}
                >
                  {unit === 'annual' ? '연봉' : '월급'}
                </button>
              ))}
            </div>

            {input.salaryUnit === 'annual' && (
              <label className="calculator-field">
                퇴직금
                <div className="salary-unit-control compact">
                  <button
                    className={!input.severanceIncluded ? 'selected' : ''}
                    type="button"
                    onClick={() =>
                      setInput({ ...input, severanceIncluded: false })
                    }
                  >
                    별도
                  </button>
                  <button
                    className={input.severanceIncluded ? 'selected' : ''}
                    type="button"
                    onClick={() =>
                      setInput({ ...input, severanceIncluded: true })
                    }
                  >
                    포함
                  </button>
                </div>
              </label>
            )}

            <MoneyCalculatorField
              label={input.salaryUnit === 'annual' ? '연봉' : '월 급여액'}
              value={input.salaryAmount}
              onChange={(salaryAmount) =>
                setInput({ ...input, salaryAmount })
              }
            />

            <div className="amount-shortcuts">
              {[10_000_000, 1_000_000, 100_000].map((amount) => (
                <button
                  type="button"
                  key={amount}
                  onClick={() =>
                    setInput({
                      ...input,
                      salaryAmount: input.salaryAmount + amount,
                    })
                  }
                >
                  +{amount / 10_000}만
                </button>
              ))}
            </div>

            <div className="people-fields">
              <CountField
                label="부양 가족 수 (본인 포함)"
                value={input.dependents}
                minimum={1}
                onChange={(dependents) =>
                  setInput({
                    ...input,
                    dependents,
                    childrenUnderTwenty: Math.min(
                      input.childrenUnderTwenty,
                      dependents - 1,
                    ),
                  })
                }
              />
              <CountField
                label="20세 이하 자녀 수"
                value={input.childrenUnderTwenty}
                minimum={0}
                maximum={Math.max(input.dependents - 1, 0)}
                onChange={(childrenUnderTwenty) =>
                  setInput({ ...input, childrenUnderTwenty })
                }
              />
            </div>

            <MoneyCalculatorField
              label="월 비과세액"
              value={input.monthlyNonTaxableAmount}
              onChange={(monthlyNonTaxableAmount) =>
                setInput({ ...input, monthlyNonTaxableAmount })
              }
            />
            </div>

            <SalaryEstimatePanel estimate={estimate} />
          </div>
        )}

        <div className="calculator-footer">
          <p>
            {inputMethod === 'direct'
              ? '나중에 월급이 바뀌면 이 화면에서 다시 수정할 수 있어요.'
              : '예상 금액이에요. 실제 급여명세서와 다를 수 있어요.'}
          </p>
          <button
            type="button"
            disabled={amountToApply <= 0}
            onClick={() => onApply(amountToApply)}
          >
            <Check size={16} />
            {formatWon(amountToApply)} 입력하기
          </button>
        </div>
      </section>
    </div>
  )
}

function SalaryEstimatePanel({
  estimate,
}: {
  estimate: NetSalaryEstimate
}): ReactNode {
  const deductions = [
    ['국민연금', estimate.deductions.nationalPension],
    ['건강보험', estimate.deductions.healthInsurance],
    ['장기요양', estimate.deductions.longTermCareInsurance],
    ['고용보험', estimate.deductions.employmentInsurance],
    ['소득세', estimate.deductions.incomeTax],
    ['지방소득세', estimate.deductions.localIncomeTax],
  ] as const

  return (
    <aside className="salary-result-panel">
      <span>예상 월 실수령액</span>
      <strong>{formatWon(estimate.monthlyNetSalary)}</strong>
      <small>월 급여 {formatWon(estimate.monthlyGrossSalary)} 기준</small>
      <div>
        {deductions.map(([label, amount]) => (
          <p key={label}>
            <span>{label}</span>
            <b>{formatWon(amount)}</b>
          </p>
        ))}
        <p className="deduction-total">
          <span>공제액 합계</span>
          <b>{formatWon(estimate.totalDeductions)}</b>
        </p>
      </div>
    </aside>
  )
}

function MoneyCalculatorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <label className="calculator-field">
      {label}
      <div className="calculator-money-input">
        <input
          inputMode="numeric"
          value={value === 0 ? '' : Math.round(value).toLocaleString()}
          placeholder="0"
          onChange={(event) => onChange(parseMoney(event.target.value))}
        />
        <span>원</span>
      </div>
    </label>
  )
}

function CountField({
  label,
  value,
  minimum,
  maximum = 10,
  onChange,
}: {
  label: string
  value: number
  minimum: number
  maximum?: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <div className="count-field">
      <span>{label}</span>
      <div>
        <button
          type="button"
          disabled={value <= minimum}
          onClick={() => onChange(Math.max(value - 1, minimum))}
        >
          <Minus size={15} />
        </button>
        <strong>{value}</strong>
        <button
          type="button"
          disabled={value >= maximum}
          onClick={() => onChange(Math.min(value + 1, maximum))}
        >
          <Plus size={15} />
        </button>
        <small>명</small>
      </div>
    </div>
  )
}

function PlanSnapshotCard({
  plan,
  stockResearchRequest,
  onUseDraft,
}: {
  plan: PaydayPlan | null
  stockResearchRequest: string
  onUseDraft: (message: string) => void
}): ReactNode {
  const visibleAllocations =
    plan?.allocations
      .filter((allocation) => allocation.amount > 0)
      .slice(0, 5) ?? []

  return (
    <section className="context-card plan-snapshot-card" aria-label="이번 월급 배분 요약">
      <div className="context-heading">
        <div>
          <span>PAYDAY PLAN</span>
          <h2>입력한 내용으로 월급을 나눠드려요</h2>
        </div>
        {plan && <strong>{formatWon(plan.availableInvestmentAmount)}</strong>}
      </div>

      {plan ? (
        <>
          <div className="plan-snapshot-hero">
            <span>{plan.safetyStatus}</span>
            <strong>{plan.headline}</strong>
            <small>자동 계산된 투자 가능 금액 {formatWon(plan.availableInvestmentAmount)}</small>
          </div>
          <div className="plan-snapshot-list">
            {visibleAllocations.map((allocation) => (
              <div key={allocation.role}>
                <span>{allocation.label}</span>
                <strong>{formatWon(allocation.amount)}</strong>
              </div>
            ))}
          </div>
          <div className="plan-snapshot-actions">
            <button
              type="button"
              onClick={() =>
                document.getElementById('payday-plan')?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                })
              }
            >
              상세 보기
            </button>
            <button
              type="button"
              onClick={() => onUseDraft(createPlanDetailDraft(plan))}
            >
              세부 계획
            </button>
            {plan.availableInvestmentAmount > 0 && (
              <button
                type="button"
                onClick={() => onUseDraft(stockResearchRequest)}
              >
                후보 보기
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="plan-snapshot-empty">
          <strong>월급 기준을 먼저 잡으면 바로 계산해요.</strong>
          <p>실수령액만 있어도 생활비, 비상금, 목표, 투자금 초안을 볼 수 있어요.</p>
        </div>
      )}
    </section>
  )
}

function PlanSection({
  plan,
  stockResearchRequest,
  onUseDraft,
}: {
  plan: PaydayPlan | null
  stockResearchRequest: string
  onUseDraft: (message: string) => void
}): ReactNode {
  return (
    <section className="plan-section" id="payday-plan">
      <div className="section-heading">
        <div>
          <span>PAYDAY PLAN</span>
          <h2>입력한 내용으로 월급을 나눠드려요</h2>
          <p>월급에서 먼저 나갈 돈을 빼고, 남은 돈을 저축과 투자로 나눠요.</p>
        </div>
      </div>

      {plan ? (
        <div className="plan-card">
          <div className="plan-hero">
            <div>
              <span>{plan.safetyStatus}</span>
              <h3>{plan.headline}</h3>
            </div>
            <div>
              <small>자동 계산된 투자 가능 금액</small>
              <strong>{formatWon(plan.availableInvestmentAmount)}</strong>
            </div>
          </div>
          <div className="plan-content">
            <div className="allocation-summary">
              <AllocationChart allocations={plan.allocations} />
              <div className="allocation-plan-toolbar">
                <button
                  type="button"
                  onClick={() => onUseDraft(createPlanDetailDraft(plan))}
                >
                  세부 계획하기
                </button>
                <span>각 범주의 사용처와 금액을 자동으로 조정해요.</span>
              </div>
              {plan.allocations.map((allocation) => {
                const visibleDetails = getVisibleAllocationDetails(allocation)

                return (
                  <article key={allocation.role}>
                    <span>{String(allocation.priority).padStart(2, '0')}</span>
                    <div>
                      <strong>{allocation.label}</strong>
                      <p>{allocation.reason}</p>
                      {visibleDetails.length > 0 && (
                        <ul className="allocation-detail-list">
                          {visibleDetails.map((detail) => (
                            <li key={`${detail.bucket}-${detail.name}`}>
                              <span>{detail.name}</span>
                              <b>{formatWon(detail.amount)}</b>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <b>{formatWon(allocation.amount)}</b>
                  </article>
                )
              })}
            </div>
            <aside className="portfolio-summary">
              <span>투자금 나누기</span>
              <h3>
                {plan.input.riskProfile} · {plan.input.investmentHorizon}
              </h3>
              {plan.portfolio.length > 0 ? (
                <>
                  <PortfolioDonutChart portfolio={plan.portfolio} />
                  <div className="stock-research-callout">
                    <strong>종목 후보까지 보고 싶다면</strong>
                    <p>
                      이번 달 투자금에 맞춰 ETF와 관심 종목을 비교해 볼게요.
                    </p>
                    <button
                      type="button"
                      onClick={() => onUseDraft(stockResearchRequest)}
                    >
                      <TrendingUp size={15} />
                      후보 보기
                    </button>
                  </div>
                  <div>
                    {plan.portfolio.map((allocation, index) => (
                      <article key={allocation.label}>
                        <i className={`portfolio-color color-${index + 1}`} />
                        <span>{allocation.label}</span>
                        <strong>{allocation.percentage}%</strong>
                        <b>{formatWon(allocation.amount)}</b>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <p>이번 달은 투자보다 비상금을 먼저 채우는 편이 좋아요.</p>
              )}
            </aside>
          </div>
        </div>
      ) : (
        <div className="plan-waiting">
          <span>
            <Sparkles size={22} />
          </span>
          <div>
            <strong>조금만 더 알려주세요</strong>
            <p>
              월급만 알려주시면 생활비, 비상금, 저축, 투자 순서로 먼저 나눠볼게요.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function AllocationChart({
  allocations,
}: {
  allocations: SalaryAllocation[]
}): ReactNode {
  const chartData = allocations
    .filter((allocation) => allocation.amount > 0)
    .map((allocation, index) => ({
      label: allocation.label,
      amount: allocation.amount,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    }))

  if (chartData.length === 0) {
    return null
  }

  return (
    <figure
      className="allocation-chart"
      aria-label="월급 배분 금액 막대그래프"
    >
      <figcaption>
        <span>월급 배분 한눈에 보기</span>
        <strong>큰 항목부터 조정해 보세요</strong>
      </figcaption>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
        >
          <CartesianGrid horizontal={false} stroke="#f0e8e9" />
          <XAxis
            type="number"
            tickFormatter={formatCompactWon}
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <YAxis
            dataKey="label"
            type="category"
            tickLine={false}
            axisLine={false}
            width={82}
            fontSize={11}
          />
          <Tooltip
            cursor={{ fill: '#fff1f4' }}
            formatter={(value) => [formatWon(Number(value)), '금액']}
          />
          <Bar dataKey="amount" radius={[0, 8, 8, 0]} barSize={18}>
            {chartData.map((entry) => (
              <Cell key={entry.label} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}

function PortfolioDonutChart({
  portfolio,
}: {
  portfolio: PortfolioAllocation[]
}): ReactNode {
  const chartData = portfolio.map((allocation, index) => ({
    label: allocation.label,
    percentage: allocation.percentage,
    amount: allocation.amount,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }))

  return (
    <figure className="portfolio-chart" aria-label="투자금 비중 도넛 차트">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="percentage"
            nameKey="label"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={3}
            stroke="none"
          >
            {chartData.map((entry) => (
              <Cell key={entry.label} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => {
              const payload = item.payload as {
                amount?: number
                label?: string
              }
              return [
                `${Number(value).toFixed(0)}% · ${formatWon(payload.amount ?? 0)}`,
                payload.label ?? '비중',
              ]
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <figcaption>
        <span>자산군 비중</span>
        <strong>{portfolio.map((item) => `${item.label} ${item.percentage}%`).join(' · ')}</strong>
      </figcaption>
    </figure>
  )
}

function SpendingTrendChart({
  summaries,
}: {
  summaries: SpendingTrendPoint[]
}): ReactNode {
  return (
    <figure className="spending-trend-chart" aria-label="월별 소비 추이 그래프">
      <figcaption>
        <span>최근 흐름</span>
        <strong>총소비와 지출 성격을 같이 봐요</strong>
      </figcaption>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={summaries} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#f0e8e9" />
          <XAxis
            dataKey="monthLabel"
            tickLine={false}
            axisLine={false}
            fontSize={10}
          />
          <YAxis
            width={42}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactWon}
            fontSize={10}
          />
          <Tooltip
            formatter={(value) => [formatWon(Number(value)), '금액']}
            labelFormatter={(label) => `${label} 사용 내역`}
          />
          <Line
            type="monotone"
            dataKey="totalExpense"
            name="총소비"
            stroke="#ea002c"
            strokeWidth={2.5}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="essentialExpense"
            name="필수지출"
            stroke="#ff7a00"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="flexibleExpense"
            name="선택지출"
            stroke="#8f8083"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  )
}

function Principle({
  icon,
  title,
  text,
}: {
  icon: ReactNode
  title: string
  text: string
}): ReactNode {
  return (
    <article>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </article>
  )
}

function SummaryValue({
  label,
  value,
}: {
  label: string
  value: string
}): ReactNode {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CategoryBreakdownList({
  breakdown,
  totalExpense,
}: {
  breakdown: SpendingCategoryAmount[]
  totalExpense: number | null
}): ReactNode {
  const totalAmount =
    totalExpense ??
    breakdown.reduce((sum, item) => sum + item.amount, 0)

  if (breakdown.length === 0 || totalAmount <= 0) {
    return null
  }

  return (
    <div className="category-breakdown-list">
      <span>카테고리별 지출 분포</span>
      {breakdown.map((item) => {
        const percentage = Math.round((item.amount / totalAmount) * 100)

        return (
          <div key={item.category}>
            <div>
              <strong>{item.category}</strong>
              <b>{formatWon(item.amount)}</b>
            </div>
            <i aria-hidden="true">
              <em style={{ width: `${Math.min(percentage, 100)}%` }} />
            </i>
            <small>{percentage}%</small>
          </div>
        )
      })}
    </div>
  )
}

function getProfilePatchEntries(
  patch: FinancialProfilePatch,
): Array<[string, string]> {
  const labels: Record<keyof FinancialProfilePatch, string> = {
    monthlySalary: '월 실수령액',
    essentialExpense: '필수 생활비',
    debtPayment: '카드·부채 결제',
    currentEmergencyFund: '현재 비상금',
    targetEmergencyFund: '비상금 목표',
    goalName: '목표',
    goalMonthlyAmount: '목표 저축',
    flexibleSpending: '여유 생활비',
    riskProfile: '투자 성향',
    investmentHorizon: '투자 기간',
    preferences: '지키고 싶은 취향',
    customUses: '월급 사용처',
  }

  return (Object.entries(patch) as Array<
    [keyof FinancialProfilePatch, FinancialProfilePatch[keyof FinancialProfilePatch]]
  >)
    .filter(([, value]) => !(typeof value === 'string' && value.trim().length === 0))
    .filter(([key]) => key !== 'customUses')
    .map(([key, value]) => [
      labels[key],
      Array.isArray(value)
        ? value.join(' · ')
        : typeof value === 'number'
          ? formatWon(value)
          : String(value),
    ])
}

function getProfileEditConfig(field: EditableProfileField): {
  title: string
  description: string
} {
  const configs: Record<EditableProfileField, { title: string; description: string }> = {
    monthlySalary: {
      title: '월 실수령액 수정',
      description: '통장에 들어오는 한 달 월급을 적어주세요.',
    },
    essentialExpense: {
      title: '필수 생활비 수정',
      description: '월세, 통신비, 식비처럼 꼭 나가는 돈을 적어주세요.',
    },
    debtPayment: {
      title: '카드·부채 수정',
      description: '이번 달 갚아야 할 카드값이나 대출 상환액을 적어주세요.',
    },
    currentEmergencyFund: {
      title: '현재 비상금 수정',
      description: '지금 따로 모아둔 비상금이 있다면 적어주세요.',
    },
    targetEmergencyFund: {
      title: '비상금 목표 수정',
      description: '생활비 몇 달치를 남겨둘지 생각해 목표 금액을 적어주세요.',
    },
    goalName: {
      title: '목표 수정',
      description: '여행, 이사, 노트북처럼 가까운 목표 이름을 적어주세요.',
    },
    goalMonthlyAmount: {
      title: '목표 저축 수정',
      description: '이번 달 목표를 위해 따로 모을 금액을 적어주세요.',
    },
    flexibleSpending: {
      title: '여유 생활비 수정',
      description: '외식, 여행, 취미처럼 지키고 싶은 소비 한도를 적어주세요.',
    },
    riskProfile: {
      title: '투자 조건 수정',
      description: '감당할 수 있는 변동성과 투자 기간을 골라주세요.',
    },
    investmentHorizon: {
      title: '투자 조건 수정',
      description: '감당할 수 있는 변동성과 투자 기간을 골라주세요.',
    },
  }

  return configs[field]
}

function getFinancialProfileItems(
  profile: FinancialProfile,
  estimatedInput: ReturnType<typeof toPaydayInput>,
): FinancialProfileItem[] {
  return [
    {
      field: 'monthlySalary',
      label: '월 실수령액',
      value: formatNullableWon(profile.monthlySalary),
      isComplete: profile.monthlySalary !== null,
      isDefault: false,
    },
    {
      field: 'essentialExpense',
      label: '필수 생활비',
      value: estimatedInput
        ? formatWon(estimatedInput.essentialExpense)
        : formatNullableWon(profile.essentialExpense),
      isComplete:
        profile.essentialExpense !== null || estimatedInput !== null,
      isDefault: profile.essentialExpense === null && estimatedInput !== null,
    },
    {
      field: 'debtPayment',
      label: '카드·부채',
      value: estimatedInput
        ? formatWon(estimatedInput.debtPayment)
        : formatNullableWon(profile.debtPayment),
      isComplete: profile.debtPayment !== null || estimatedInput !== null,
      isDefault: profile.debtPayment === null && estimatedInput !== null,
    },
    {
      field: 'currentEmergencyFund',
      label: '현재 비상금',
      value: estimatedInput
        ? formatWon(estimatedInput.currentEmergencyFund)
        : formatNullableWon(profile.currentEmergencyFund),
      isComplete:
        profile.currentEmergencyFund !== null || estimatedInput !== null,
      isDefault:
        profile.currentEmergencyFund === null && estimatedInput !== null,
    },
    {
      field: 'targetEmergencyFund',
      label: '비상금 목표',
      value: estimatedInput
        ? formatWon(estimatedInput.targetEmergencyFund)
        : formatNullableWon(profile.targetEmergencyFund),
      isComplete:
        profile.targetEmergencyFund !== null || estimatedInput !== null,
      isDefault:
        profile.targetEmergencyFund === null && estimatedInput !== null,
    },
    {
      field: 'goalName',
      label: '목표',
      value: estimatedInput?.goalName ?? profile.goalName,
      isComplete:
        profile.goalName.trim().length > 0 || estimatedInput !== null,
      isDefault:
        profile.goalName.trim().length === 0 && estimatedInput !== null,
    },
    {
      field: 'goalMonthlyAmount',
      label: '목표 저축',
      value: estimatedInput
        ? formatWon(estimatedInput.goalMonthlyAmount)
        : formatNullableWon(profile.goalMonthlyAmount),
      isComplete:
        profile.goalMonthlyAmount !== null || estimatedInput !== null,
      isDefault:
        profile.goalMonthlyAmount === null && estimatedInput !== null,
    },
    {
      field: 'flexibleSpending',
      label: '여유 생활비',
      value: estimatedInput
        ? formatWon(estimatedInput.flexibleSpending)
        : formatNullableWon(profile.flexibleSpending),
      isComplete:
        profile.flexibleSpending !== null || estimatedInput !== null,
      isDefault:
        profile.flexibleSpending === null && estimatedInput !== null,
    },
    {
      field: 'riskProfile',
      label: '투자 조건',
      value:
        profile.riskProfile && profile.investmentHorizon
          ? `${profile.riskProfile} · ${profile.investmentHorizon}`
          : '미정',
      isComplete:
        profile.riskProfile !== null && profile.investmentHorizon !== null,
      isDefault: false,
    },
  ]
}

function getNextAction(
  profile: FinancialProfile,
  plan: PaydayPlan | null,
  hasSpendingHistory: boolean,
): NextAction {
  if (profile.monthlySalary === null) {
    return {
      kind: 'salary',
      title: '월 실수령액을 알려주세요',
      description:
        '월급만 넣어도 생활비, 비상금, 목표 자금, 투자금 기준을 바로 잡아볼 수 있어요.',
      primaryLabel: '실수령액 입력하기',
    }
  }

  if (plan) {
    if (hasOnlyMonthlySalary(profile)) {
      return {
        kind: 'message',
        title: '사용내역을 붙여볼까요',
        description:
          '월급 기준은 잡혔으니 카드 내역이나 고정비를 더해 실제 생활비 기준으로 계획을 맞춰볼 수 있어요.',
        primaryLabel: '사용내역 분석',
        draft:
          '카드 내역을 보고 자료 월을 먼저 판단한 뒤 카테고리별 지출 분포로 분석해 주세요.',
      }
    }

    if (
      plan.availableInvestmentAmount > 0 &&
      canPrioritizeInvestment(profile, hasSpendingHistory)
    ) {
      return {
        kind: 'message',
        title: '투자 후보까지 이어볼까요',
        description:
          '월급에서 쓸 돈을 먼저 분리했으니, 남은 투자 가능 금액으로 후보를 비교해볼 수 있어요.',
        primaryLabel: '투자 후보 보기',
        draft:
          '이번 달 투자 가능 금액을 기준으로 ETF와 개별 종목 후보를 실제 티커로 비교해 주세요. 현재가와 재무 데이터는 출처가 있을 때만 사용하고, 출처가 없으면 확인 필요로 표시해 주세요.',
      }
    }

    if (plan.input.customUses.length > 0) {
      return {
        kind: 'message',
        title: '계획과 실제 소비를 맞춰볼까요',
        description:
          '저장된 세부 사용처와 카드 사용내역을 비교하면 부족하거나 과한 항목을 바로 찾을 수 있어요.',
        primaryLabel: '사용내역 비교',
        draft:
          '최근 카드 내역을 기준으로 저장된 세부 사용처와 실제 지출이 어떻게 다른지 비교해 주세요.',
      }
    }

    return {
      kind: 'message',
      title: '세부 사용 계획을 같이 잡아볼까요',
      description:
        '큰 범주는 이미 나눴으니, 생활비·비상금·목표 자금 안에서 실제 사용처와 금액을 더 촘촘하게 정리할 수 있어요.',
      primaryLabel: '세부 계획하기',
      draft:
        '이번 월급 계획의 각 범주별로 실제 어디에 얼마를 쓸지 세부 계획을 같이 세워 주세요.',
    }
  }

  return {
    kind: 'plan',
    title: '이번 월급 계획을 볼 수 있어요',
    description:
      '월급에서 먼저 나갈 돈을 빼고, 남는 금액만 투자금으로 계산했어요.',
    primaryLabel: '계획 보기',
  }
}

function createReplyWaitNotice(
  message: string,
  attachmentCount: number,
): string {
  if (attachmentCount > 0) {
    return `사용내역 이미지 ${attachmentCount}장을 읽고 있어요. 최대 1분 까지 걸릴 수 있어요.`
  }

  const intent = getActionIntent(message)
  if (intent === 'investment_research') {
    return '투자 후보를 비교해 정리하고 있어요. 최대 45초까지 걸릴 수 있어요.'
  }
  if (intent === 'spending_distribution') {
    return '사용내역을 분류하고 있어요. 최대 1분 까지 걸릴 수 있어요.'
  }
  if (
    intent === 'detail_plan' ||
    intent === 'detail_compare' ||
    intent === 'detail_adjust' ||
    intent === 'preference_adjust'
  ) {
    return '월급 조정안을 정리하고 있어요. 최대 1분 까지 걸릴 수 있어요.'
  }

  return '내용을 정리하고 있어요. 최대 1분 까지 걸릴 수 있어요.'
}

function resolveRecommendedAction(
  latestAction: NextAction | null,
  fallbackAction: NextAction,
  profile: FinancialProfile,
  hasSpendingHistory: boolean,
  messages: ConversationMessage[],
  completedActionIntents: ConversationActionIntent[],
): NextAction {
  const latestUserIntent = getLatestUserIntent(messages)
  const contextualAction = createContextualNextAction(
    latestUserIntent,
    profile,
    hasSpendingHistory,
  )

  if (latestAction && isSafeAiRecommendedAction({
    action: latestAction,
    profile,
    hasSpendingHistory,
    messages,
    latestUserIntent,
    completedActionIntents,
  })) {
    return latestAction
  }

  if (latestAction && contextualAction) {
    return contextualAction
  }

  if (
    isRecentlyRepeatedAction(fallbackAction, messages) ||
    isCompletedNextAction(fallbackAction, completedActionIntents)
  ) {
    return createAlternativeNextAction(
      profile,
      hasSpendingHistory,
      completedActionIntents,
    )
  }

  return fallbackAction
}

function isSafeAiRecommendedAction({
  action,
  profile,
  hasSpendingHistory,
  messages,
  latestUserIntent,
  completedActionIntents,
}: {
  action: NextAction
  profile: FinancialProfile
  hasSpendingHistory: boolean
  messages: ConversationMessage[]
  latestUserIntent: ConversationActionIntent | null
  completedActionIntents: ConversationActionIntent[]
}): boolean {
  if (
    isPrematureInvestmentAction(action, profile, hasSpendingHistory) ||
    isRedundantRecordAction(action, hasSpendingHistory) ||
    isRecentlyRepeatedAction(action, messages)
  ) {
    return false
  }

  const actionIntent = getNextActionIntent(action)
  if (
    actionIntent !== null &&
    latestUserIntent !== null &&
    actionIntent !== latestUserIntent &&
    completedActionIntents.includes(actionIntent)
  ) {
    return false
  }

  return true
}

function resolveSecondaryRecommendedActions(
  recommendations: NextActionRecommendation[],
  primaryAction: NextAction,
  profile: FinancialProfile,
  hasSpendingHistory: boolean,
  messages: ConversationMessage[],
  completedActionIntents: ConversationActionIntent[],
): SecondaryNextAction[] {
  const latestUserIntent = getLatestUserIntent(messages)

  return recommendations
    .map((recommendation) => toMessageNextAction(recommendation))
    .filter((action) =>
      action.draft !== undefined &&
      action.draft !== primaryAction.draft &&
      isSafeAiRecommendedAction({
        action,
        profile,
        hasSpendingHistory,
        messages,
        latestUserIntent,
        completedActionIntents,
      }),
    )
    .map((action) => ({
      label: action.primaryLabel,
      message: action.draft ?? '',
      icon: getActionIcon(getNextActionIntent(action)),
    }))
}

function toMessageNextAction(
  recommendation: NextActionRecommendation,
): NextAction {
  return {
    kind: 'message',
    title: recommendation.title,
    description: recommendation.description,
    primaryLabel: recommendation.primaryLabel,
    draft: recommendation.draft,
  }
}

function getLatestUserIntent(
  messages: ConversationMessage[],
): ConversationActionIntent | null {
  const latestUserMessage = messages
    .slice()
    .reverse()
    .find((message) => message.role === 'user' && message.status === 'sent')
  return latestUserMessage ? getActionIntent(latestUserMessage.content) : null
}

function createContextualNextAction(
  intent: ConversationActionIntent | null,
  profile: FinancialProfile,
  hasSpendingHistory: boolean,
): NextAction | null {
  if (intent === null) {
    return null
  }

  if (intent === 'investment_research') {
    return {
      kind: 'message',
      title: '투자 후보를 이어서 볼까요',
      description:
        '방금 요청한 포트폴리오 맥락에서 ETF와 후보군을 더 좁혀 비교할 수 있어요.',
      primaryLabel: '후보 더 비교',
      draft:
        '방금 포트폴리오 초안을 기준으로 ETF와 개별 종목 후보를 실제 티커 단위로 더 좁혀서 장단점과 확인할 자료를 비교해 주세요.',
    }
  }

  if (intent === 'preference_adjust') {
    return {
      kind: 'message',
      title: '지킨 소비 기준으로 조정할까요',
      description:
        '외식과 여행을 유지한 상태에서 줄일 수 있는 항목만 다시 좁혀볼 수 있어요.',
      primaryLabel: '조정 항목 좁히기',
      draft:
        '외식과 여행은 유지하고, 나머지 지출 중 줄일 후보만 우선순위로 정리해 주세요.',
    }
  }

  if (intent === 'spending_distribution' && hasSpendingHistory) {
    return {
      kind: 'message',
      title: '분석한 내역으로 조정할까요',
      description:
        '이미 확인한 사용내역을 기준으로 과한 항목과 유지할 항목을 나눠볼 수 있어요.',
      primaryLabel: '지출 조정',
      draft:
        '이미 분석한 사용내역을 기준으로 과한 항목과 유지할 항목을 나눠 월급 조정안을 제안해 주세요.',
    }
  }

  if (intent === 'safety_check') {
    return {
      kind: 'message',
      title: '안전망 기준으로 이어볼까요',
      description:
        '비상금과 카드값을 기준으로 이번 달 먼저 지킬 금액을 더 구체화할 수 있어요.',
      primaryLabel: '우선순위 구체화',
      draft:
        '방금 안전망 점검 결과를 기준으로 이번 달 먼저 지킬 금액과 조정할 금액을 구체화해 주세요.',
    }
  }

  if (
    intent === 'detail_adjust'
  ) {
    return {
      kind: 'plan',
      title: '이번 월급 계획을 확인할까요',
      description:
        '방금 조정한 세부 사용처가 반영됐어요. 이제 전체 배분을 확인하면 됩니다.',
      primaryLabel: '계획 보기',
    }
  }

  if (
    intent === 'detail_plan' ||
    intent === 'detail_compare'
  ) {
    return {
      kind: 'message',
      title: '세부 사용처를 이어서 다듬을까요',
      description:
        '방금 정한 사용처를 유지하면서 과하거나 부족한 항목만 조정할 수 있어요.',
      primaryLabel: '세부 항목 다듬기',
      draft:
        '방금 정한 세부 사용처를 기준으로 과하거나 부족한 항목만 골라 조정해 주세요.',
    }
  }

  if (intent === 'fixed_costs') {
    return {
      kind: 'message',
      title: '고정비 기준으로 이어볼까요',
      description:
        '매달 먼저 나갈 돈을 유지하고 변동비에서 조정할 항목을 찾을 수 있어요.',
      primaryLabel: '변동비 조정',
      draft:
        '확인된 고정비는 유지하고, 변동비에서 줄일 수 있는 항목을 우선순위로 정리해 주세요.',
    }
  }

  if (intent === 'salary' && profile.monthlySalary !== null) {
    return {
      kind: 'message',
      title: '월급 기준으로 다음을 정할까요',
      description:
        '월급 기준은 잡혔으니 사용내역, 고정비, 목표 중 하나를 이어서 반영할 수 있어요.',
      primaryLabel: '사용내역 반영',
      draft:
        '입력했던 월급 기준으로 사용내역과 고정비를 반영해 월급 계획을 이어서 정리해 주세요.',
    }
  }

  return null
}

function createAlternativeNextAction(
  profile: FinancialProfile,
  hasSpendingHistory: boolean,
  completedActionIntents: ConversationActionIntent[],
): NextAction {
  if (
    (profile.currentEmergencyFund === null || profile.debtPayment === null) &&
    !completedActionIntents.includes('safety_check')
  ) {
    return {
      kind: 'message',
      title: '비상금과 카드값도 볼까요',
      description:
        '생활비 계획을 잡았으니, 이번 달 먼저 지켜둘 안전 자금을 확인할 수 있어요.',
      primaryLabel: '비상금 점검',
      draft:
        '현재 비상금과 이번 달 갚아야 할 카드값을 기준으로 월급 배분 우선순위를 점검해 주세요.',
    }
  }

  if (
    hasSpendingHistory &&
    profile.customUses.length > 0 &&
    !completedActionIntents.includes('detail_adjust')
  ) {
    return {
      kind: 'message',
      title: '차이가 큰 항목을 조정할까요',
      description:
        '실제 지출에 맞춰 생활비와 여유 생활비 금액을 다시 맞출 수 있어요.',
      primaryLabel: '조정안 만들기',
      draft:
        '최근 사용내역과 저장된 세부 사용처의 차이를 기준으로 과하거나 부족한 항목만 조정해 주세요.',
    }
  }

  if (!completedActionIntents.includes('preference_adjust')) {
    return {
      kind: 'message',
      title: '지키고 싶은 소비를 반영할까요',
      description:
        '외식, 여행, 취미처럼 줄이고 싶지 않은 항목을 남긴 채 다른 금액을 조정할 수 있어요.',
      primaryLabel: '취향 반영',
      draft:
        '외식과 여행은 지키면서 다른 지출에서 균형을 맞추는 월급 조정안을 제안해 주세요.',
    }
  }

  return {
    kind: 'plan',
    title: '이번 월급 계획을 볼 수 있어요',
    description:
      '지금까지 반영한 내용을 기준으로 전체 배분을 확인할 수 있어요.',
    primaryLabel: '계획 보기',
  }
}

function isCompletedNextAction(
  action: NextAction,
  completedActionIntents: ConversationActionIntent[],
): boolean {
  const intent = getNextActionIntent(action)
  return intent !== null && completedActionIntents.includes(intent)
}

function getNextActionIntent(action: NextAction): ConversationActionIntent | null {
  return getActionIntent(
    [
      action.title,
      action.description,
      action.primaryLabel,
      action.draft ?? '',
    ].join(' '),
  )
}

function getActionIcon(intent: ConversationActionIntent | null): ReactNode {
  switch (intent) {
    case 'spending_distribution':
      return <CalendarDays size={15} />
    case 'fixed_costs':
      return <FileText size={15} />
    case 'safety_check':
      return <PiggyBank size={15} />
    case 'investment_research':
      return <TrendingUp size={15} />
    case 'preference_adjust':
      return <MessageCircleMore size={15} />
    case 'detail_plan':
    case 'detail_compare':
    case 'detail_adjust':
      return <WalletCards size={15} />
    case 'salary':
      return <Calculator size={15} />
    default:
      return <MessageCircleMore size={15} />
  }
}

function isRecentlyRepeatedAction(
  action: NextAction,
  messages: ConversationMessage[],
): boolean {
  if (!action.draft) {
    return false
  }
  const normalizedDraft = normalizeActionText(action.draft)
  return messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .some((message) => {
      const normalizedMessage = normalizeActionText(message.content)
      return (
        normalizedMessage === normalizedDraft ||
        normalizedMessage.includes(normalizedDraft) ||
        normalizedDraft.includes(normalizedMessage)
      )
    })
}

function createCompletedActionIntents(
  messages: ConversationMessage[],
  profile: FinancialProfile,
  monthlySpending: MonthlySpendingSummary[],
): ConversationActionIntent[] {
  const completedIntents = new Set<ConversationActionIntent>()

  if (profile.monthlySalary !== null) {
    completedIntents.add('salary')
  }
  if (monthlySpending.length > 0) {
    completedIntents.add('spending_distribution')
  }
  if (profile.customUses.length > 0) {
    completedIntents.add('detail_plan')
  }
  if (profile.essentialExpense !== null || profile.customUses.some((use) => use.bucket === 'essential')) {
    completedIntents.add('fixed_costs')
  }
  if (profile.currentEmergencyFund !== null && profile.debtPayment !== null) {
    completedIntents.add('safety_check')
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'user' || message.status !== 'sent') {
      continue
    }
    const intent = getActionIntent(message.content)
    if (!intent) {
      continue
    }
    const hasAgentReply = messages
      .slice(index + 1)
      .some((nextMessage) => nextMessage.role === 'agent' && nextMessage.status === 'sent')
    if (hasAgentReply) {
      completedIntents.add(intent)
    }
  }

  return [...completedIntents]
}

function isCompletedActionMessage(
  message: string,
  completedActionIntents: ConversationActionIntent[],
): boolean {
  const intent = getActionIntent(message)
  return intent !== null && completedActionIntents.includes(intent)
}

function getActionIntent(message: string): ConversationActionIntent | null {
  const normalizedMessage = normalizeActionText(message)

  if (
    normalizedMessage.includes('외식') ||
    normalizedMessage.includes('여행') ||
    normalizedMessage.includes('취향') ||
    normalizedMessage.includes('줄이고싶지')
  ) {
    return 'preference_adjust'
  }
  if (
    normalizedMessage.includes('투자') ||
    normalizedMessage.includes('포트폴리오') ||
    normalizedMessage.includes('종목') ||
    normalizedMessage.includes('주식') ||
    normalizedMessage.includes('ETF')
  ) {
    return 'investment_research'
  }
  if (
    normalizedMessage.includes('조정안') ||
    normalizedMessage.includes('조정해') ||
    normalizedMessage.includes('보완안') ||
    normalizedMessage.includes('부족한항목') ||
    normalizedMessage.includes('과한항목')
  ) {
    return 'detail_adjust'
  }
  if (
    normalizedMessage.includes('비교') ||
    normalizedMessage.includes('다른지') ||
    normalizedMessage.includes('차이') ||
    normalizedMessage.includes('맞춰')
  ) {
    return 'detail_compare'
  }
  if (
    normalizedMessage.includes('세부계획') ||
    normalizedMessage.includes('세부사용처') ||
    normalizedMessage.includes('각범주') ||
    normalizedMessage.includes('어디에얼마')
  ) {
    return 'detail_plan'
  }
  if (
    normalizedMessage.includes('비상금') ||
    normalizedMessage.includes('카드값') ||
    normalizedMessage.includes('카드대금') ||
    normalizedMessage.includes('대출') ||
    normalizedMessage.includes('부채') ||
    normalizedMessage.includes('상환') ||
    normalizedMessage.includes('안전망')
  ) {
    return 'safety_check'
  }
  if (
    normalizedMessage.includes('월세') ||
    normalizedMessage.includes('보험료') ||
    normalizedMessage.includes('통신비') ||
    normalizedMessage.includes('관리비') ||
    normalizedMessage.includes('고정비')
  ) {
    return 'fixed_costs'
  }
  if (
    normalizedMessage.includes('사용내역') ||
    normalizedMessage.includes('카드내역') ||
    normalizedMessage.includes('지출분포') ||
    normalizedMessage.includes('카테고리별') ||
    normalizedMessage.includes('명세서')
  ) {
    return 'spending_distribution'
  }
  if (
    normalizedMessage.includes('월실수령액') ||
    normalizedMessage.includes('실수령액') ||
    normalizedMessage.includes('월급')
  ) {
    return 'salary'
  }

  return null
}

function normalizeActionText(text: string): string {
  return text.replace(/\s+/g, '').replace(/[.?!。！？]/g, '').trim()
}

function isRedundantRecordAction(
  action: NextAction,
  hasSpendingHistory: boolean,
): boolean {
  if (!hasSpendingHistory) {
    return false
  }
  const actionText = [
    action.title,
    action.description,
    action.primaryLabel,
    action.draft ?? '',
  ].join(' ')
  return /기록\s*추가|사용내역\s*추가|내역\s*저장/.test(actionText)
}

function isPrematureInvestmentAction(
  action: NextAction,
  profile: FinancialProfile,
  hasSpendingHistory: boolean,
): boolean {
  if (canPrioritizeInvestment(profile, hasSpendingHistory)) {
    return false
  }

  const actionText = [
    action.title,
    action.description,
    action.primaryLabel,
    action.draft ?? '',
  ].join(' ')

  return ['투자', '종목', '포트폴리오'].some((keyword) =>
    actionText.includes(keyword),
  )
}

function createConversationAppContext({
  profile,
  plan,
  monthlySpending,
  hasSpendingHistory,
  completedActionIntents,
}: {
  profile: FinancialProfile
  plan: PaydayPlan | null
  monthlySpending: MonthlySpendingSummary[]
  hasSpendingHistory: boolean
  completedActionIntents: ConversationActionIntent[]
}): PaydayConversationAppContext {
  const canSuggestInvestment = canPrioritizeInvestment(profile, hasSpendingHistory)
  const stage = getConversationStage(profile, plan, hasSpendingHistory)

  return {
    stage,
    completedActions: completedActionIntents,
    confirmedFacts: createConfirmedFacts(profile, monthlySpending),
    planSnapshot: {
      monthlySalary: profile.monthlySalary,
      availableInvestmentAmount:
        plan && canSuggestInvestment ? plan.availableInvestmentAmount : null,
      safetyStatus: plan?.safetyStatus ?? null,
      allocationSummary:
        plan?.allocations.map((allocation) => ({
          label: allocation.label,
          amount: allocation.amount,
        })) ?? [],
    },
    recommendationPolicy: createRecommendationPolicy(stage),
  }
}

function compactConversationContent(content: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim()
  const maxLength = 1_500
  if (normalizedContent.length <= maxLength) {
    return normalizedContent
  }

  return `${normalizedContent.slice(0, maxLength - 20)}...`
}

function getConversationStage(
  profile: FinancialProfile,
  plan: PaydayPlan | null,
  hasSpendingHistory: boolean,
): PaydayConversationAppContext['stage'] {
  if (profile.monthlySalary === null) {
    return 'empty'
  }
  if (hasOnlyMonthlySalary(profile)) {
    return 'salary_only'
  }
  if (canPrioritizeInvestment(profile, hasSpendingHistory) && plan?.availableInvestmentAmount) {
    return 'investment_ready'
  }
  if (profile.customUses.length > 0) {
    return 'budget_detail_ready'
  }
  return 'spending_ready'
}

function createConfirmedFacts(
  profile: FinancialProfile,
  monthlySpending: MonthlySpendingSummary[],
): string[] {
  const facts: string[] = []
  if (profile.monthlySalary !== null) {
    facts.push(`월 실수령액 ${formatWon(profile.monthlySalary)}`)
  }
  if (profile.essentialExpense !== null) {
    facts.push(`필수 생활비 ${formatWon(profile.essentialExpense)}`)
  }
  if (profile.debtPayment !== null) {
    facts.push(`카드·부채 결제 ${formatWon(profile.debtPayment)}`)
  }
  if (profile.currentEmergencyFund !== null) {
    facts.push(`현재 비상금 ${formatWon(profile.currentEmergencyFund)}`)
  }
  if (profile.targetEmergencyFund !== null) {
    facts.push(`비상금 목표 ${formatWon(profile.targetEmergencyFund)}`)
  }
  if (profile.goalName.trim()) {
    facts.push(`목표 ${profile.goalName}`)
  }
  if (profile.goalMonthlyAmount !== null) {
    facts.push(`목표 저축 ${formatWon(profile.goalMonthlyAmount)}`)
  }
  if (profile.flexibleSpending !== null) {
    facts.push(`여유 생활비 ${formatWon(profile.flexibleSpending)}`)
  }
  if (profile.riskProfile && profile.investmentHorizon) {
    facts.push(`투자 조건 ${profile.riskProfile} · ${profile.investmentHorizon}`)
  }
  if (monthlySpending.length > 0) {
    facts.push(
      `확인된 사용내역 ${monthlySpending.map((summary) => formatMonth(summary.month)).join(', ')}`,
    )
  }
  return facts
}

function createRecommendationPolicy(
  stage: PaydayConversationAppContext['stage'],
): PaydayConversationAppContext['recommendationPolicy'] {
  if (stage === 'empty') {
    return {
      priority: ['월 실수령액 입력 또는 계산'],
      avoid: ['투자 후보 조사', '종목 분석', '포트폴리오 구성'],
    }
  }
  if (stage === 'salary_only') {
    return {
      priority: ['사용내역 월 자동 판단', '카테고리별 지출 분포', '고정비 확인', '비상금·카드값 우선순위 점검'],
      avoid: ['투자 후보 조사', '종목 분석', '포트폴리오 구성'],
    }
  }
  if (stage === 'investment_ready') {
    return {
      priority: ['출처 기반 투자 후보 비교', '포트폴리오 비중 조정', '확인할 자료 정리', '전체 월급 계획 확인'],
      avoid: ['이미 확인된 정보를 다시 질문하기', '투자 요청을 세부 사용처 조정으로 바꾸기', '카드 내역 다시 요청하기'],
    }
  }
  return {
    priority: ['세부 사용처 보완', '실제 사용내역과 계획 비교', '비상금·카드값 우선순위 점검'],
    avoid: ['확인되지 않은 투자 가능 금액으로 종목 추천하기', '이미 확인된 정보를 다시 질문하기'],
  }
}

function hasOnlyMonthlySalary(profile: FinancialProfile): boolean {
  return (
    profile.monthlySalary !== null &&
    profile.essentialExpense === null &&
    profile.debtPayment === null &&
    profile.currentEmergencyFund === null &&
    profile.targetEmergencyFund === null &&
    profile.goalName.trim().length === 0 &&
    profile.goalMonthlyAmount === null &&
    profile.flexibleSpending === null &&
    profile.riskProfile === null &&
    profile.investmentHorizon === null &&
    profile.preferences.length === 0 &&
    profile.customUses.length === 0
  )
}

function canPrioritizeInvestment(
  profile: FinancialProfile,
  hasSpendingHistory: boolean,
): boolean {
  const hasInvestmentCondition =
    profile.riskProfile !== null && profile.investmentHorizon !== null
  const hasBudgetBasis =
    hasSpendingHistory ||
    profile.essentialExpense !== null ||
    profile.debtPayment !== null ||
    profile.currentEmergencyFund !== null ||
    profile.targetEmergencyFund !== null ||
    profile.goalMonthlyAmount !== null ||
    profile.flexibleSpending !== null ||
    profile.customUses.length > 0

  return (
    hasInvestmentCondition &&
    hasBudgetBasis
  )
}

function toNextAction(recommendation: NextActionRecommendation): NextAction {
  const isPlanAction =
    recommendation.primaryLabel.includes('계획 보기') ||
    recommendation.title.includes('계획을 확인')
  return {
    kind: isPlanAction ? 'plan' : 'message',
    title: recommendation.title,
    description: recommendation.description,
    primaryLabel: recommendation.primaryLabel,
    draft: isPlanAction ? undefined : recommendation.draft,
  }
}

function formatCustomUseBucket(
  bucket: 'essential' | 'goal' | 'flexible',
): string {
  return {
    essential: '필수 생활비',
    goal: '목표 자금',
    flexible: '여유 생활비',
  }[bucket]
}

function getVisibleAllocationDetails(
  allocation: SalaryAllocation,
): SalaryAllocation['details'] {
  if (
    allocation.details.length === 1 &&
    allocation.details[0].name.trim() === allocation.label.trim() &&
    allocation.details[0].amount === allocation.amount
  ) {
    return []
  }

  return allocation.details
}

function createPlanDetailDraft(plan: PaydayPlan): string {
  const allocations = plan.allocations
    .filter((allocation) => allocation.amount > 0)
    .map((allocation) => `${allocation.label} ${formatWon(allocation.amount)}`)
    .join(', ')

  return `이번 월급 계획의 세부 사용처를 같이 세워 주세요. 현재 배분은 ${allocations}입니다. 이미 정한 항목은 유지하고, 비어 있는 범주는 합리적인 초안으로 먼저 나눠 주세요.`
}

function createVisiblePendingResponse(
  response: PaydayConversationResponse,
  profile: FinancialProfile,
  monthlySpending: MonthlySpendingSummary[],
): PaydayConversationResponse | null {
  const visibleResponse: PaydayConversationResponse = {
    ...response,
    profilePatch: filterRedundantProfilePatch(response.profilePatch, profile),
    monthlySpendingProposal: isInvalidMonthlySpendingProposal(
      response.monthlySpendingProposal,
    ) || isRedundantMonthlySpendingProposal(
      response.monthlySpendingProposal,
      monthlySpending,
    )
      ? undefined
      : response.monthlySpendingProposal,
    appliedFacts: [],
    missingData: [],
  }

  return hasVisibleProposal(visibleResponse) ? visibleResponse : null
}

function stageMonthlySpendingProposal(
  monthlySpending: MonthlySpendingSummary[],
  proposal: NonNullable<PaydayConversationResponse['monthlySpendingProposal']>,
): MonthlySpendingSummary[] {
  return [
    ...monthlySpending.filter((summary) => summary.month !== proposal.month),
    {
      ...proposal,
      id: crypto.randomUUID(),
      needReview: true,
    },
  ]
}

function filterRedundantProfilePatch(
  patch: FinancialProfilePatch,
  profile: FinancialProfile,
): FinancialProfilePatch {
  const visiblePatch: FinancialProfilePatch = {}

  for (const [key, value] of Object.entries(patch) as Array<
    [keyof FinancialProfilePatch, FinancialProfilePatch[keyof FinancialProfilePatch]]
  >) {
    if (value === undefined || isRedundantProfilePatchValue(key, value, profile)) {
      continue
    }
    Object.assign(visiblePatch, { [key]: value })
  }

  return visiblePatch
}

function isRedundantProfilePatchValue(
  key: keyof FinancialProfilePatch,
  value: FinancialProfilePatch[keyof FinancialProfilePatch],
  profile: FinancialProfile,
): boolean {
  if (key === 'preferences') {
    return (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string') &&
      value.every((item) => profile.preferences.includes(item))
    )
  }
  if (key === 'customUses') {
    return Array.isArray(value) && areCustomUseArray(value) && areCustomUsesSame(value, profile.customUses)
  }

  const currentValue = profile[key as keyof FinancialProfile]
  if (typeof value === 'string' && typeof currentValue === 'string') {
    return value.trim() === currentValue.trim()
  }
  return value === currentValue
}

function areCustomUseArray(
  value: FinancialProfilePatch[keyof FinancialProfilePatch],
): value is FinancialProfile['customUses'] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'object' && item !== null && 'name' in item && 'amount' in item && 'bucket' in item)
  )
}

function areCustomUsesSame(
  left: FinancialProfilePatch['customUses'],
  right: FinancialProfile['customUses'],
): boolean {
  if (!left || left.length !== right.length) {
    return false
  }

  const normalize = (uses: FinancialProfile['customUses']) =>
    uses
      .map((use) => `${use.bucket}|${use.name.trim()}|${use.amount}|${use.note.trim()}`)
      .sort()

  return normalize(left).join('\n') === normalize(right).join('\n')
}

function isRedundantMonthlySpendingProposal(
  proposal: PaydayConversationResponse['monthlySpendingProposal'],
  monthlySpending: MonthlySpendingSummary[],
): boolean {
  if (!proposal) {
    return false
  }
  const existingSummary = monthlySpending.find(
    (summary) => summary.month === proposal.month,
  )
  if (!existingSummary) {
    return false
  }

  return (
    existingSummary.totalExpense === proposal.totalExpense &&
    existingSummary.essentialExpense === proposal.essentialExpense &&
    existingSummary.flexibleExpense === proposal.flexibleExpense &&
    areCategoryBreakdownsSame(
      existingSummary.categoryBreakdown,
      proposal.categoryBreakdown,
    )
  )
}

function isInvalidMonthlySpendingProposal(
  proposal: PaydayConversationResponse['monthlySpendingProposal'],
): boolean {
  return proposal !== undefined && !hasReadableMonthlySpendingAmount(proposal)
}

function hasReadableMonthlySpendingAmount(
  proposal: PaydayConversationResponse['monthlySpendingProposal'],
): boolean {
  if (!proposal) {
    return false
  }

  const amountFields = [
    proposal.totalExpense,
    proposal.essentialExpense,
    proposal.flexibleExpense,
  ]
  const hasPositiveAmount = amountFields.some(
    (amount) => amount !== null && amount > 0,
  )
  return (
    hasPositiveAmount ||
    proposal.categoryBreakdown.some((item) => item.amount > 0)
  )
}

function areCategoryBreakdownsSame(
  left: SpendingCategoryAmount[],
  right: SpendingCategoryAmount[],
): boolean {
  if (left.length !== right.length) {
    return false
  }
  const normalize = (items: SpendingCategoryAmount[]) =>
    items
      .map((item) => `${item.category.trim()}|${item.amount}`)
      .sort()
      .join('\n')
  return normalize(left) === normalize(right)
}

function hasVisibleProposal(response: PaydayConversationResponse): boolean {
  return (
    Object.keys(response.profilePatch).length > 0 ||
    response.monthlySpendingProposal !== undefined
  )
}

async function readAttachment(file: File): Promise<ConversationAttachment> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name}은 4MB를 넘어 첨부할 수 없어요.`)
  }
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(
      file.type,
    )
  ) {
    throw new Error(`${file.name}은 지원하지 않는 이미지 형식이에요.`)
  }

  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type as ConversationAttachment['mimeType'],
    data: await fileToBase64(file),
    previewUrl: URL.createObjectURL(file),
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('이미지를 읽지 못했어요. 다른 사진으로 다시 올려주세요.'))
        return
      }
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () =>
      reject(new Error('이미지를 읽지 못했어요. 다른 사진으로 다시 올려주세요.'))
    reader.readAsDataURL(file)
  })
}

async function fetchServerHealth(baseUrl: string | undefined): Promise<ServerStatus> {
  const normalizedBaseUrl = baseUrl?.replace(/\/$/, '') ?? ''
  const response = await fetch(`${normalizedBaseUrl}/api/health`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    return 'offline'
  }

  const body = (await response.json()) as { status?: string }
  return body.status === 'ok' ? 'online' : 'offline'
}

function getServerStatusLabel(status: ServerStatus): string {
  return {
    checking: '서버 상태 확인 중',
    online: '서버 연결 정상',
    offline: '서버 연결 끊김',
  }[status]
}

function previousMonth(): string {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-')
  return `${year}년 ${Number(month)}월`
}

function formatShortMonth(value: string): string {
  const [, month] = value.split('-')
  return `${Number(month)}월`
}

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString()}원`
}

function formatCompactWon(value: number): string {
  if (value >= 10000) {
    return `${Math.round(value / 10000).toLocaleString()}만`
  }

  return `${Math.round(value).toLocaleString()}`
}

function parseMoney(value: string): number {
  return Number(value.replaceAll(',', '').replace(/\D/g, '')) || 0
}

function formatNullableWon(value: number | null): string {
  return value === null ? '모름' : formatWon(value)
}

function createMonthlySpendingClarification(
  summary: Omit<MonthlySpendingSummary, 'id'>,
): string {
  const amounts = [
    `총소비 ${formatNullableWon(summary.totalExpense)}`,
    `필수지출 ${formatNullableWon(summary.essentialExpense)}`,
    `선택지출 ${formatNullableWon(summary.flexibleExpense)}`,
  ].join(', ')

  return `${formatMonth(summary.month)} 사용 요약을 확인했어요. 지금 읽은 금액은 ${amounts}입니다. 틀린 부분만 이렇게 고쳐주세요: `
}

function normalizeFinancialProfile(profile: FinancialProfile): FinancialProfile {
  const legacyRiskProfile = profile.riskProfile as RiskProfile | '성장형' | null

  return {
    ...profile,
    riskProfile:
      legacyRiskProfile === '성장형'
        ? '공격형'
        : legacyRiskProfile,
  }
}

function normalizeMonthlySpendingSummary(
  summary: MonthlySpendingSummary,
): MonthlySpendingSummary {
  return {
    ...summary,
    categoryBreakdown: summary.categoryBreakdown ?? [],
  }
}

function normalizeConversationMessages(
  messages: ConversationMessage[],
): ConversationMessage[] {
  return messages.map((message) =>
    message.id === INITIAL_AGENT_MESSAGE.id
      ? { ...message, content: INITIAL_AGENT_MESSAGE.content }
      : message,
  )
}

function createSpendingTrend(
  summaries: MonthlySpendingSummary[],
): SpendingTrendPoint[] {
  return summaries
    .filter((summary) => summary.totalExpense !== null)
    .slice(0, 6)
    .reverse()
    .map((summary) => ({
      monthLabel: formatShortMonth(summary.month),
      totalExpense: summary.totalExpense ?? 0,
      essentialExpense: summary.essentialExpense ?? 0,
      flexibleExpense: summary.flexibleExpense ?? 0,
    }))
}

export default App
