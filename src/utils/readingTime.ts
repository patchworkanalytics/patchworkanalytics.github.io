export function readingTime(body: string): string {
  const words = body.trim().split(/\s+/).length
  return `${Math.ceil(words / 200)} min read`
}
