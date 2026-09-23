/**
 * Preloaded into CLI child processes (`--import`): when FL_TEST_GITHUB is set, requests to https://github.com go to
 * that origin instead (the mock server serves the addon release zips).
 */
const base = process.env.FL_TEST_GITHUB;
if (base) {
  const realFetch = globalThis.fetch;
  const github = 'https://github.com/';
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return realFetch(url.startsWith(github) ? `${base}/${url.slice(github.length)}` : input, init);
  };
}
