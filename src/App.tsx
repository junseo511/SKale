import {
  ArrowRight,
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  PieChart,
  ReceiptText,
  Sparkles,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { LocalAssetReviewRepository } from './data/localAssetReviewRepository'
import { LocalPortfolioReviewRepository } from './data/localPortfolioReviewRepository'
import { LocalSpendingReviewRepository } from './data/localSpendingReviewRepository'
import { LocalStockReviewRepository } from './data/localStockReviewRepository'
import { HttpAssetAgent } from './data/httpAssetAgent'
import { HttpPortfolioAgent } from './data/httpPortfolioAgent'
import { HttpSpendingAgent } from './data/httpSpendingAgent'
import { HttpStockAgent } from './data/httpStockAgent'
import { calculateAssetSummary, type AssetProposal } from './domain/assets'
import {
  calculateExpenseTotal,
  type SpendingProposal,
} from './domain/spending'
import { AssetAgentWorkspace } from './features/assets/AssetAgentWorkspace'
import { PortfolioAgentWorkspace } from './features/portfolio/PortfolioAgentWorkspace'
import { SpendingAgentWorkspace } from './features/spending/SpendingAgentWorkspace'
import { StockAgentWorkspace } from './features/stocks/StockAgentWorkspace'
import './App.css'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
const spendingAgent = new HttpSpendingAgent({
  baseUrl: apiBaseUrl,
})
const spendingReviewRepository = new LocalSpendingReviewRepository()
const assetAgent = new HttpAssetAgent({ baseUrl: apiBaseUrl })
const assetReviewRepository = new LocalAssetReviewRepository()
const portfolioAgent = new HttpPortfolioAgent({ baseUrl: apiBaseUrl })
const portfolioReviewRepository = new LocalPortfolioReviewRepository()
const stockAgent = new HttpStockAgent({ baseUrl: apiBaseUrl })
const stockReviewRepository = new LocalStockReviewRepository()

const navigationItems = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/spending', label: '소비 분석', icon: ReceiptText },
  { to: '/assets', label: '월급·자산', icon: WalletCards },
  { to: '/portfolio', label: '포트폴리오', icon: PieChart },
  { to: '/stocks', label: '종목 분석', icon: TrendingUp },
]

const chartColors = ['#6c5ce7', '#00a896', '#f4a261', '#e76f51', '#457b9d']

function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/spending" element={<SpendingPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}

