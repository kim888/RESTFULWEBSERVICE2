/* eslint-disable no-bitwise,no-mixed-operators */

/**
 * Constants
 */

const EXTENSION_ID = chrome.runtime.id;
const EXTENSION_VERSION = chrome.app.getDetails().version;

/**
 * Utility functions
 */

const getExtensionUrl = (isDevMode, queryString) =>
  `chrome-extension://${EXTENSION_ID}/restlet_client${isDevMode ? '_dev' : ''}.html${queryString || ''}`;

// From: https://gist.github.com/jcxplorer/823878, changed to pass linting
const uuid = () => {
  const hyphensIndexes = [ 8, 13, 18, 23 ];
  return Array(36)
    .fill(0)
    .map((__, index) => {
      // eslint-disable-next-line no-bitwise
      const random = Math.random() * 16 | 0;

      if (hyphensIndexes.includes(index)) {
        return '-';
      }

      if (index === 14) {
        return (4).toString(16);
      }

      if (index === 19) {
        // eslint-disable-next-line no-bitwise,no-mixed-operators
        return (random & 3 | 8).toString(16);
      }

      return (random).toString(16);
    })
    .join('');
};

// Source: https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/Base64_encoding_and_decoding#The_Unicode_Problem
const utf8Base64Encode = (string) => {
  const rawString = encodeURIComponent(string)
    .replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1));
  return btoa(rawString);
};

/**
 * Initialization
 */

const restoreLastSessionTabs = () => {
  const clearOpenedTabs = () => chrome.storage.local.remove('dhc.opened.tabs');

  chrome.storage.local.get('dhc.opened.tabs', (openedTabs) => {
    const clientOpenedTabs = openedTabs[ 'dhc.opened.tabs' ];
    if (clientOpenedTabs) {
      clientOpenedTabs.forEach((url) => {
        chrome.tabs.create({ url }, clearOpenedTabs);
      });
    }
  });
};

restoreLastSessionTabs();

const payloadStore = {};

// Used in ChromeAppEntryPoint, don't delete no matter what IntelliJ says
// eslint-disable-next-line no-unused-vars
window.retrieveDhcPayloadDefinition = (key) => {
  const data = payloadStore[ key ];
  if (data) {
    delete payloadStore[ key ];
  }
  return data;
};

/**
 * Message handling
 */

const allowedUrlsRegexes = [
  new RegExp(`^chrome-extension:\\/\\/${EXTENSION_ID}\\/`),
  // Talend
  /^https:\/\/([^/]+\.)?datapwn\.com(\/.*)?$/,
  /^https:\/\/([^/]+\.)?apigarden\.com(\/.*)?$/,
  /^https:\/\/([^/]+\.)?talend\.com(\/.*)?$/, // Tests: https://regex101.com/r/hZGsd7/1/tests

  // Restlet
  /^https:\/\/([^/]+\.)?restlet\.(com|io)(\/.*)?$/, // Tests: https://regex101.com/r/jwB8Y2/1/tests
  /^https:\/\/([^/]+\.)?rest-let\.(com|io)(\/.*)?$/, // Tests: https://regex101.com/r/M3XTDR/1/tests

  // Dev local
  /^http:\/\/localhost(:[0-9]+)?(\/.*)?$/, // Tests: https://regex101.com/r/9nP3Pq/1/tests
  /^http:\/\/127.0.0.1.xip.io(:[0-9]+)?(\/.*)?$/
];

const stripPatchVersion = (clientVersion) => /^([0-9]+\.[0-9]+\.[0-9]+)(\.[0-9]+)?$/.exec(clientVersion)[ 1 ];

// BEGIN: message handlers
const sendMixpanel = (message) => {
  const json = JSON.stringify(message.payload);
  const base64Encoded = utf8Base64Encode(json);
  fetch(`https://api.mixpanel.com/track/?data=${base64Encoded}&ip=1`);
};

const engageMixpanel = (message) => {
  const json = JSON.stringify(message.payload);
  const base64Encoded = utf8Base64Encode(json);
  fetch(`https://api.mixpanel.com/engage/?data=${base64Encoded}&ip=1`);
};

const handleUpgrade = () => {
  const openedTabsUrl = chrome.extension.getViews({ type: 'tab' })
    .map((tab) => tab.location.href);

  chrome.storage.local.set(
    { 'dhc.opened.tabs': openedTabsUrl },
    () => {
      if (chrome.runtime.lastError) {
        // Just in case
        chrome.storage.local.remove('dhc.opened.tabs');
        return;
      }
      chrome.runtime.reload();
    }
  );
};

const handleImpersonation = (message, sender) => {
  const extensionBaseUrl = `chrome-extension://${EXTENSION_ID}/restlet_client.html`;
  // Close other tabs for impersonation to be able to clear the DB
  chrome.extension.getViews()
    .forEach((viewWindow) => {
      if (viewWindow.location.href.indexOf(extensionBaseUrl) === 0) {
        viewWindow.close();
      }
    });

  //  Start the impersonation
  chrome.tabs.create({ url: extensionBaseUrl + message.hash, active: true });

  // Close the impersonation page
  chrome.tabs.remove(sender.tab.id);
};

const processInTargetTabIfExists = (message) => {
  const views = chrome.extension.getViews({ type: 'tab' });
  const targetTab = message.targetTab;
  for (let i = 0; i < views.length; i++) {
    const view = views[ i ];
    if (view.dhcTargetTab === targetTab) {
      view.dhcProcessPayload(message.type, message.source, message.payloadType, JSON.stringify(message.payload));
      chrome.tabs.update(view.dhcChromeTabId, { active: true });
      return true;
    }
  }

  return false;
};

