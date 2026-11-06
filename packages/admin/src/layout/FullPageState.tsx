import type { ReactNode } from 'react'

// Full-viewport loading and error screens, shown before the admin layout exists
// (while the config loads) and while the session is being checked.

const screen =
  'lt:flex lt:min-h-screen lt:flex-col lt:items-center lt:justify-center lt:p-8 lt:text-center'

// `lontar-spin` is the stylesheet's own keyframes. Tailwind's `animate-spin`
// would emit a global `@keyframes spin`, which the scoped-CSS build check
// rejects (docs/adr/0019).
function Spinner() {
  return (
    <div
      aria-hidden="true"
      className="lt:size-8 lt:animate-[lontar-spin_0.8s_linear_infinite] lt:rounded-full lt:border-[3px] lt:border-border lt:border-t-primary"
    />
  )
}

export function FullPageLoading({ children }: { children: ReactNode }) {
  return (
    <div className={screen}>
      <Spinner />
      <p className="lt:mt-4 lt:mb-0 lt:text-muted-foreground">{children}</p>
    </div>
  )
}

export function FullPageError({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={screen}>
      <h2 className="lt:mt-0 lt:mb-2 lt:text-error-text">{title}</h2>
      <p className="lt:m-0 lt:text-muted-foreground">{children}</p>
    </div>
  )
}
