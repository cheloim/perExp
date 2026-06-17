import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <span className="text-4xl mb-4">⚠️</span>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Algo salió mal
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4 max-w-md">
            {this.state.error?.message || "Ocurrió un error inesperado"}
          </p>
          <button
            onClick={this.handleRetry}
            className="gnome-btn-primary"
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
