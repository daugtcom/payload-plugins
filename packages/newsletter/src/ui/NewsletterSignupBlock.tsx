import type { ReactNode } from 'react'
import { NewsletterSignup } from './NewsletterSignup'

/** The reusable signup block; sites supply their own layout, heading and privacy text. */
export function NewsletterSignupBlock({ title, description, privacy, className = '', contentClassName = '', headingClassName = '', descriptionClassName = '', formClassName = '' }: {
  title?: string | null; description?: string | null; privacy?: ReactNode
  className?: string; contentClassName?: string; headingClassName?: string; descriptionClassName?: string; formClassName?: string
}) {
  return <div className={className}><div className={contentClassName}><div><h2 className={headingClassName}>{title || ''}</h2><p className={descriptionClassName}>{description || ''}</p></div><div className={formClassName}><NewsletterSignup />{privacy}</div></div></div>
}
