import axios from "axios";
import type { AxiosRequestConfig, AxiosError } from "axios";

const TOKEN_KEY = "auth_token";

let inMemoryAuthToken: string | null = null;

export const getStoredToken = () => inMemoryAuthToken || localStorage.getItem(TOKEN_KEY);
export const storeToken = (token: string) => {
  inMemoryAuthToken = token;
  localStorage.setItem(TOKEN_KEY, token);
};
export const clearToken = () => {
  inMemoryAuthToken = null;
  localStorage.removeItem(TOKEN_KEY);
};

const AXIOS_INSTANCE = axios.create({ baseURL: "/api" });

AXIOS_INSTANCE.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const impToken = sessionStorage.getItem("impersonation_token");
  if (impToken) config.headers["X-ImpersonationToken"] = impToken;
  return config;
});

AXIOS_INSTANCE.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      const isAdminPage = window.location.pathname.startsWith("/x/");
      if (isAdminPage) {
        window.dispatchEvent(new CustomEvent("admin-reauth-required"));
        return Promise.reject(error);
      }
      clearToken();
      const detail = error.response?.data?.detail;
      const msg =
        typeof detail === "string" ? detail : "Tu sesion expiro. Iniciá sesion nuevamente.";
      sessionStorage.setItem("auth_error", msg);
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => {
  return AXIOS_INSTANCE({ ...config, ...options }).then(({ data }) => data);
};

export type ErrorType<Error> = AxiosError<Error>;
export type BodyType<BodyData> = BodyData;

export default AXIOS_INSTANCE;
