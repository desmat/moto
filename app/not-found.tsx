import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="_bg-yellow-200 flex flex-col gap-3 items-center w-full">
      <b><h1>Not Found</h1></b>
      <p>Could not find requested resource</p>
      <Link href="/" className="hover:underline">[Return Home]</Link>
    </div>
  )
}