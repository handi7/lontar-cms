import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { useComponentRegistry } from '../context/ComponentRegistry'

interface CustomComponentBoundaryProps {
  name: string
  children: ReactNode
}

interface CustomComponentBoundaryState {
  failed: boolean
}

/** Keeps a host component that throws from taking the whole document form down with it. */
class CustomComponentBoundary extends Component<
  CustomComponentBoundaryProps,
  CustomComponentBoundaryState
> {
  override state: CustomComponentBoundaryState = { failed: false }

  static getDerivedStateFromError(): CustomComponentBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[lontar] Custom component "${this.props.name}" crashed:`, error, info)
  }

  override render() {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          className="lt:rounded-md lt:border lt:border-destructive lt:px-3 lt:py-2 lt:text-sm lt:text-destructive"
          data-testid={`custom-component-error-${this.props.name}`}
        >
          Custom component &ldquo;{this.props.name}&rdquo; crashed. See the browser console.
        </div>
      )
    }
    return this.props.children
  }
}

interface MissingComponentProps {
  name: string
}

function MissingComponent({ name }: MissingComponentProps) {
  const { reportMissing } = useComponentRegistry()
  useEffect(() => {
    if (reportMissing(name)) {
      console.warn(
        `[lontar] No component is registered under "${name}". Pass it to <Admin components={{ '${name}': ... }} />.`,
      )
    }
  }, [name, reportMissing])
  return (
    <div
      role="note"
      className="lt:rounded-md lt:border lt:border-dashed lt:px-3 lt:py-2 lt:text-sm lt:text-muted-foreground"
      data-testid={`custom-component-missing-${name}`}
    >
      No component is registered under &ldquo;{name}&rdquo;.
    </div>
  )
}

export interface CustomComponentProps {
  /** The key the config refers to. */
  name: string
  /** Props for the registered component. */
  componentProps: object
}

/** Renders the host component registered under `name`, or a placeholder when there is none. */
export function CustomComponent({ name, componentProps }: CustomComponentProps) {
  const { components } = useComponentRegistry()
  const Registered = Object.hasOwn(components, name) ? components[name] : undefined
  if (!Registered) return <MissingComponent name={name} />
  return (
    <CustomComponentBoundary name={name}>
      <Registered {...componentProps} />
    </CustomComponentBoundary>
  )
}
