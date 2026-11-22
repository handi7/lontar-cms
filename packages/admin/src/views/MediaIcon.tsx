import { File, FileText, Film, Image, Music } from 'lucide-react'
import { mimeGroupOf } from './media'

interface MediaIconProps {
  mimeType: unknown
  className?: string
}

/** The placeholder shown for a file with no image preview, picked by MIME type. */
export function MediaIcon({ mimeType, className }: MediaIconProps) {
  const props = { className, 'aria-hidden': true as const }
  switch (mimeGroupOf(mimeType)) {
    case 'images':
      return <Image {...props} />
    case 'video':
      return <Film {...props} />
    case 'audio':
      return <Music {...props} />
    case 'documents':
      return <FileText {...props} />
    case 'other':
      return <File {...props} />
  }
}
