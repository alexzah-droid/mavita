// Рекомендации по обращению со свечой — единый источник текста для карточки
// товара (сворачиваемый блок) и страницы оплаченного заказа.

const TIPS: { lead: string; rest: string }[] = [
  {
    lead: 'Первое зажигание — не меньше полутора часов.',
    rest: 'Воск расплавится до краёв, свеча будет гореть ровно, без «туннеля».',
  },
  {
    lead: 'Перед каждым зажиганием подрезайте фитиль до 6–8 мм,',
    rest: 'снимая образовавшийся «грибок», — пламя будет ровным и спокойным, без копоти.',
  },
  {
    lead: 'Не жгите свечу дольше 3–4 часов подряд',
    rest: '— перегретый воск хуже отдаёт аромат.',
  },
  {
    lead: 'Не задувайте — накройте крышкой',
    rest: 'или воспользуйтесь пламегасителем-колокольчиком. Без дыма аромат останется чистым.',
  },
  {
    lead: 'Ставьте свечу на устойчивую жаропрочную поверхность,',
    rest: 'вдали от штор, сквозняков и всего, что легко воспламеняется.',
  },
]

function TipsList() {
  return (
    <ul className="care-tips-list">
      {TIPS.map((tip) => (
        <li key={tip.lead}>
          <strong>{tip.lead}</strong> {tip.rest}
        </li>
      ))}
    </ul>
  )
}

export default function CandleCareTips({ variant }: { variant: 'product' | 'order' }) {
  if (variant === 'order') {
    return (
      <div className="order-card">
        <div className="order-card-head">Пока свеча едет к вам</div>
        <p className="care-tips-intro">
          Несколько простых правил — и свеча раскроет аромат в полную силу и прослужит дольше.
        </p>
        <TipsList />
      </div>
    )
  }

  return (
    <details className="product-care">
      <summary className="product-care-summary">Как обращаться со свечой</summary>
      <div className="product-care-body">
        <p className="care-tips-intro">
          Несколько простых правил — и свеча раскроет аромат в полную силу и прослужит дольше.
        </p>
        <TipsList />
      </div>
    </details>
  )
}
