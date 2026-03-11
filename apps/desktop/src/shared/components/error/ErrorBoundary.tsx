import React, { Component, ErrorInfo, ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children?: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in ErrorBoundary:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className={styles.container}>
          <div className={styles.content}>
            <h2>Something went wrong</h2>
            <p className={styles.message}>
              {this.props.fallbackMessage || "An unexpected error occurred in this workspace component."}
            </p>
            {this.state.error && (
              <pre className={styles.stackTrace}>
                {this.state.error.message}
              </pre>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.actionBtn} onClick={this.handleReset}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
