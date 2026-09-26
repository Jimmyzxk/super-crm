"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  pluginKey: string;
  mountPoint: string;
};

type State = { failed: boolean };

export default class PluginMountBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("plugin mount failed", {
      pluginKey: this.props.pluginKey,
      mountPoint: this.props.mountPoint,
      error,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
