interface ActionButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  className?: string
}

export function ActionButton({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  onClick,
  type = 'button',
  className = ''
}: ActionButtonProps) {
  const baseClasses = 'font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2'
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  }
  
  const variantClasses = {
    primary: 'bg-green-500 hover:bg-green-600 text-white focus:ring-green-500 disabled:bg-green-300 disabled:cursor-not-allowed',
    secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-900 focus:ring-gray-500 disabled:bg-gray-50 disabled:text-gray-400',
    success: 'bg-green-500 hover:bg-green-600 text-white focus:ring-green-500 disabled:bg-green-300 disabled:cursor-not-allowed',
    danger: 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-500 disabled:bg-red-300 disabled:cursor-not-allowed',
    ghost: 'bg-transparent hover:bg-gray-100 text-gray-700 focus:ring-gray-500 disabled:text-gray-400'
  }
  
  const widthClass = fullWidth ? 'w-full' : ''
  
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${widthClass} ${className}`}
    >
      {children}
    </button>
  )
}
