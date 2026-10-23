import { Component } from 'react';
import { ErrorState } from './ui.jsx';

export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(error); } // eslint-disable-line no-console
  render() {
    if (this.state.error) return <ErrorState title="This page hit a problem" error={{ message: 'An unexpected error occurred while showing this page.' }} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
