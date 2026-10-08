import { Component, type ReactNode } from "react";

/** Keeps one broken card from blanking the page. Changing `resetKey` (a new tab, a new run) clears the error. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-medium">This panel hit an unexpected error.</p>
        <p className="mt-1 text-xs">{this.state.error.message}</p>
        <p className="mt-1 text-xs">The rest of the page still works. Your run and its data are not affected.</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-medium">
          Try again
        </button>
      </div>
    );
  }
}
