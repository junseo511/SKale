import {
  Check,
  CheckCheck,
  CircleAlert,
  ClipboardCheck,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  stockScoreMaximums,
  type ConfirmedStockAnalysis,
  type StockAgent,
  type StockAnalysis,
  type StockAnalysisRequest,
  type StockReviewRepository,
  type StockScoreBreakdown,
} from '../../domain/stock'

const EXAMPLE_REQUEST: StockAnalysisRequest = {
  companyName: 'SK하이닉스',
  ticker: '000660',
  industryDescription:
    'AI 서버와 고성능 컴퓨팅 확대에 따라 HBM, DRAM, NAND 수요가 장기적으로 증가할 수 있는 메모리 반도체 산업입니다.',
  businessDescription:
    'DRAM과 NAND를 제조하며 HBM 등 고부가 메모리에서 기술력, 대규모 설비, 고객사 인증이 진입장벽으로 작용합니다.',
  financialData:
    '메모리 사이클에 따라 매출과 영업이익 변동성이 큽니다. HBM 수요 확대 구간에서는 수익성이 개선될 수 있으나, 설비투자와 재고 사이클 확인이 필요합니다.',
  valuationData: 'PER, PBR, EV/EBITDA는 메모리 업황 고점과 저점에 따라 왜곡될 수 있어 사이클 평균과 함께 봐야 합니다.',
  managementNotes:
    '첨단 메모리 투자와 연구개발을 지속하고 있으며, CAPEX가 현금흐름에 미치는 영향 확인이 필요합니다.',
  userConcern:
    'AI 수요가 둔화되거나 HBM 경쟁이 심해질 때 이익률이 빠르게 훼손될 수 있다는 점이 우려됩니다.',
}

interface StockAgentWorkspaceProps {
  agent: StockAgent
  reviewRepository: StockReviewRepository
}

