// Opens the trapped EPUB with foliate-js, as Vera's reader does; the page records whether a script of the book ran.
import 'foliate-js/view.js';
const bytes = await (await fetch('/piege.epub')).arrayBuffer();
const view = document.createElement('foliate-view');
view.style.cssText = 'position:absolute;inset:0;display:block';
document.getElementById('host').append(view);
await view.open(new File([bytes], 'livre.epub', {type: 'application/epub+zip'}));
await view.init({lastLocation: null, showTextStart: true});
window.__opened = true;
