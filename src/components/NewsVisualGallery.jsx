import NewsFigure from './NewsFigure'
import { visualExamples } from '../../shared/news-visual-fixtures'

export default function NewsVisualGallery() {
  return <section className="nf-gallery"><h3>visuals / specimens</h3><p className="na-note">Illustrative test data. These components are available to the editor; none of these specimens is a news item.</p><nav aria-label="Visual specimens">{visualExamples.map(v=><a key={v.id} href={`#${v.id}`}>{v.kind}</a>)}</nav>{visualExamples.map(figure=><section key={figure.id} id={figure.id}><NewsFigure figure={figure}/></section>)}</section>
}
