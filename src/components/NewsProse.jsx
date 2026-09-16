import { newsParagraphs } from '../../shared/news-prose'
import { Fragment } from 'react'
import NewsFigure from './NewsFigure'

export default function NewsProse({ body, visuals = [] }) {
  return <div className="news-prose">{newsParagraphs(body).map((paragraph, index) =>
    <Fragment key={index}><p>{paragraph.map((part, i) => part.href
      ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>
      : part.text)}</p>{(Array.isArray(visuals) ? visuals : []).filter(v => v?.afterParagraph === index + 1).map(figure => <NewsFigure key={figure.id} figure={figure}/>)}</Fragment>
  )}</div>
}
