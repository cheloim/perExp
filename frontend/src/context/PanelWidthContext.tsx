import { createContext, useContext, useState } from 'react'

interface PanelWidthContextType {
  panelWidth: number
  isCollapsed: boolean
  setPanelWidth: (w: number) => void
  setIsCollapsed: (c: boolean) => void
}

const PanelWidthContext = createContext<PanelWidthContextType>({
  panelWidth: 360,
  isCollapsed: false,
  setPanelWidth: () => {},
  setIsCollapsed: () => {},
})

export function PanelWidthProvider({ children }: { children: React.ReactNode }) {
  const [panelWidth, setPanelWidth] = useState(360)
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <PanelWidthContext.Provider value={{ panelWidth, isCollapsed, setPanelWidth, setIsCollapsed }}>
      {children}
    </PanelWidthContext.Provider>
  )
}

export function usePanelWidth() {
  return useContext(PanelWidthContext)
}