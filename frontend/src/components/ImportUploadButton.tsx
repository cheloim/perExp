import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createImportJob } from '../api/client'
import { sidebarIcons } from './SidebarIcons'
import { useUploadProgress } from '../context/UploadProgressContext'

export default function ImportUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { addUpload, updateUpload } = useUploadProgress()

  const uploadMutation = useMutation({
    mutationFn: (file: File) => createImportJob(file),
    onSuccess: () => {
      // Invalidar notificaciones para que se actualice el contador
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-count'] })
    }
  })

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Procesar archivos uno por uno
    for (const file of Array.from(files)) {
      const uploadId = addUpload(file.name)
      const abortController = new AbortController()

      // Store abort controller in upload state
      updateUpload(uploadId, { abortController })

      try {
        // Pass abort signal to createImportJob
        const job = await createImportJob(file, abortController.signal)
        // Actualizar a processing (el backend ya tiene el job)
        updateUpload(uploadId, { status: 'processing', jobId: job.id })
      } catch (error: any) {
        // Handle abort error
        if (error.name === 'AbortError' || error.name === 'CanceledError') {
          updateUpload(uploadId, { status: 'failed', error: 'Cancelado' })
        } else {
          // Marcar como fallido
          updateUpload(uploadId, { status: 'failed', error: error.message })
        }
      }
    }

    // Limpiar input
    e.target.value = ''
  }

  return (
    <>
      <button
        onClick={handleClick}
        title="Importar archivos"
        className="group/import w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-all duration-150"
      >
        <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
          {sidebarIcons.import}
        </span>
        <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
          Importar
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.csv,.xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
      />
    </>
  )
}
