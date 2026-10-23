import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/literata';
import './style.css';
import {App} from './App';
import {Guide} from './components/Guide';

// The guide window of the sharing assistant is the same page, opened with ?guide=1 (src-tauri/src/share.rs).
const guide = new URLSearchParams(location.search).has('guide');
createRoot(document.getElementById('root')!).render(<StrictMode>{guide ? <Guide/> : <App/>}</StrictMode>);
