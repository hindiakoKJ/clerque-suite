'use client';

/**
 * Demo Error Boundary
 *
 * When in demo mode, catches React render errors and shows them visibly
 * with a "Reset Demo" CTA, instead of letting Chrome show a blank
 * "This page couldn't load" renderer-crash page.
 *
 * In production (non-demo), passes through to children — real users get
 * the standard Next.js error.tsx flow.
 */

import React, { Component, type ReactNode } from 'react';
import { isDemoMode } from '@/lib/demo/config';
import { useDemoStore } from '@/lib/demo/store';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack?: string | null } | null;
  inDemo: boolean;
}

export class DemoErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null, inDemo: false };

  componentDidMount() {
    this.setState({ inDemo: isDemoMode() });
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string | null }) {
    // Log to console with maximum visibility — this helps developers diagnose
    // shape mismatches between demoApi mock responses and page expectations.
    console.error('[DemoErrorBoundary] caught render error:', error);
    if (errorInfo.componentStack) {
      console.error('[DemoErrorBoundary] component stack:', errorInfo.componentStack);
    }
    this.setState({ errorInfo });
  }

  handleReset = () => {
    try {
      useDemoStore.getState().reset();
    } catch {
      /* ignore */
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/demo?reset=1';
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    // Only show fallback when in demo mode AND there's an error.  Real users
    // hit Next.js's default error UI.
    if (this.state.hasError && this.state.inDemo) {
      const stackPreview = (this.state.error?.stack ?? this.state.error?.message ?? '')
        .split('\n')
        .slice(0, 6)
        .join('\n');

      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4 py-8">
          <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-6 sm:p-8 border border-amber-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xl">
                🎬
              </div>
              <div>
                <h2 className="font-semibold text-lg text-stone-900">
                  Demo hit a snag
                </h2>
                <p className="text-sm text-stone-600">
                  This page tripped on a shape mismatch in the demo data.
                </p>
              </div>
            </div>

            <details className="mb-4 bg-stone-100 rounded-lg p-3 text-xs font-mono text-stone-700 overflow-auto">
              <summary className="cursor-pointer text-stone-800 font-semibold">
                Show error details
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{stackPreview}</pre>
            </details>

            <p className="text-sm text-stone-700 mb-5">
              You can reset the demo to a fresh state, or go back and try a
              different page. None of your data left this browser tab.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg"
              >
                Reset Demo
              </button>
              <button
                onClick={this.handleRetry}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-sm font-medium rounded-lg"
              >
                Try Again
              </button>
              <a
                href="/demo"
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-sm font-medium rounded-lg"
              >
                Go to Demo Home
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
