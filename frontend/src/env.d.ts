/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    ux_mode?: "popup" | "redirect";
    login_uri?: string;
  }): void;
  prompt(
    callback?: (notification: {
      isNotDisplayed: () => boolean;
      isSkippedMoment: () => boolean;
    }) => void,
  ): void;
  renderButton(
    element: HTMLElement,
    options: {
      theme?: string;
      size?: string;
      width?: string;
      text?: string;
    },
  ): void;
}

interface GoogleCodeClient {
  requestCode(): void;
}

interface GoogleAccountsOauth2 {
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode: "popup" | "redirect";
    redirect_uri: string;
    state?: string;
  }): GoogleCodeClient;
}

interface GoogleAccounts {
  id: GoogleAccountsId;
  oauth2: GoogleAccountsOauth2;
}

interface Window {
  google?: {
    accounts: GoogleAccounts;
  };
}
