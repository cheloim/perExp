const isDev = import.meta.env.VITE_APP_ENV !== "production";

export const APP_NAME = isDev ? "NikoFin (Dev)" : "NikoFin";
