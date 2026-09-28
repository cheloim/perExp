/**
 * Re-exports the shared Axios instance from client.ts.
 *
 * Previously this file created a separate Axios instance with its own
 * in-memory token, causing auth inconsistencies. Now it delegates to the
 * single source of truth in client.ts.
 */
import type { AxiosRequestConfig, AxiosError } from "axios";

import { api, getStoredToken, storeToken, clearToken } from "./client";

// Re-export auth helpers so generated client imports still work
export { getStoredToken, storeToken, clearToken };

const AXIOS_INSTANCE = api;

export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => {
  return AXIOS_INSTANCE({ ...config, ...options }).then(({ data }) => data);
};

export type ErrorType<Error> = AxiosError<Error>;
export type BodyType<BodyData> = BodyData;

export default AXIOS_INSTANCE;
