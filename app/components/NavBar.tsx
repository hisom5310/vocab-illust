'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavBar() {
  const pathname = usePathname()
  const isGenerate = pathname === '/' || pathname === '/generate'
  const isReview = pathname === '/review'

  return (
    <nav className="sticky top-0 z-40 bg-white border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-6 flex items-center h-12 gap-1">
        <span className="text-sm font-bold text-gray-900 mr-4">보캡 일러스트</span>
        <Link
          href="/"
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isGenerate
              ? 'bg-teal-50 text-teal-700'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          생성하기
        </Link>
        <Link
          href="/review"
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isReview
              ? 'bg-teal-50 text-teal-700'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          생성한 일러스트
        </Link>
      </div>
    </nav>
  )
}
