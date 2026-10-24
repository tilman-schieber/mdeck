import CodeBlock from '../components/CodeBlock.jsx'
import QrCodeTag from '../components/QrCodeTag.jsx'
import VideoPlayer from '../components/VideoPlayer.jsx'
import Poll from '../components/Poll.jsx'
import Question from '../components/Question.jsx'
import WordCloud from '../components/WordCloud.jsx'
import Scale from '../components/Scale.jsx'
import Numeric from '../components/Numeric.jsx'
import Pinpoint from '../components/Pinpoint.jsx'
import Bibliography from '../components/Bibliography.jsx'
import Data from '../components/Data.jsx'
import deckComponents from 'virtual:deck-components'

// Maps lowercase HTML tag names to Preact components.
// Add framework-wide components here and use them in slides.md as <tagname ...>.
//
// A deck can also ship its own components in a `components/` folder next to its
// .md file — those are picked up automatically and merged in below, so a widget
// that only one deck needs never becomes part of every other deck's bundle.
// Deck-local components win on a name collision.
export const registry = {
  codeblock: CodeBlock,
  qrcode: QrCodeTag,
  videoplayer: VideoPlayer,
  poll: Poll,
  question: Question,
  wordcloud: WordCloud,
  scale: Scale,
  numeric: Numeric,
  pinpoint: Pinpoint,
  bibliography: Bibliography,
  data: Data,
  ...deckComponents,
}
