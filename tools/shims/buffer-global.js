// esbuild `inject` shim: any dependency that uses the Node `Buffer` global without importing it
// gets the browser `buffer` package instead (the same instance web3.js imports).
export { Buffer } from 'buffer';