const handleOpenApiOrRequest = (message, sender) => {
  if (sender.tab == null || processInTargetTabIfExists(message)) {
    return;
  }

  const query = {
    key: uuid(),
    payloadType: message.payloadType,
    targetTab: message.targetTab
  };

  const queryFirstPart = message.queryString ? `${message.queryString}&` : '?';
  const queryRemainingPart = Object.keys(query)
    .filter((key) => query[ key ])
    .map((key) => `${key}=${query[ key ]}`)
    .join('&');
  const targetUrl = getExtensionUrl(message.isDevMode, queryFirstPart + queryRemainingPart);

  chrome.tabs.create({ url: targetUrl, active: true }, () => {
    const views = chrome.extension.getViews({ type: 'tab' });
    const createdWindow = views.filter((window) => window.location.search.indexOf(`key=${query.key}`) > -1)[ 0 ];

    if (createdWindow) {
      if (typeof createdWindow.dhcProcessPayload === 'function') {
        createdWindow.dhcProcessPayload(message.type, message.source, message.payloadType, message.payload, sender.url);

      } else if (!createdWindow.dhcPayloadDefinition) {
        createdWindow.dhcPayloadDefinition = {
          messageType: message.type,
          messageSource: message.source,
          payloadType: message.payloadType,
          payload: message.payload,
          url: sender.url
        };
      }
    } else {
      payloadStore[ query.key ] = {
        messageType: message.type,
        messageSource: message.source,
        payloadType: message.payloadType,
        payload: message.payload,
        url: sender.url
      };
    }
  });
};

const getApplicationInstances = (sender) => {
  return chrome.extension.getViews({ type: 'tab' })
    .filter((applicationWindow) => applicationWindow.dhcChromeTabId !== sender.tab.id);
};

const checkRootNameAvailability = (message, sender, sendResponse) => {
  const applicationInstancesPromiseList = getApplicationInstances(sender)
    .map((applicationWindow) => new Promise((resolve, reject) => {
      const onFailureCheckAvailability = setTimeout(reject, 5000);
      chrome.tabs.sendMessage(applicationWindow.dhcChromeTabId, message, (isAvailable) => {
        clearTimeout(onFailureCheckAvailability);
        resolve(isAvailable);
      });
    }));

  Promise.all(applicationInstancesPromiseList)
    .then((availabilities) => availabilities.reduce((accumulator, availability) => accumulator && availability, true))
    .then(sendResponse)
    .catch(() => sendResponse(false));
  return true;
};

const notifyRunningInstances = (message, sender) => {
  getApplicationInstances(sender)
    .forEach((applicationWindow) => chrome.tabs.sendMessage(applicationWindow.dhcChromeTabId, message));
};

const handleDiscovery = (message, sender, sendResponse) => {
  sendResponse(stripPatchVersion(EXTENSION_VERSION));
};

const openExtension = (message, sender) => {
  const openConfiguration = {
    active: true,
    url: getExtensionUrl(message.isDevMode, message.queryString)
  };

  if (message.useExistingTab) {
    chrome.tabs.update(sender.tab.id, openConfiguration);
  } else {
    chrome.tabs.create(openConfiguration);
  }
};

const MESSAGE_TYPES = {
  mixpanel: { isProtected: true, handler: sendMixpanel },
  mixpanel_engage: { isProtected: true, handler: engageMixpanel },
  upgrade: { isProtected: true, handler: handleUpgrade },
  impersonate: { isProtected: true, handler: handleImpersonation },
  openApi: { isProtected: true, handler: handleOpenApiOrRequest },
  checkRootNameAvailability: { isProtected: true, handler: checkRootNameAvailability },
  notifyRunningInstances: { isProtected: true, handler: notifyRunningInstances },

  discovery: { isProtected: false, handler: handleDiscovery },
  openRequest: { isProtected: false, handler: handleOpenApiOrRequest },
  openExtension: { isProtected: false, handler: openExtension }
};
// END: message handlers

const createMessageListener = () => {
  return (message, sender, sendResponse) => {
    if (!message || !message.type || !MESSAGE_TYPES[ message.type ]) {
      return false;
    }

    const messageType = MESSAGE_TYPES[ message.type ];

    if (messageType.isProtected) {
      const validatedUrlRegexes = Object.values(allowedUrlsRegexes).filter((regex) => regex.test(sender.url));

      if (validatedUrlRegexes.length < 1) {
        // eslint-disable-next-line no-console
        console.warn(`Message ${JSON.stringify(message)} from URL ${sender.url} was blocked for your safety.`);
        return false;
      }
    }

    return messageType.handler(message, sender, sendResponse);
  };
};

chrome.runtime.onMessage.addListener(createMessageListener());
chrome.runtime.onMessageExternal.addListener(createMessageListener());

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      'dhc.installed': 'true',
      last_migration_ran: EXTENSION_VERSION
    });
  }

  // In case of fresh install or update then notify the opened websites that want to be DHC aware
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.windows.getAll({}, (windows) => {
      windows.forEach((applicationWindow) => {
        chrome.tabs.getAllInWindow(applicationWindow.id, (tabs) => {
          tabs
            .filter((tab) => tab && tab.url && tab.url.indexOf('http') === 0)
            .forEach((tab) => chrome.tabs.executeScript(tab.id, { file: 'contentScript.js' }));
        });
      });
    });
  }
});
