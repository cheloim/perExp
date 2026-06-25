import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyGroup } from "../api/client";

interface FamilyMember {
  id: number;
  name: string;
}

interface FamilyGroupContextValue {
  members: FamilyMember[];
  isLoading: boolean;
}

const FamilyGroupContext = createContext<FamilyGroupContextValue>({
  members: [],
  isLoading: false,
});

export function FamilyGroupProvider({ children }: { children: React.ReactNode }) {
  const { data: group, isLoading } = useQuery({
    queryKey: ["my-group"],
    queryFn: getMyGroup,
    staleTime: 300_000,
  });

  const members: FamilyMember[] =
    group?.members?.map((m) => ({
      id: m.user_id,
      name: m.full_name,
    })) ?? [];

  return (
    <FamilyGroupContext.Provider value={{ members, isLoading }}>
      {children}
    </FamilyGroupContext.Provider>
  );
}

export function useFamilyGroup() {
  return useContext(FamilyGroupContext);
}
