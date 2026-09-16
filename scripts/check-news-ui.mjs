import { spawnSync } from 'node:child_process'

// Catch undefined names in JSX too: Vite transpiles but does not type-check them.
const roots=['src/components/News.jsx','src/components/NewsAdmin.jsx','src/components/NewsPublish.jsx','src/components/NewsOperations.jsx','src/components/NewsProse.jsx','src/components/NewsFigure.jsx','src/components/NewsCharts.jsx','src/components/NewsFigureMap.jsx','src/components/NewsVisualGallery.jsx','src/components/Admin.jsx','src/lib/newsApi.js','src/lib/newsPublic.js']
const result=spawnSync('node_modules/.bin/tsc',['--allowJs','--checkJs','--noEmit','--skipLibCheck','--target','ES2023','--module','ESNext','--moduleResolution','Bundler','--jsx','react-jsx','--pretty','false',...roots],{encoding:'utf8',maxBuffer:8_000_000})
if(result.error)throw result.error
if(result.signal || ![0,1,2].includes(result.status) || (result.status!==0&&!result.stdout.includes('error TS')))throw new Error(`JSX checker failed to run: ${result.stderr || result.status}`)
const errors=result.stdout.split('\n').filter(line=>/error TS(2304|2552|18004):/.test(line)&&roots.some(p=>line.startsWith(p)))
if(errors.length){console.error(errors.join('\n'));process.exitCode=1}
else console.log('News JSX symbol checks passed (not a browser verification).')
