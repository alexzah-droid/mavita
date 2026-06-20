import Image from 'next/image'
import Link from 'next/link'

// Единый подвал сайта: контакты, юридические реквизиты продавца и ссылки на
// оферту и политику. Реквизиты и контакты обязательны для приёма платежей
// (требование Робокассы и 152-ФЗ), поэтому подвал ставится на все страницы витрины.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <div className="footer-brand">
            <Image src="/images/logo.png" alt="МАВИТА" width={32} height={32} className="footer-logo" />
            <span className="footer-brand-name">МАВИТА</span>
          </div>
          <p className="footer-tagline">Тишина, которую можно зажечь.</p>
          <div className="footer-contacts">
            <a href="mailto:mavitasvechi@mail.ru" className="footer-contact">
              <span>Почта</span>
              <em>mavitasvechi@mail.ru</em>
            </a>
            <a href="tel:+79211899008" className="footer-contact">
              <span>Телефон</span>
              <em>+7 921 189-90-08</em>
            </a>
            <a href="https://vk.com/mavitasvechi" className="footer-contact" target="_blank" rel="noopener noreferrer">
              <span>ВКонтакте</span>
              <em>vk.com/mavitasvechi</em>
            </a>
          </div>
        </div>
        <div className="footer-right">
          <div className="footer-qr-hint">Ритуал восстановления</div>
          <p className="footer-mission">
            Помогать людям возвращаться к себе через контакт с природой — даже если они живут в центре мегаполиса.
          </p>
          <nav className="footer-legal">
            <Link href="/delivery">Доставка</Link>
            <Link href="/offer">Публичная оферта</Link>
            <Link href="/privacy">Политика конфиденциальности</Link>
          </nav>
        </div>
      </div>

      <div className="footer-requisites">
        Захарова Виктория Борисовна · Плательщик НПД (самозанятый) · ИНН 783903348620
      </div>

      <div className="footer-copy">
        <span>© 2026 МАВИТА · Ручная работа</span>
        <span>МА — Земля · ВИТА — Жизнь</span>
      </div>
    </footer>
  )
}
