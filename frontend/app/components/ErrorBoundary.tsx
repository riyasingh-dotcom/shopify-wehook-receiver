'use client'

import React from 'react'
import { Banner } from '@shopify/polaris'

type Props = { children: React.ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Unhandled render error:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <Banner
          tone="critical"
          title="Something went wrong"
          action={{
            content: 'Reload page',
            onAction: () => window.location.reload(),
          }}
        >
          <p>An unexpected error occurred. You can reload the page to try again.</p>
        </Banner>
      )
    }

    return this.props.children
  }
}
