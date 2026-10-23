/// <reference types="vite/client" />

// foliate-js ships plain ES modules without types; Vera uses its <foliate-view> element (src/components/Reader.tsx).
declare module 'foliate-js/view.js';
