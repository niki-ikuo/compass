/** Animated "..." for in-progress status labels. */
export function AnimatedEllipsis() {
  return (
    <span className="animated-ellipsis" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  )
}

/** Status text with trailing animated dots, e.g. 送信中… */
export function AnimatedStatus({ label }: { label: string }) {
  return (
    <span className="animated-status">
      {label}
      <AnimatedEllipsis />
    </span>
  )
}
