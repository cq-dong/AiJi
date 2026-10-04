import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 关于页 releaseNotes 的 Markdown 渲染。react-markdown + remark-gfm ~30kB gzip，
// 抽成独立文件供 settings/index.tsx React.lazy 按需加载——不进 settings 主 chunk，
// 仅「检查更新」返回带 releaseNotes 时才拉取。
export default function ReleaseNotes({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
}
