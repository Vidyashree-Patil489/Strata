import { Component, type ErrorInfo, type ReactNode } from "react";
import { StrataMark } from "./StrataMark";

interface Props { children: ReactNode; }
interface State { hasError: boolean; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <StrataMark size={36} className="mx-auto" />
          <h1 className="mt-6 text-[22px] font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
            An unexpected error occurred. Try refreshing the page — if it keeps
            happening, please report it.
          </p>

          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="clay-btn clay-btn-primary px-4 py-2 text-[13px]"
            >
              Refresh page
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              className="clay-btn px-4 py-2 text-[13px]"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
