import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[panel crash]', err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="crash-card">
        <span className="crash-ico">🛠️</span>
        <b>This section hit a snag</b>
        <i>{String(this.state.err.message || this.state.err)}</i>
        <div className="crash-acts">
          <button onClick={() => this.setState({ err: null })}>Try again</button>
          <button className="ghost" onClick={() => { try { localStorage.removeItem('scanprint_session'); } catch (e) {} location.reload(); }}>Reset session</button>
        </div>
      </div>
    );
  }
}
