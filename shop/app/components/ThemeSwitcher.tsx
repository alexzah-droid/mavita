'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark-green' | 'svet' | 'kamen'

const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark-green', label: 'Тёмная' },
  { id: 'svet', label: 'Свет' },
  { id: 'kamen', label: 'Камень' },
]

const STORAGE_KEY = 'mavita-theme'

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>('dark-green')

  // Восстанавливаем выбор пользователя на клиенте.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
    if (saved && THEMES.some((t) => t.id === saved)) {
      setTheme(saved)
      applyTheme(saved)
    } else {
      applyTheme('dark-green')
    }
  }, [])

  function choose(next: Theme) {
    setTheme(next)
    applyTheme(next)
    localStorage.setItem(STORAGE_KEY, next)
  }

  return (
    <div className="theme-switcher" role="group" aria-label="Оформление каталога">
      <span className="theme-switcher-label">Тема</span>
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === theme ? 'active' : undefined}
          aria-pressed={t.id === theme}
          onClick={() => choose(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
