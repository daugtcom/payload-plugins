const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const

export const ChevronIcon = ({ className }: { className?: string }) => <svg {...base} className={className}><path d="m6 9 6 6 6-6" /></svg>
export const LockIcon = ({ className }: { className?: string }) => <svg {...base} className={className}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
export const UnlockIcon = ({ className }: { className?: string }) => <svg {...base} className={className}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></svg>
export const FileIcon = ({ className }: { className?: string }) => <svg {...base} className={className}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
export const BagIcon = ({ className }: { className?: string }) => <svg {...base} className={className}><path d="M6 7h12l1 13H5z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>
