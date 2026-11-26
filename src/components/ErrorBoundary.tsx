import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'An unexpected application error occurred.';
    if (readable.startsWith('{') && readable.includes('"operationType"')) {
      try {
        const parsed = JSON.parse(readable) as { error?: string; operationType?: string };
        readable = parsed.error || `Database ${parsed.operationType || 'operation'} failed.`;
      } catch {
        // keep original
      }
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-[#08111F] text-[#EEF5FF] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#F05252]/40 bg-[#111E31] p-7 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#F05252]/15 text-[#F05252]">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-[#EEF5FF]">
              Something went wrong
            </h1>
            <p className="text-sm text-[#9BB0CA] break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#51D6E8] px-5 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef]"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
