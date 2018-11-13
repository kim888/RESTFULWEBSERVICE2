/*
 * Copyright 2010-2018 Restlet S.A.S. All rights reserved.
 * Restlet is registered trademark of Restlet S.A.S.
 */

/* eslint-disable no-console */

const DEFAULT_INDICATOR_ELEMENT_ID = 'dhcInfo';
const INDICATOR_TAG_TYPE = 'dhc/info';
const EXTENSION_ID = chrome.runtime.id;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const getIndicatorElementId = (log, metaTag) => {
  const indicatorElementIdFromDom = metaTag.getAttribute('data-indicator-element-id');
  if (indicatorElementIdFromDom == null) {
    log(`data-indicator-element-id is not specified, using default id ${DEFAULT_INDICATOR_ELEMENT_ID}`);
    return DEFAULT_INDICATOR_ELEMENT_ID;
  }

  log(`data-indicator-element-id is: '${indicatorElementIdFromDom}'`);
  return indicatorElementIdFromDom;
};

const removeSelfInformationFromIndicator = (log, indicatorElementId) => {
  Array.prototype.slice.call(document.querySelectorAll(`script#${indicatorElementId}`))
    .filter((element) => EXTENSION_ID === JSON.parse(element.innerText).extensionId)
    .forEach((element) => {
      log('Removed self information from indicator.');
      element.parentNode.removeChild(element);
    });
};

const stripPatchVersion = (clientVersion) => /^([0-9]+\.[0-9]+\.[0-9]+)(\.[0-9]+)?$/.exec(clientVersion)[ 1 ];

const createNewSelfInformationIndicator = (log, indicatorElementId) => {
  const dhcInfo = {
    dhcVersion: stripPatchVersion(EXTENSION_VERSION),
    extensionId: EXTENSION_ID
  };

  log('Dhc info is ', dhcInfo);

  const scriptElement = document.createElement('script');
  scriptElement.id = indicatorElementId; // TODO: remove when apps reading this are up-to-date
  scriptElement.setAttribute('client-indicator', indicatorElementId);
  scriptElement.type = INDICATOR_TAG_TYPE;
  scriptElement.textContent = JSON.stringify(dhcInfo);

  log(`Creating indicator tag with id: ${indicatorElementId}, type: ${scriptElement.type}`);
  document.documentElement.appendChild(scriptElement);
};

(() => {
  const metaTag = document.querySelector('meta[name="dhc-aware-page"]');

  if (!metaTag) {
    return;
  }

  const isDebugEnabled = metaTag.getAttribute('data-console-debug') === 'true';
  const log = isDebugEnabled ? console.log.bind(console) : () => {};

  log('Restlet Client meta tag found.');
  const indicatorElementId = getIndicatorElementId(log, metaTag);

  removeSelfInformationFromIndicator(log, indicatorElementId);

  createNewSelfInformationIndicator(log, indicatorElementId);

  log('Indicator tag created');
  log('Waiting for messages from target page');
  window.addEventListener('message', (event) => {
    log('Received message', event.data);
    if (event.source !== window) {
      log('A message from another window was ignored');
      return;
    }

    if (!event.data) {
      log('Empty message ignored');
      return;
    }

    if (event.data.target !== EXTENSION_ID) {
      log(`Message is ignored since provided target ('${event.data.target}') doesn't match expected value: '${EXTENSION_ID}'`);
      return;
    }

    if (!event.data.type) {
      log('Messaged is ignored since \'type\' property is missing');
      return;
    }
    log('Message is valid, delegating it to Restlet Client');

    chrome.runtime.sendMessage(event.data, () => {
      // TODO process response from main Client
    });
  }, false);
})();

