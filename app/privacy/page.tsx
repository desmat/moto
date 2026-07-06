import Link from 'next/link'

export default function Page() {
  return (
    <div className="_bg-yellow-200 flex flex-col gap-3 items-center w-full">
      <h2>Privacy</h2>
      <p>TODO</p>
      <Link href="/" className="hover:underline">[Return Home]</Link>
    </div>
  )
}