function AppLayout({ children }: { children: ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" onClick={() => setIsMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>SKale</span>
          </NavLink>

          <nav className="desktop-navigation" aria-label="주요 메뉴">
            {navigationItems.map((item) => (
              <NavLink
                key={item.to}
                className={({ isActive }) => `navigation-link${isActive ? ' active' : ''}`}
                to={item.to}
                end={item.to === '/'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            className="menu-button"
            type="button"
            aria-label={isMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            {isMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {isMenuOpen && (
          <nav className="mobile-navigation" aria-label="모바일 주요 메뉴">
            {navigationItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  className={({ isActive }) => `mobile-navigation-link${isActive ? ' active' : ''}`}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setIsMenuOpen(false)}
                >
                  <Icon size={19} aria-hidden="true" />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>
        )}
      </header>

      <main>{children}</main>

      <footer className="site-footer">
        <p>SKale은 과제 시연용 AI Agent입니다.</p>
        <p>분석 결과는 참고용이며 실제 투자 판단은 사용자의 책임입니다.</p>
      </footer>
    </div>
  )
}

function DashboardPage() {
  const confirmedSpending = spendingReviewRepository.loadLatest()
  const confirmedAssets = assetReviewRepository.loadLatest()
  const expenseTotal = confirmedSpending
    ? calculateExpenseTotal(confirmedSpending.proposals)
    : 0
  const assetSummary = confirmedAssets
    ? calculateAssetSummary(confirmedAssets.proposals)
    : null
  const monthlyInvestmentPlan =
    confirmedAssets?.salaryAllocations?.find(
      (allocation) => allocation.category === '투자',
    )?.amount ?? 0
  const spendingData = buildSpendingChartData(confirmedSpending?.proposals ?? [])
  const assetData = buildAssetChartData(confirmedAssets?.proposals ?? [])

  return (
    <PageContainer>
      <section className="hero-section">
        <div>
          <span className="eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            Personal finance agent
          </span>
          <h1>AI로 소비를 읽고,<br />자산을 키우다.</h1>
          <p>흩어진 돈의 흐름을 한눈에 이해하고 다음 행동까지 발견하세요.</p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-core">
            <TrendingUp size={36} />
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label="자산 요약">
        <MetricCard
          icon={<ReceiptText />}
          label="확정 소비"
          value={confirmedSpending ? `${expenseTotal.toLocaleString()}원` : '분석 전'}
          detail="사용자가 수락한 소비만 반영"
          tone="coral"
        />
        <MetricCard
          icon={<WalletCards />}
          label="확정 순자산"
          value={assetSummary ? `${assetSummary.netWorth.toLocaleString()}원` : '분석 전'}
          detail="승인된 자산에서 부채를 차감"
          tone="violet"
        />
        <MetricCard
          icon={<CircleDollarSign />}
          label="투자 여력"
          value={
            monthlyInvestmentPlan > 0
              ? `${monthlyInvestmentPlan.toLocaleString()}원`
              : '추가 정보 필요'
          }
          detail="확정한 월급 배분안의 투자 금액"
          tone="teal"
        />
      </section>

      <section className="dashboard-grid">
        <ChartCard title="카테고리별 지출" description="일반 소비만 집계했어요.">
          {spendingData.length > 0 ? <div className="chart-with-legend">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie data={spendingData} dataKey="value" innerRadius={55} outerRadius={78} paddingAngle={3} stroke="none">
                    {spendingData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toLocaleString()}원`} />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="donut-center"><strong>{formatCompactWon(expenseTotal)}</strong><span>확정 소비</span></div>
            </div>
            <ul className="chart-legend">
              {spendingData.map((item) => (
                <li key={item.name}>
                  <span className="legend-label"><i style={{ background: item.color }} />{item.name}</span>
                  <strong>{Math.round((item.value / expenseTotal) * 100)}%</strong>
                </li>
              ))}
            </ul>
          </div> : <DashboardEmptyState to="/spending" message="소비 내역을 AI와 검토하면 차트가 표시돼요." />}
        </ChartCard>

        <ChartCard title="자산 구성" description="부채를 제외한 총자산 기준이에요.">
          {assetData.length > 0 ? <div className="bar-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assetData} margin={{ top: 18, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eceaf3" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value / 1_000_000}M`} />
                <Tooltip formatter={(value) => `${Number(value).toLocaleString()}원`} cursor={{ fill: '#f7f6fb' }} />
                <Bar dataKey="value" fill="#6c5ce7" radius={[8, 8, 0, 0]} barSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </div> : <DashboardEmptyState to="/assets" message="자산 현황을 AI와 검토하면 구성이 표시돼요." />}
        </ChartCard>
      </section>

      <section className="insight-card">
        <div className="insight-icon"><Sparkles size={22} /></div>
        <div>
          <span className="section-kicker">SKale AI 코멘트</span>
          <h2>
            {assetSummary
              ? `월급 배분안과 순자산 ${assetSummary.netWorth.toLocaleString()}원을 확정했어요.`
              : '확정된 월급·자산 계획이 아직 없어요.'}
          </h2>
          <p>
            {confirmedAssets?.actionItems[0] ??
              '월급과 자산 현황을 입력하고 AI 제안을 검토해 첫 재무 기준점을 만들어 보세요.'}
          </p>
        </div>
      </section>

      <section>
        <SectionHeading title="지금 하면 좋은 일" description="현재 돈의 흐름을 바탕으로 우선순위를 정리했어요." />
        <div className="action-grid">
          <ActionCard number="01" title="미결제 금액 확인" description="카드 결제 예정 금액을 반영해 실제 가용 현금을 계산하세요." to="/assets" />
          <ActionCard number="02" title="목적 자금 분리" description="여행 지출을 생활비와 분리하면 예산 흐름이 더 선명해져요." to="/spending" />
          <ActionCard number="03" title="관심 종목 점검" description="현금흐름과 밸류에이션 데이터를 준비해 전략 적합도를 확인하세요." to="/stocks" />
        </div>
      </section>
    </PageContainer>
  )
}

function SpendingPage() {
  return (
    <PageContainer>
      <PageHeader
        icon={<ReceiptText />}
        title="소비 분석"
        description="AI가 먼저 제안하고, 사용자가 수정·수락·거절해 함께 소비 기록을 완성해요."
      />
      <SpendingAgentWorkspace
        agent={spendingAgent}
        reviewRepository={spendingReviewRepository}
      />
    </PageContainer>
  )
}

function AssetsPage() {
  return (
    <PageContainer>
      <PageHeader
        icon={<WalletCards />}
        title="월급·자산 관리"
        description="월급과 현재 자산을 함께 입력하고, AI와 월급 배분안과 순자산을 확정해요."
      />
      <AssetAgentWorkspace
        agent={assetAgent}
        reviewRepository={assetReviewRepository}
      />
    </PageContainer>
  )
}

function PortfolioPage() {
  const confirmedAssets = assetReviewRepository.loadLatest()
  const assetSummary = confirmedAssets
    ? calculateAssetSummary(confirmedAssets.proposals)
    : null
  const assetContext = assetSummary
    ? [
        `총자산 ${assetSummary.totalAsset}원`,
        `총부채 ${assetSummary.totalDebt}원`,
        `순자산 ${assetSummary.netWorth}원`,
        `현금성 자산 ${assetSummary.liquidAsset}원`,
        `투자 자산 ${assetSummary.investmentAsset}원`,
        `월 실수령액 ${assetSummary.monthlyIncome}원`,
        `필수 지출 ${assetSummary.essentialExpense}원`,
        `누락 정보: ${confirmedAssets?.missingData.join(', ') || '없음'}`,
      ].join('\n')
    : '사용자가 확정한 자산 분석이 없습니다.'
  const suggestedMonthlyInvestment =
    confirmedAssets?.salaryAllocations?.find(
      (allocation) => allocation.category === '투자',
    )?.amount ?? 300_000

  return (
    <PageContainer>
      <PageHeader
        icon={<PieChart />}
        title="포트폴리오 추천"
        description="AI의 자산 배분 초안을 직접 수정하고 수락하거나 거절해 최종 방향을 결정해요."
      />
      <PortfolioAgentWorkspace
        agent={portfolioAgent}
        reviewRepository={portfolioReviewRepository}
        assetContext={assetContext}
        suggestedMonthlyAmount={suggestedMonthlyInvestment}
      />
    </PageContainer>
  )
}

function StocksPage() {
  return (
    <PageContainer>
      <PageHeader
        icon={<TrendingUp />}
        title="종목 분석"
        description="제공한 정보만으로 전략 적합도를 검토하고, 부족한 데이터는 숨기지 않고 요청해요."
      />
      <StockAgentWorkspace
        agent={stockAgent}
        reviewRepository={stockReviewRepository}
      />
    </PageContainer>
  )
}

function PageContainer({ children }: { children: ReactNode }) {
  return <div className="page-container">{children}</div>
}

function PageHeader({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <header className="page-header"><div className="page-icon">{icon}</div><div><h1>{title}</h1><p>{description}</p></div></header>
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
}

function MetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <article className="chart-card"><SectionHeading title={title} description={description} />{children}</article>
}

function ActionCard({ number, title, description, to }: { number: string; title: string; description: string; to: string }) {
  return <NavLink className="action-card" to={to}><span>{number}</span><h3>{title}</h3><p>{description}</p><ArrowRight size={19} aria-hidden="true" /></NavLink>
}

function DashboardEmptyState({ to, message }: { to: string; message: string }) {
  return (
    <NavLink className="dashboard-empty-state" to={to}>
      <Sparkles size={22} />
      <span>{message}</span>
      <strong>분석 시작하기 <ArrowRight size={15} /></strong>
    </NavLink>
  )
}

function buildSpendingChartData(proposals: SpendingProposal[]) {
  const totals = new Map<string, number>()

  proposals
    .filter(
      (proposal) =>
        proposal.decision === 'accepted' &&
        (proposal.nature === 'expense' || proposal.nature === 'fixedExpense'),
    )
    .forEach((proposal) => {
      const category = proposal.spendingCategory ?? '기타'
      totals.set(category, (totals.get(category) ?? 0) + proposal.amount)
    })

  return [...totals.entries()].map(([name, value], index) => ({
    name,
    value,
    color: chartColors[index % chartColors.length],
  }))
}

function buildAssetChartData(proposals: AssetProposal[]) {
  const totals = new Map<string, number>()

  proposals
    .filter(
      (proposal) =>
        proposal.decision === 'accepted' &&
        proposal.category !== '부채/미결제' &&
        proposal.category !== '반복 수입' &&
        proposal.category !== '필수 지출',
    )
    .forEach((proposal) => {
      const shortName = proposal.category.replace(' 자산', '')
      totals.set(shortName, (totals.get(shortName) ?? 0) + proposal.amount)
    })

  return [...totals.entries()].map(([name, value]) => ({ name, value }))
}

function formatCompactWon(value: number): string {
  if (value >= 10_000) {
    return `${Math.round(value / 10_000).toLocaleString()}만`
  }
  return value.toLocaleString()
}

export default App
