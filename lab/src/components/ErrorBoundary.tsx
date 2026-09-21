import { Component, type ReactNode, type ErrorInfo } from 'react';

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || '', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-300">
          <div className="mb-1 font-semibold">
            {this.props.label || 'Render error'}
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-red-200">
            {this.state.error.message}
          </pre>
          {this.state.error.stack && (
            <details className="mt-2">
              <summary className="cursor-pointer text-red-300/80">stack</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-red-200/80">
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded border border-red-500/50 px-2 py-1 text-[10px] hover:bg-red-500/20"
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
