import { previewScreens, previewStates } from "./previewCatalog";

export const designScreens = [
  ["landing", "Landing page"],
  ["components", "Components"],
  ...previewScreens.map(({ id, name }) => [id, name] as const),
  ["agent-log", "Agent log"],
  ["social", "Social preview"],
] as const;

export function designStates(screen: string) {
  if (["landing", "components", "social", "agent-log"].includes(screen)) return ["playing"];

  return previewStates(screen);
}

export function isFlowState(state: string) {
  return (
    state === "signed-out" ||
    state.startsWith("auth-") ||
    state.startsWith("lobby-") ||
    ["room-setup", "host-spectating", "leave-confirmation", "action-error"].includes(state)
  );
}
