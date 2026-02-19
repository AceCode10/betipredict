interface PercentageCircleProps {
  percentage: number
  size?: number
  strokeWidth?: number
  color?: string
  backgroundColor?: string
  showText?: boolean
  className?: string
}

export function PercentageCircle({
  percentage,
  size = 60,
  strokeWidth = 4,
  color = 'rgb(34 197 94)', // green-500
  backgroundColor = 'rgb(229 231 235)', // gray-200
  showText = true,
  className = ''
}: PercentageCircleProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percentage / 100) * circumference

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={backgroundColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-300 ease-out"
        />
      </svg>
      {showText && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-gray-900 dark:text-white">
            {percentage}%
          </span>
        </div>
      )}
    </div>
  )
}
