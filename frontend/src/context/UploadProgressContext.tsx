import { createContext, useContext, useState, ReactNode } from 'react'
import type { UploadProgress } from '../types'

interface UploadProgressContextType {
  uploads: UploadProgress[]
  addUpload: (filename: string) => string
  updateUpload: (id: string, updates: Partial<UploadProgress>) => void
  removeUpload: (id: string) => void
  cancelUpload: (id: string) => void
}

const UploadProgressContext = createContext<UploadProgressContextType | undefined>(undefined)

export function UploadProgressProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<UploadProgress[]>([])

  const addUpload = (filename: string): string => {
    const id = crypto.randomUUID()
    setUploads(prev => [...prev, { id, filename, status: 'uploading' }])
    return id
  }

  const updateUpload = (id: string, updates: Partial<UploadProgress>) => {
    setUploads(prev => prev.map(u => (u.id === id ? { ...u, ...updates } : u)))
  }

  const removeUpload = (id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id))
  }

  const cancelUpload = (id: string) => {
    const upload = uploads.find(u => u.id === id)
    if (upload?.abortController) {
      upload.abortController.abort()
      updateUpload(id, { status: 'failed', error: 'Cancelado por el usuario' })
    }
  }

  return (
    <UploadProgressContext.Provider value={{ uploads, addUpload, updateUpload, removeUpload, cancelUpload }}>
      {children}
    </UploadProgressContext.Provider>
  )
}

export function useUploadProgress() {
  const context = useContext(UploadProgressContext)
  if (!context) {
    throw new Error('useUploadProgress must be used within UploadProgressProvider')
  }
  return context
}
