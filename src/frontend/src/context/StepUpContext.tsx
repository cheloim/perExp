import { createContext, useCallback, useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "../api/client";
import StepUpModal from "../components/StepUpModal";

type StepUpContextValue = {
  requireStepUp: (action: () => void) => void;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 60_000 });

  const requireStepUp = useCallback((action: () => void) => {
    setPendingAction(() => action);
  }, []);

  const handleAuthenticated = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    action?.();
  }, [pendingAction]);

  return (
    <StepUpContext.Provider value={{ requireStepUp }}>
      {children}
      {pendingAction && (
        <StepUpModal
          mfaEnabled={Boolean(user?.mfa_enabled)}
          onAuthenticated={handleAuthenticated}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const context = useContext(StepUpContext);
  if (!context) throw new Error("useStepUp must be used inside StepUpProvider");
  return context;
}
