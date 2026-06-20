'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
export default function AdminLoginPage() {
  const router = useRouter(); const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); setBusy(false); if (response.ok) router.replace('/admin'); else { const body = await response.json().catch(() => null); setMessage(body?.error?.messages?.[0] ?? 'Не удалось выполнить вход') } }
  return <main className="admin-shell"><form className="admin-card" onSubmit={submit}><p className="admin-kicker">МАВИТА · АДМИНКА</p><h1>Вход</h1><label>Пароль<input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{message && <p className="admin-error">{message}</p>}<button className="admin-button" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button></form></main>
}
