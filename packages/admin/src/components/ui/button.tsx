// Adapted from shadcn/ui (new-york). Differences from the upstream source, all
// forced by docs/adr/0019:
//   - every utility carries the `lt:` prefix; an unprefixed class emits no CSS
//   - shadow scale uses the Tailwind v4 names (`shadow` -> `shadow-sm`)
//   - hover states use --lontar-primary-hover / --lontar-danger-hover, the
//     admin's existing tokens, instead of an opacity modifier
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'lt:inline-flex lt:items-center lt:justify-center lt:gap-2 lt:whitespace-nowrap lt:rounded-md lt:text-sm lt:font-medium lt:transition-colors lt:focus-visible:outline-none lt:focus-visible:ring-1 lt:focus-visible:ring-ring lt:disabled:pointer-events-none lt:disabled:opacity-50 lt:[&_svg]:pointer-events-none lt:[&_svg]:size-4 lt:[&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'lt:bg-primary lt:text-primary-foreground lt:shadow-sm lt:hover:bg-primary-hover',
        destructive:
          'lt:bg-destructive lt:text-destructive-foreground lt:shadow-xs lt:hover:bg-destructive-hover',
        outline:
          'lt:border lt:border-input lt:bg-background lt:shadow-xs lt:hover:bg-accent lt:hover:text-accent-foreground',
        secondary:
          'lt:bg-secondary lt:text-secondary-foreground lt:shadow-xs lt:hover:bg-secondary/80',
        ghost: 'lt:hover:bg-accent lt:hover:text-accent-foreground',
        link: 'lt:text-primary lt:underline-offset-4 lt:hover:underline',
      },
      size: {
        default: 'lt:h-9 lt:px-4 lt:py-2',
        sm: 'lt:h-8 lt:rounded-md lt:px-3 lt:text-xs',
        lg: 'lt:h-10 lt:rounded-md lt:px-8',
        icon: 'lt:h-9 lt:w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
