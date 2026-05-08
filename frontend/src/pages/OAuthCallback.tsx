import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { oauthCallback, storeToken } from '../api/client'

export default function OAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    const errorParam = searchParams.get('error')

    if (errorParam) {
      setError('Permiso denegado por Google')
      return
    }

    if (code) {
      oauthCallback('google', code)
        .then((token) => {
          storeToken(token.access_token)
          navigate('/')
        })
        .catch((err) => {
          setError(err?.response?.data?.detail || 'Error en autenticación')
        })
    } else {
      setError('Código no recibido')
    }
  }, [searchParams, navigate])

  if (error) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg p-8 text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <a href="/login" className="text-[var(--color-primary)] hover:underline">
            Volver al login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="text-[var(--text-secondary)]">Autenticando con Google...</div>
    </div>
  )
}