export function StockAgentWorkspace({
  agent,
  reviewRepository,
}: StockAgentWorkspaceProps): ReactNode {
  const [request, setRequest] =
    useState<StockAnalysisRequest>(EXAMPLE_REQUEST)
  const [feedback, setFeedback] = useState('')
  const [analysis, setAnalysis] = useState<StockAnalysis | null>(null)
  const [confirmed, setConfirmed] =
    useState<ConfirmedStockAnalysis | null>(() => reviewRepository.loadLatest())
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const abortControllerReference = useRef<AbortController | null>(null)

  useEffect(() => () => abortControllerReference.current?.abort(), [])

  async function requestAnalysis(userFeedback?: string): Promise<void> {
    if (!request.companyName.trim()) {
      setErrorMessage('종목명을 입력해 주세요.')
      return
    }

    abortControllerReference.current?.abort()
    const abortController = new AbortController()
    abortControllerReference.current = abortController
    setIsAnalyzing(true)
    setErrorMessage('')

    try {
      const result = await agent.analyze(
        { ...request, userFeedback },
        abortController.signal,
      )
      setAnalysis(result)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      setErrorMessage(
        error instanceof Error ? error.message : '종목 분석에 실패했습니다.',
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  function confirmAnalysis(): void {
    if (!analysis || analysis.decision !== 'accepted') {
      setErrorMessage('AI 분석을 수락한 뒤 확정해 주세요.')
      return
    }
    const nextConfirmed = {
      ...analysis,
      confirmedAt: new Date().toISOString(),
    }
    reviewRepository.save(nextConfirmed)
    setConfirmed(nextConfirmed)
    setErrorMessage('')
  }

  return (
    <div className="agent-workspace">
      <section className="agent-intro-card">
        <div className="agent-avatar"><TrendingUp size={24} /></div>
        <div>
          <span>SKale 기업 검토 코치</span>
          <h2>이야기보다 제공된 숫자를 우선해 검토해요.</h2>
          <p>최신 데이터는 추정하지 않으며 부족하면 점수 대신 필요한 정보를 요청합니다.</p>
        </div>
        <div className="agent-principle"><ShieldCheck size={17} />Provided data only</div>
      </section>

      <section className="input-card">
        <div className="form-grid">
          <Field label="종목명" value={request.companyName} onChange={(companyName) => setRequest({ ...request, companyName })} />
          <Field label="티커" value={request.ticker ?? ''} onChange={(ticker) => setRequest({ ...request, ticker })} />
        </div>
        <TextField label="산업 설명" value={request.industryDescription} onChange={(industryDescription) => setRequest({ ...request, industryDescription })} />
        <TextField label="사업 및 경쟁우위" value={request.businessDescription} onChange={(businessDescription) => setRequest({ ...request, businessDescription })} />
        <TextField label="최근 재무 데이터" value={request.financialData} onChange={(financialData) => setRequest({ ...request, financialData })} />
        <TextField label="밸류에이션 데이터" value={request.valuationData} onChange={(valuationData) => setRequest({ ...request, valuationData })} />
        <TextField label="경영진·자본배분" value={request.managementNotes} onChange={(managementNotes) => setRequest({ ...request, managementNotes })} />
        <TextField label="내가 우려하는 점" value={request.userConcern} onChange={(userConcern) => setRequest({ ...request, userConcern })} />
        <div className="button-row">
          <button className="button secondary" type="button" onClick={() => setRequest(EXAMPLE_REQUEST)}><RotateCcw size={16} />예시 다시 넣기</button>
          <button className="button primary" type="button" disabled={isAnalyzing} onClick={() => void requestAnalysis()}>
            {isAnalyzing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
            {isAnalyzing ? 'AI가 검토 중...' : '전략 기준으로 분석'}
          </button>
        </div>
      </section>

      {errorMessage && <div className="agent-error" role="alert"><CircleAlert size={18} />{errorMessage}</div>}

      {analysis && (
        <section className="review-section stock-review-section">
          <div className="stock-verdict-grid">
            <SummaryCard label="판정" value={analysis.verdict} />
            <SummaryCard label="전략 적합도" value={analysis.totalScore === null ? '산정 보류' : `${analysis.totalScore} / 100`} />
            <SummaryCard label="부족한 데이터" value={`${analysis.missingData.length}개`} />
          </div>

          <div className="stock-thesis">
            <span className="section-kicker">ONE SENTENCE THESIS</span>
            <h2>{analysis.oneSentenceThesis}</h2>
          </div>

          <ScoreGrid scores={analysis.scoreBreakdown} />

          <div className="stock-detail-grid">
            <ListPanel title="강점" items={analysis.strengths} tone="positive" />
            <ListPanel title="약점" items={analysis.weaknesses} tone="negative" />
            <ListPanel title="치명적 리스크" items={analysis.fatalFlags} tone="negative" emptyText="확인된 치명적 리스크 없음" />
            <ListPanel title="부족한 데이터" items={analysis.missingData} tone="warning" emptyText="필수 데이터가 충분합니다." />
            <ListPanel title="다음 확인 질문" items={analysis.questionsToCheck} />
            <ListPanel title="분기별 추적 지표" items={analysis.monitoringMetrics} />
          </div>

          <aside className="agent-conversation-card compact-conversation">
            <div className="conversation-heading"><MessageSquareText size={19} /><div><strong>분석 수정 요청</strong><span>추가 데이터나 반대 관점을 전달해 다시 검토할 수 있어요.</span></div></div>
            <textarea aria-label="종목 AI 수정 요청" value={feedback} placeholder="예: 영업현금흐름이 최근 3년 모두 플러스라는 점을 반영해줘." onChange={(event) => setFeedback(event.target.value)} />
            <button className="button agent-feedback-button" type="button" disabled={!feedback.trim() || isAnalyzing} onClick={() => void requestAnalysis(feedback.trim())}><Sparkles size={16} />의견 반영해 다시 분석</button>
            {analysis.appliedFeedback && <p className="applied-feedback"><Check size={14} />반영한 요청: {analysis.appliedFeedback}</p>}
          </aside>

          <div className="portfolio-decision-row">
            <button className={`proposal-action accept${analysis.decision === 'accepted' ? ' selected' : ''}`} type="button" onClick={() => setAnalysis({ ...analysis, decision: 'accepted' })}><ThumbsUp size={15} />분석 수락</button>
            <button className={`proposal-action reject${analysis.decision === 'rejected' ? ' selected' : ''}`} type="button" onClick={() => setAnalysis({ ...analysis, decision: 'rejected' })}><ThumbsDown size={15} />분석 거절</button>
          </div>

          <div className="review-footer">
            <div><strong>{analysis.nextAction}</strong><span>{analysis.disclaimer}</span></div>
            <button className="button primary" type="button" disabled={analysis.decision !== 'accepted'} onClick={confirmAnalysis}><CheckCheck size={17} />검토 결과 확정</button>
          </div>
        </section>
      )}

      {confirmed && (
        <section className="confirmed-card">
          <div className="confirmed-icon"><ClipboardCheck size={22} /></div>
          <div><span>최근 확정 종목 검토</span><h2>{confirmed.companyName}: {confirmed.verdict}</h2><p>{confirmed.oneSentenceThesis}</p></div>
        </section>
      )}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<input value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="full-field">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <article className="stock-summary-card"><span>{label}</span><strong>{value}</strong></article>
}

function ScoreGrid({ scores }: { scores: StockScoreBreakdown }) {
  const labels: Record<keyof StockScoreBreakdown, string> = {
    industryStructure: '산업 구조',
    competitiveAdvantage: '경쟁우위',
    financialQuality: '재무제표',
    valuation: '밸류에이션',
    managementCapitalAllocation: '자본배분',
    riskControl: '리스크 관리',
  }

  return (
    <div className="stock-score-grid">
      {(Object.keys(scores) as Array<keyof StockScoreBreakdown>).map((key) => {
        const score = scores[key]
        const maximum = stockScoreMaximums[key]
        return (
          <article key={key}>
            <div><span>{labels[key]}</span><strong>{score === null ? '보류' : `${score}/${maximum}`}</strong></div>
            <div className="score-track"><i style={{ width: `${score === null ? 0 : (score / maximum) * 100}%` }} /></div>
          </article>
        )
      })}
    </div>
  )
}

function ListPanel({ title, items, tone = '', emptyText = '표시할 항목이 없습니다.' }: { title: string; items: string[]; tone?: string; emptyText?: string }) {
  return (
    <article className={`stock-list-panel ${tone}`}>
      <h3>{title}</h3>
      {items.length > 0 ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{emptyText}</p>}
    </article>
  )
}
