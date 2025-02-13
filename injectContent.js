// Tracks script loading progress for different categories
const scriptQueues = {
  main: ['once'],        // Main scripts (initial placeholder)
  vendor: ['once', 'primed'], // Vendor scripts (primed = ready to load)
  internal: ['once', 'primed'] // Internal scripts (primed = ready to load)
};

// Unique event ID for signaling main script completion
const mainCompletedEventId = Date.now().toString(36) + Date.now();

// Handles script completion and triggers main completion event
function handleScriptLoaded(scriptUrl, queueType) {
  const queue = scriptQueues[queueType];
  const index = queue.indexOf(scriptUrl);
  if (index > -1) queue.splice(index, 1);

  if (queueType === 'main' && queue.length === 1 && queue[0] === 'once') {
    queue.splice(queue.indexOf('once'), 1);
    window.dispatchEvent(new CustomEvent(mainCompletedEventId));
  }
}

// Utility delay function
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main injection function
function initializeInjector(extensionBaseUrl = chrome.runtime.getURL("")) {
  // Injects a script and tracks its loading status
  async function injectScript(url, queueType = 'base', dataUrl, dataId) {
    return new Promise(async (resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;

      if (queueType === 'main') {
        script.setAttribute('data-url', dataUrl);
        script.setAttribute('data-id', dataId);
        script.setAttribute('id', 'injector');
      }

      if (url.includes('main.js') || url.includes('loader.js')) {
        script.setAttribute('type', 'module');
      }

      if (scriptQueues[queueType]) {
        scriptQueues[queueType].push(url);
      }

      script.addEventListener('load', () => {
        if (scriptQueues[queueType]) handleScriptLoaded(url, queueType);
        script.remove();
        resolve();
      });

      script.addEventListener('error', () => {
        script.remove();
        reject();
      });

      // Find suitable injection point
      let parentNode;
      if (document.documentElement) {
        parentNode = document.documentElement;
      } else {
        while (!document.head && !document.documentElement) await sleep(0);
        parentNode = document.head || document.documentElement;
      }
      parentNode.appendChild(script);
    });
  }

  // Fetches JSON manifest files
  async function fetchManifest(url) {
    const response = await fetch(url);
    if (response.status !== 200) throw new Error(`Failed to load: ${url}`);
    return response.json();
  }

  // Creates promise that resolves when main scripts complete
  const mainScriptsLoaded = new Promise(resolve => {
    window.addEventListener(mainCompletedEventId, resolve, { 
      once: true,
      passive: true
    });
  });

  // CSS injection handler
  const cssInjector = setInterval(() => {
    if (document.head) {
      ['common', 'bootstrap'].forEach(file => {
        const link = document.createElement('link');
        link.href = `${extensionBaseUrl}src/web/css/${file}.css`;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      });
      clearInterval(cssInjector);
    }
  }, 0);

  // Main injection sequence
  (async function() {
    try {
      const extensionId = chrome.runtime.id;
      
      // Load core script
      await injectScript(
        `${extensionBaseUrl}src/web/drawer.js`,
        'main',
        extensionBaseUrl,
        extensionId
      );

      // Load manifests
      const vendorManifest = await fetchManifest(`${extensionBaseUrl}vendor.json`);
      const internalManifest = await fetchManifest(`${extensionBaseUrl}internal.json`);

      // Wait for main scripts to complete
      await mainScriptsLoaded;

      // Load vendor scripts
      const vendorScripts = await vendorManifest;
      for (const script of vendorScripts) {
        try {
          await injectScript(
            `${extensionBaseUrl}src/vendor/${script}.js`,
            'vendor'
          );
        } catch (error) {
          console.error('Vendor script failed:', script, error);
        }
      }
      handleScriptLoaded('primed', 'vendor');

      // Load internal scripts
      const internalScripts = await internalManifest;
      for (const entry of internalScripts) {
        if (typeof entry === 'string') {
          await injectScript(
            `${extensionBaseUrl}src/web/${entry}.js`,
            'internal'
          );
        } else {
          const [name, path] = entry;
          await injectScript(`${path}/web/${name}.js`, 'internal');
        }
      }
      handleScriptLoaded('primed', 'internal');

    } catch (error) {
      console.error('Initialization failed:', error);
    }
  })();
}

// Start the injection process
initializeInjector();
