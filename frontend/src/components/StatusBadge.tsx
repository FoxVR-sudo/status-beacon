interface Props {
  statusCode: number | null
}

export default function StatusBadge({ statusCode }: Props) {
  if (statusCode === null) {
    return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-500">Pending</span>
  }
  if (statusCode === 0) {
    return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">Timeout</span>
  }
  if (statusCode < 0) {
    return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">Error</span>
  }
  if (statusCode >= 200 && statusCode < 300) {
    return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">{statusCode}</span>
  }
  if (statusCode >= 300 && statusCode < 400) {
    return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">{statusCode}</span>
  }
  if (statusCode >= 400 && statusCode < 500) {
    return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">{statusCode}</span>
  }
  return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">{statusCode}</span>
}
