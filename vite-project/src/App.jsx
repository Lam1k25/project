import { useEffect, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const TOKEN_KEY = 'messenger-session-token'

async function requestJson(path, token, options = {}) {
  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data?.detail
    throw new Error(
      Array.isArray(detail)
        ? detail.map((item) => item.msg || JSON.stringify(item)).join('; ')
        : detail || 'Не удалось выполнить запрос.',
    )
  }
  return data
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return undefined

    let active = true
    requestJson('/auth/me', token)
      .then((profile) => {
        if (active) setUser(profile)
      })
      .catch((requestError) => {
        if (!active) return
        sessionStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setUser(null)
        setError(requestError.message)
      })

    return () => {
      active = false
    }
  }, [token])

  async function handleAuth(event) {
    event.preventDefault()
    setError('')
    setStatus('')
    setIsSubmitting(true)

    const formData = new FormData(event.currentTarget)
    const payload = {
      email: formData.get('email').trim(),
      password: formData.get('password'),
    }
    if (isRegistering) payload.name = formData.get('name').trim()

    try {
      const session = await requestJson(
        isRegistering ? '/auth/register' : '/auth/login',
        null,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      sessionStorage.setItem(TOKEN_KEY, session.token)
      setToken(session.token)
      setUser(session.user)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleProfileUpdate(event) {
    event.preventDefault()
    setError('')
    setStatus('')
    const formData = new FormData(event.currentTarget)
    try {
      const profile = await requestJson('/auth/me', token, {
        method: 'PATCH',
        body: JSON.stringify({
          name: formData.get('name').trim(),
          email: formData.get('email').trim(),
        }),
      })
      setUser(profile)
      setStatus('Профиль обновлён.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault()
    setError('')
    setStatus('')
    const form = event.currentTarget
    const formData = new FormData(event.currentTarget)
    try {
      const session = await requestJson('/auth/change-password', token, {
        method: 'POST',
        body: JSON.stringify({
          current_password: formData.get('current_password'),
          new_password: formData.get('new_password'),
        }),
      })
      sessionStorage.setItem(TOKEN_KEY, session.token)
      setToken(session.token)
      setUser(session.user)
      form.reset()
      setStatus('Пароль изменён. Остальные активные сессии завершены.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function handleLogout() {
    try {
      await requestJson('/auth/logout', token, { method: 'POST' })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      sessionStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setUser(null)
    }
  }

  return (
    <main className="registration-page">
      <section className="registration-card">
        <p className="eyebrow">Corporate Messenger</p>
        {user ? (
          <>
            <h1>Управление аккаунтом</h1>
            <p className="description">Вы вошли как {user.email}.</p>
            <form className="registration-form" onSubmit={handleProfileUpdate}>
              <label htmlFor="profile-name">Имя</label>
              <input
                id="profile-name"
                name="name"
                autoComplete="name"
                maxLength="80"
                required
                defaultValue={user.name}
              />
              <label htmlFor="profile-email">Электронная почта</label>
              <input
                id="profile-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength="254"
                required
                defaultValue={user.email}
              />
              <button type="submit">Сохранить профиль</button>
            </form>

            <form className="registration-form" onSubmit={handlePasswordChange}>
              <h2>Смена пароля</h2>
              <label htmlFor="current-password">Текущий пароль</label>
              <input
                id="current-password"
                name="current_password"
                type="password"
                autoComplete="current-password"
                maxLength="128"
                required
              />
              <label htmlFor="new-password">Новый пароль (не менее 10 символов)</label>
              <input
                id="new-password"
                name="new_password"
                type="password"
                autoComplete="new-password"
                minLength="10"
                maxLength="128"
                required
              />
              <button type="submit">Сменить пароль</button>
            </form>
            <button type="button" className="secondary-button" onClick={handleLogout}>
              Выйти
            </button>
          </>
        ) : (
          <>
            <h1>{isRegistering ? 'Регистрация' : 'Вход в аккаунт'}</h1>
            <p className="description">
              {isRegistering
                ? 'Создайте аккаунт, чтобы начать переписку.'
                : 'Войдите, чтобы управлять аккаунтом и открыть чаты.'}
            </p>
            <form className="registration-form" onSubmit={handleAuth}>
              {isRegistering && (
                <>
                  <label htmlFor="name">Имя</label>
                  <input
                    id="name"
                    name="name"
                    autoComplete="name"
                    maxLength="80"
                    required
                  />
                </>
              )}
              <label htmlFor="email">Электронная почта</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength="254"
                required
              />
              <label htmlFor="password">Пароль</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                minLength={isRegistering ? 10 : 1}
                maxLength="128"
                required
              />
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? 'Отправка…'
                  : isRegistering
                    ? 'Создать аккаунт'
                    : 'Войти'}
              </button>
            </form>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setIsRegistering(!isRegistering)
                setError('')
              }}
            >
              {isRegistering
                ? 'Уже есть аккаунт? Войти'
                : 'Нет аккаунта? Зарегистрироваться'}
            </button>
          </>
        )}

        {status && <p className="feedback success" role="status">{status}</p>}
        {error && <p className="feedback error" role="alert">{error}</p>}
      </section>
    </main>
  )
}

export default App
